import { NextResponse, type NextRequest } from "next/server";

import { requireOrg } from "@/lib/auth/session";
import { recordExtractionRun } from "@/lib/extraction/log";
import { getSignedDrawingUrl } from "@/lib/projects/queries";
import type { Json } from "@/lib/supabase/database.types";

// Batch 5 Sub-phase B(1): drawing row auto-detection. The vision model
// proposes racking-row rectangles in NORMALIZED (0–1) image coordinates,
// which the marking editor renders as reviewable ghost boxes. It NEVER
// creates rows — the human confirms/adjusts/deletes, then applies.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";

const DETECT_PROMPT =
  "This is a warehouse racking LAYOUT drawing. Detect each distinct " +
  "racking ROW (a long run of back-to-back uprights carrying beams — " +
  "drawn as a long thin rectangle, often labeled 'Row N' or with an " +
  "aisle number). For EACH row return a bounding box in NORMALIZED " +
  "coordinates where x,y is the TOP-LEFT corner and w,h are width/height, " +
  "each between 0 and 1 relative to the full image (x+w ≤ 1, y+h ≤ 1). " +
  "Include any readable row/aisle label text. Give each a confidence " +
  "0–1. Do NOT include aisles (the empty walking space between rows), " +
  "staging areas, dock doors, walls, or title blocks — only the physical " +
  "racking rows. If the drawing is not a rack layout, return no rows.";

interface DetectedRow {
  label: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence?: number;
}

interface ToolUseBlock {
  type: "tool_use";
  input: { rows?: DetectedRow[] };
}
interface TextBlock {
  type: "text";
  text: string;
}
function isToolUse(b: ToolUseBlock | TextBlock): b is ToolUseBlock {
  return b.type === "tool_use";
}

function clamp01(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.min(1, Math.max(0, v));
}

export async function POST(request: NextRequest) {
  try {
    await requireOrg();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Not signed in." },
      { status: 401 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  const body = (await request.json()) as {
    storagePath?: string;
    projectId?: string;
  };
  if (!body.storagePath) {
    return NextResponse.json(
      { error: "storagePath is required." },
      { status: 400 }
    );
  }

  const signedUrl = await getSignedDrawingUrl(body.storagePath);
  if (!signedUrl) {
    return NextResponse.json(
      { error: "Could not access the drawing file." },
      { status: 502 }
    );
  }
  const fileResponse = await fetch(signedUrl);
  if (!fileResponse.ok) {
    return NextResponse.json(
      { error: "Could not fetch the drawing from storage." },
      { status: 502 }
    );
  }
  const contentType =
    fileResponse.headers.get("content-type") ?? "image/jpeg";
  const base64 = Buffer.from(await fileResponse.arrayBuffer()).toString(
    "base64"
  );
  // Drawings are rendered to JPEG on upload (lib/pdf/render-drawing-file),
  // so this is an image block; a raw PDF path would need a document block.
  const fileBlock = contentType.startsWith("image/")
    ? {
        type: "image",
        source: { type: "base64", media_type: contentType, data: base64 },
      }
    : {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: base64,
        },
      };

  const anthropicResponse = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      tools: [
        {
          name: "record_rows",
          description:
            "Record the racking rows detected in a layout drawing.",
          input_schema: {
            type: "object",
            properties: {
              rows: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: ["string", "null"] },
                    x: { type: "number" },
                    y: { type: "number" },
                    w: { type: "number" },
                    h: { type: "number" },
                    confidence: { type: "number" },
                  },
                  required: ["x", "y", "w", "h", "confidence"],
                },
              },
            },
            required: ["rows"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "record_rows" },
      messages: [
        {
          role: "user",
          content: [fileBlock, { type: "text", text: DETECT_PROMPT }],
        },
      ],
    }),
  });

  if (!anthropicResponse.ok) {
    const detail = await anthropicResponse.text();
    return NextResponse.json(
      { error: `Anthropic API error (${anthropicResponse.status}): ${detail}` },
      { status: 502 }
    );
  }

  const data = (await anthropicResponse.json()) as {
    content: (ToolUseBlock | TextBlock)[];
  };
  const toolUse = data.content.find(isToolUse);
  if (!toolUse) {
    return NextResponse.json(
      { error: "The AI didn't return structured data." },
      { status: 502 }
    );
  }

  // Normalize + drop degenerate boxes; clamp into the unit square.
  const rows = (toolUse.input.rows ?? [])
    .map((r) => ({
      label: typeof r.label === "string" ? r.label : null,
      x: clamp01(r.x),
      y: clamp01(r.y),
      w: clamp01(r.w),
      h: clamp01(r.h),
      confidence:
        typeof r.confidence === "number" ? clamp01(r.confidence) : null,
    }))
    .filter((r) => r.w > 0.005 && r.h > 0.005 && r.x + r.w <= 1.001 && r.y + r.h <= 1.001);

  const confidences = rows
    .map((r) => r.confidence)
    .filter((c): c is number => c !== null);
  const overall =
    confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null;

  let runId: string | null = null;
  if (body.projectId) {
    runId = await recordExtractionRun({
      projectId: body.projectId,
      kind: "drawing_rows",
      inputPath: body.storagePath,
      rawOutput: { rows } as unknown as Json,
      confidence: overall,
    });
  }

  return NextResponse.json({ rows, confidence: overall, runId });
}
