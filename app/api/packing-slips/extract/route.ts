import { NextResponse, type NextRequest } from "next/server";

import { requireOrg } from "@/lib/auth/session";
import { getSignedPackingSlipUrl } from "@/lib/projects/queries";

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
  "Skip lines that are not physical materials being shipped: freight " +
  "charges, permits, discounts, taxes, fees, and similar. Preserve sizes " +
  "exactly as printed, including units (inches, feet, etc.) — do not " +
  "round or convert them.";

interface ExtractedItem {
  code: string | null;
  description: string;
  size: string | null;
  qty: number;
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

  const body = (await request.json()) as { storagePath?: string };
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
                  },
                  required: ["description", "qty"],
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

  return NextResponse.json({ items: toolUse.input.items ?? [] });
}
