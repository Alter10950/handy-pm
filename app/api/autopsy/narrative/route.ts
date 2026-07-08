import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";

const NARRATIVE_PROMPT =
  "You are summarizing a warehouse racking-install project's closeout " +
  "autopsy for the company's own team. Write a candid, plain-language " +
  "narrative of AT MOST 5 short lines: what ran over or under and why " +
  "the numbers suggest it did, and — most importantly — what to do " +
  "differently on the next bid or job. The numbers provided are the " +
  "source of truth; do not invent causes the data can't support, and do " +
  "not soften a clear overrun. No greetings, no headers, just the lines.";

interface AnthropicToolUseBlock {
  type: "tool_use";
  input: { narrative?: string };
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
  // requireRole, not requireOrg — unlike the packing-slip/voice-note
  // routes this one READS office-only data (the autopsy row) to build
  // the prompt, so it carries the same owner/pm gate as that data.
  try {
    await requireRole(["owner", "pm"]);
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

  const body = (await request.json()) as { projectId?: string };
  if (!body.projectId) {
    return NextResponse.json(
      { error: "projectId is required." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const [{ data: autopsy, error }, { data: project, error: projectError }] =
    await Promise.all([
      supabase
        .from("project_autopsies")
        .select("*")
        .eq("project_id", body.projectId)
        .maybeSingle(),
      supabase
        .from("projects")
        .select("name")
        .eq("id", body.projectId)
        .single(),
    ]);
  if (error || projectError) {
    return NextResponse.json(
      { error: "Could not load the autopsy." },
      { status: 500 }
    );
  }
  if (!autopsy) {
    return NextResponse.json(
      {
        error:
          "Generate the autopsy first — the numbers are the source of truth.",
      },
      { status: 400 }
    );
  }

  const numbers = {
    project: project.name,
    days: { estimated: autopsy.estimated_days, actual: autopsy.actual_days },
    productive_hours: {
      estimated: autopsy.estimated_hours,
      actual: autopsy.actual_labor_hours,
    },
    labor_units: {
      estimated: autopsy.estimated_labor_units,
      actual: autopsy.actual_labor_units,
    },
    change_orders: {
      count: autopsy.change_order_count,
      added_days: autopsy.change_order_days,
    },
    blocker_days_total: autopsy.blocker_days,
    blocker_days_by_code: autopsy.blocker_breakdown,
    material_variance: autopsy.material_variance,
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
      max_tokens: 512,
      tools: [
        {
          name: "record_narrative",
          description:
            "Record the closeout-autopsy narrative (max 5 short lines).",
          input_schema: {
            type: "object",
            properties: { narrative: { type: "string" } },
            required: ["narrative"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "record_narrative" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${NARRATIVE_PROMPT}\n\nAutopsy numbers:\n${JSON.stringify(numbers, null, 2)}`,
            },
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
  const toolUse = data.content.find(isToolUseBlock);
  if (!toolUse?.input.narrative) {
    return NextResponse.json(
      { error: "The AI didn't return a narrative." },
      { status: 502 }
    );
  }

  return NextResponse.json({ narrative: toolUse.input.narrative });
}
