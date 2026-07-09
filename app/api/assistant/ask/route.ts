import { NextResponse, type NextRequest } from "next/server";

import { requireOrg } from "@/lib/auth/session";
import { toolsForRole } from "@/lib/assistant/tools";
import { createClient } from "@/lib/supabase/server";

// Batch 5 Sub-phase E: the natural-language assistant. Read-only, answers
// via TOOL-CALLING against the typed, RLS-scoped functions in
// lib/assistant/tools.ts — the model never receives SQL or unscoped data,
// and the tool set is filtered by the caller's role (crew can't reach the
// office-only tools, e.g. crew performance). Gated on ANTHROPIC_API_KEY.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";
const MAX_TURNS = 5;

const SYSTEM = [
  "You are the Handy PM assistant for a warehouse-racking install company.",
  "Answer the user's question ONLY from the tools provided — never guess or",
  "invent numbers. Call tools to gather what you need, then answer in 1–3",
  "short sentences, citing the concrete figures you found (counts, %,",
  "quantities, dates). If the tools return nothing relevant, say you don't",
  "have that data rather than speculating. Never mention SQL, tables, or",
  "tool names in your answer — just the plain-language result.",
].join(" ");

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  let role: "owner" | "pm" | "scheduler" | "crew";
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in.");
    await requireOrg();
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    role = (profile?.role ?? "crew") as typeof role;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Not signed in." },
      { status: 401 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "The assistant isn't configured (no ANTHROPIC_API_KEY)." },
      { status: 503 }
    );
  }

  const body = (await request.json()) as { question?: string };
  const question = (body.question ?? "").trim();
  if (!question) {
    return NextResponse.json(
      { error: "Ask a question first." },
      { status: 400 }
    );
  }

  const tools = toolsForRole(role);
  const toolDefs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));

  const messages: { role: "user" | "assistant"; content: unknown }[] = [
    { role: "user", content: question },
  ];
  const allLinks: { label: string; href: string }[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        tools: toolDefs,
        messages,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json(
        { error: `Assistant error (${response.status}): ${detail}` },
        { status: 502 }
      );
    }
    const data = (await response.json()) as {
      content: AnthropicContentBlock[];
      stop_reason: string;
    };

    const toolUses = data.content.filter((b) => b.type === "tool_use");
    if (data.stop_reason !== "tool_use" || toolUses.length === 0) {
      // Final answer.
      const text = data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n")
        .trim();
      // Dedupe links by href.
      const seen = new Set<string>();
      const links = allLinks.filter((l) =>
        seen.has(l.href) ? false : (seen.add(l.href), true)
      );
      return NextResponse.json({ answer: text, links });
    }

    // Run each requested tool under the caller's RLS session + role.
    messages.push({ role: "assistant", content: data.content });
    const results = [];
    for (const use of toolUses) {
      const tool = tools.find((t) => t.name === use.name);
      let result: unknown = { error: "Unknown or unavailable tool." };
      if (tool) {
        try {
          const out = await tool.run(use.input ?? {}, { role });
          result = out.data;
          if (out.links) allLinks.push(...out.links);
        } catch (err) {
          result = {
            error: err instanceof Error ? err.message : "Tool failed.",
          };
        }
      }
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: results });
  }

  return NextResponse.json({
    answer:
      "That needed more steps than I can take in one go — try narrowing the question.",
    links: [],
  });
}
