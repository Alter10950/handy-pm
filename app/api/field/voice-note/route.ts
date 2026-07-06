import { NextResponse, type NextRequest } from "next/server";

import { requireOrg } from "@/lib/auth/session";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";

const BLOCKER_CODES = [
  "MISSING_MATERIAL",
  "WRONG_MATERIAL",
  "CUSTOMER_DELAY",
  "AREA_BLOCKED",
  "FLOOR_ISSUE",
  "DRAWING_ISSUE",
  "CREW_SHORT",
  "EQUIPMENT_ISSUE",
  "WEATHER_TRUCK",
  "OTHER",
] as const;

const VOICE_NOTE_PROMPT =
  "A crew member on a warehouse racking-install job spoke this update " +
  "aloud; it was transcribed by the browser's speech recognition, which " +
  "may contain minor recognition errors. Clean it up into a concise, " +
  "well-punctuated field note — keep every concrete detail (quantities, " +
  "row/bay names, what happened), just remove filler words and false " +
  "starts. Separately, decide whether it describes something that " +
  "STOPPED or SLOWED work (missing/wrong material, blocked area, floor " +
  "issue, drawing issue, short crew, equipment issue, weather/truck, " +
  "customer delay) as opposed to routine progress — if so, pick the " +
  "single best-matching code.";

interface AnthropicToolUseBlock {
  type: "tool_use";
  input: {
    cleaned_note?: string;
    is_blocker?: boolean;
    blocker_code?: string | null;
  };
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
  // Unlike the packing-slip extract route (indirectly gated — it needs a
  // storagePath behind RLS to do anything), this route touches no
  // Supabase data at all, so nothing else stops an unauthenticated
  // caller from spending the Anthropic quota. requireOrg() (any signed-in
  // org member — crew should reach this) is the only gate.
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

  const body = (await request.json()) as { transcript?: string };
  const transcript = body.transcript?.trim();
  if (!transcript) {
    return NextResponse.json(
      { error: "transcript is required." },
      { status: 400 }
    );
  }

  const anthropicResponse = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      tools: [
        {
          name: "record_field_note",
          description:
            "Record a cleaned-up field note from a crew member's spoken update.",
          input_schema: {
            type: "object",
            properties: {
              cleaned_note: { type: "string" },
              is_blocker: { type: "boolean" },
              blocker_code: {
                type: ["string", "null"],
                enum: [...BLOCKER_CODES, null],
              },
            },
            required: ["cleaned_note", "is_blocker", "blocker_code"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "record_field_note" },
      messages: [
        {
          role: "user",
          content: `${VOICE_NOTE_PROMPT}\n\nTranscript: "${transcript}"`,
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

  return NextResponse.json({
    cleanedNote: toolUse.input.cleaned_note ?? transcript,
    isBlocker: toolUse.input.is_blocker ?? false,
    blockerCode: toolUse.input.blocker_code ?? null,
  });
}
