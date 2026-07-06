import { NextResponse, type NextRequest } from "next/server";

import { requireOrg } from "@/lib/auth/session";
import type { ComputedEstimate } from "@/lib/estimating/queries";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";

const EXPLAIN_PROMPT =
  "Here is a computed labor estimate for a warehouse racking install " +
  "project, as JSON. Explain it in 3-5 short sentences for a project " +
  "manager: what drives the hours, which rate source was used for the " +
  "biggest task_key contributors (a crew's own learned rate, a company-wide " +
  "blend, or the un-sampled standard pace), and what would most improve the " +
  "confidence level. Numbers in the JSON are ground truth — do not invent, " +
  "recompute, or round them differently than given. Plain text only, no " +
  "markdown headers.";

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicMessageResponse {
  content: AnthropicTextBlock[];
}

export async function POST(request: NextRequest) {
  // Same explicit-gate pattern as the packing-slip/voice-note AI routes
  // (ADR-027) — a clean 401 rather than an uncaught exception.
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

  const body = (await request.json()) as { estimate?: ComputedEstimate };
  if (!body.estimate) {
    return NextResponse.json({ error: "estimate is required." }, { status: 400 });
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
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXPLAIN_PROMPT },
            { type: "text", text: JSON.stringify(body.estimate) },
          ],
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
  const explanation = data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!explanation) {
    return NextResponse.json(
      { error: "The AI didn't return an explanation." },
      { status: 502 }
    );
  }

  return NextResponse.json({ explanation });
}
