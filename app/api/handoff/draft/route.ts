import { NextResponse, type NextRequest } from "next/server";

import { requireOrg } from "@/lib/auth/session";
import {
  EMPTY_CONSTRAINTS,
  type HandoffConstraints,
} from "@/lib/handoff/shared";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";

const DRAFT_PROMPT =
  "You are helping a warehouse racking-install company turn an estimator's " +
  "rough freeform site-visit notes into a structured sales-to-ops handoff " +
  "draft. From the notes below, extract: existing_racking_condition (a " +
  "clean sentence or two describing what's already there — condition, " +
  "brand/system if mentioned, damage), teardown_required (true only if " +
  "the notes say existing racking must come down), teardown_notes " +
  "(specifics on what needs to come down, else null), and constraints: " +
  "live_warehouse (is the warehouse operating during install), " +
  "access_notes (dock doors, freight elevators, parking, anything about " +
  "getting in/out), forklift_onsite (will a forklift be available), " +
  "working_hours (any stated time restrictions, as a short phrase), " +
  "floor_condition (concrete condition, cracking, unevenness, etc.), " +
  "permits_needed (true only if permits are mentioned as needed). This is " +
  "a DRAFT the estimator will review and edit before saving — leave a " +
  "field blank/false/null rather than invent something the notes don't " +
  "support.";

interface DraftToolInput {
  existing_racking_condition: string | null;
  teardown_required: boolean;
  teardown_notes: string | null;
  constraints: {
    live_warehouse: boolean;
    access_notes: string;
    forklift_onsite: boolean;
    working_hours: string;
    floor_condition: string;
    permits_needed: boolean;
  };
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  input: DraftToolInput;
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

  const body = (await request.json()) as { notes?: string };
  const notes = body.notes?.trim();
  if (!notes) {
    return NextResponse.json({ error: "notes is required." }, { status: 400 });
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
          name: "record_handoff_draft",
          description:
            "Record a structured sales-to-ops handoff draft extracted from freeform site-visit notes.",
          input_schema: {
            type: "object",
            properties: {
              existing_racking_condition: { type: ["string", "null"] },
              teardown_required: { type: "boolean" },
              teardown_notes: { type: ["string", "null"] },
              constraints: {
                type: "object",
                properties: {
                  live_warehouse: { type: "boolean" },
                  access_notes: { type: "string" },
                  forklift_onsite: { type: "boolean" },
                  working_hours: { type: "string" },
                  floor_condition: { type: "string" },
                  permits_needed: { type: "boolean" },
                },
                required: [
                  "live_warehouse",
                  "access_notes",
                  "forklift_onsite",
                  "working_hours",
                  "floor_condition",
                  "permits_needed",
                ],
              },
            },
            required: [
              "existing_racking_condition",
              "teardown_required",
              "teardown_notes",
              "constraints",
            ],
          },
        },
      ],
      tool_choice: { type: "tool", name: "record_handoff_draft" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `${DRAFT_PROMPT}\n\nNotes:\n${notes}` },
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
  if (!toolUse) {
    return NextResponse.json(
      { error: "The AI didn't return structured data." },
      { status: 502 }
    );
  }

  const input = toolUse.input;
  const constraints: HandoffConstraints = {
    liveWarehouse:
      input.constraints?.live_warehouse ?? EMPTY_CONSTRAINTS.liveWarehouse,
    accessNotes:
      input.constraints?.access_notes ?? EMPTY_CONSTRAINTS.accessNotes,
    forkliftOnsite:
      input.constraints?.forklift_onsite ?? EMPTY_CONSTRAINTS.forkliftOnsite,
    workingHours:
      input.constraints?.working_hours ?? EMPTY_CONSTRAINTS.workingHours,
    floorCondition:
      input.constraints?.floor_condition ?? EMPTY_CONSTRAINTS.floorCondition,
    permitsNeeded:
      input.constraints?.permits_needed ?? EMPTY_CONSTRAINTS.permitsNeeded,
  };

  return NextResponse.json({
    existingRackingCondition: input.existing_racking_condition ?? null,
    teardownRequired: input.teardown_required ?? false,
    teardownNotes: input.teardown_notes ?? null,
    constraints,
  });
}
