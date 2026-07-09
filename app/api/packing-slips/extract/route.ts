import { NextResponse, type NextRequest } from "next/server";

import { requireOrg } from "@/lib/auth/session";
import { recordExtractionRun } from "@/lib/extraction/log";
import { getSignedPackingSlipUrl } from "@/lib/projects/queries";
import type { Json } from "@/lib/supabase/database.types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";

const EXTRACTION_PROMPT =
  "Extract every distinct racking/warehouse material line item from this " +
  "packing slip. For each, capture: code (product/part code or SKU if " +
  "present, else null), description (the item name, e.g. 'Beam', " +
  "'Upright', 'Wire Deck', 'Row Spacer', 'End Barrier', 'Post Protector', " +
  "'Anchor'), size (dimensional size exactly as printed — widths, " +
  "heights, lengths, gauge — else null), and qty (quantity shipped, as a " +
  "number). Two lines with the same description but different sizes " +
  "(e.g. two beam lengths) are two separate items — never merge them. " +
  "INCLUDE every line — do NOT drop anything. For lines that are NOT " +
  "physical racking materials being shipped (freight charges, permits, " +
  "discounts, taxes, fees, hardware kits, handling), set is_material=false " +
  "so a human can confirm the exclusion rather than have it silently " +
  "vanish. For real material lines set is_material=true. Give each line a " +
  "confidence from 0 to 1 for how sure you are of its code/description/" +
  "size/qty (lower it when the print is faint, ambiguous, or handwritten). " +
  "Preserve sizes exactly as printed, including units (inches, feet, etc.) " +
  "— do not round or convert them. Two lines with the same description but " +
  "different sizes are two separate items — never merge them.";

interface ExtractedItem {
  code: string | null;
  description: string;
  size: string | null;
  qty: number;
  is_material?: boolean;
  confidence?: number;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  input: { items?: ExtractedItem[] };
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicMessageResponse {
  content: (AnthropicToolUseBlock | AnthropicTextBlock)[];
}

function isToolUseBlock(
  block: AnthropicToolUseBlock | AnthropicTextBlock
): block is AnthropicToolUseBlock {
  return block.type === "tool_use";
}

export async function POST(request: NextRequest) {
  // Previously only indirectly gated — getSignedPackingSlipUrl below would
  // eventually fail for an unauthenticated/wrong-org caller (Storage RLS
  // rejects the signed-URL request), but as an uncaught exception, not a
  // clean response. Explicit check, same as the voice-note route (ADR-027).
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
  const storagePath = body.storagePath;
  if (!storagePath) {
    return NextResponse.json(
      { error: "storagePath is required." },
      { status: 400 }
    );
  }

  const signedUrl = await getSignedPackingSlipUrl(storagePath);
  const fileResponse = await fetch(signedUrl);
  if (!fileResponse.ok) {
    return NextResponse.json(
      { error: "Could not fetch the packing slip file from storage." },
      { status: 502 }
    );
  }
  const contentType =
    fileResponse.headers.get("content-type") ?? "application/pdf";
  const base64 = Buffer.from(await fileResponse.arrayBuffer()).toString(
    "base64"
  );

  // The packing-slip upload accepts any file type (no `accept` filter on
  // the <input>), so this could be a PDF or a photo of the slip — the two
  // Anthropic content-block types aren't interchangeable (a PDF must be
  // "document", an image must be "image").
  const fileBlock = contentType.startsWith("image/")
    ? {
        type: "image",
        source: { type: "base64", media_type: contentType, data: base64 },
      }
    : {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
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
          name: "record_materials",
          description:
            "Record the material line items extracted from a packing slip.",
          input_schema: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    code: { type: ["string", "null"] },
                    description: { type: "string" },
                    size: { type: ["string", "null"] },
                    qty: { type: "number" },
                    is_material: {
                      type: "boolean",
                      description:
                        "true for real racking materials; false for freight/permits/fees/etc.",
                    },
                    confidence: {
                      type: "number",
                      description: "0–1 confidence in this line's fields",
                    },
                  },
                  required: ["description", "qty", "is_material", "confidence"],
                },
              },
            },
            required: ["items"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "record_materials" },
      messages: [
        {
          role: "user",
          content: [fileBlock, { type: "text", text: EXTRACTION_PROMPT }],
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

  const data = (await anthropicResponse.json()) as AnthropicMessageResponse;
  const toolUse = data.content.find(isToolUseBlock);
  if (!toolUse) {
    return NextResponse.json(
      { error: "The AI didn't return structured data." },
      { status: 502 }
    );
  }

  const items = (toolUse.input.items ?? []).map((item) => ({
    ...item,
    is_material: item.is_material !== false,
    confidence:
      typeof item.confidence === "number" ? item.confidence : null,
  }));

  // Flag same-code+size lines the model split — a merge warning for the
  // reviewer, not an automatic merge (two identical lines can be two real
  // shipments).
  const seen = new Map<string, number>();
  const duplicateKeys = new Set<string>();
  for (const item of items) {
    const key = `${(item.code ?? "").trim().toLowerCase()}|${(item.size ?? "").trim().toLowerCase()}|${item.description.trim().toLowerCase()}`;
    if (!item.code && !item.size) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if ((seen.get(key) ?? 0) > 1) duplicateKeys.add(key);
  }

  const confidences = items
    .map((i) => i.confidence)
    .filter((c): c is number => typeof c === "number");
  const overall =
    confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null;

  // projectId lets us log the run; older callers that don't pass it still
  // work (logging is best-effort and skipped without it).
  const projectId =
    typeof body.projectId === "string" ? body.projectId : null;
  let runId: string | null = null;
  if (projectId) {
    runId = await recordExtractionRun({
      projectId,
      kind: "packing_slip",
      inputPath: storagePath,
      rawOutput: { items } as unknown as Json,
      confidence: overall,
    });
  }

  return NextResponse.json({
    items,
    duplicateKeys: [...duplicateKeys],
    confidence: overall,
    runId,
  });
}
