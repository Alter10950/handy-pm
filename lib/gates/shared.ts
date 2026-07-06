// Pure types/constants/functions with ZERO server-only imports — safe to
// import from a Client Component. lib/gates/queries.ts (the actual
// Supabase-querying functions) imports lib/supabase/server.ts, which pulls
// in next/headers; a Client Component importing anything from that module
// at all — even just a type or constant — drags the whole module (and
// next/headers) into the client bundle and fails the build. Split here so
// components/gates/lifecycle-panel.tsx can import STAGE_LABEL and the
// ProjectStageWithItems type without also importing the server-only query
// functions that happen to live alongside them.
import { todayIso } from "@/lib/dates";
import type { GateStageKey, Tables } from "@/lib/supabase/database.types";

export const STAGE_ORDER: GateStageKey[] = [
  "handoff",
  "scope",
  "schedule",
  "materials",
  "mobilize",
  "execute",
  "punch",
  "closeout",
];

export const STAGE_LABEL: Record<GateStageKey, string> = {
  handoff: "Handoff",
  scope: "Scope",
  schedule: "Schedule",
  materials: "Materials",
  mobilize: "Mobilize",
  execute: "Execute",
  punch: "Punch",
  closeout: "Closeout",
};

export interface TemplateStageWithItems extends Tables<"gate_template_stages"> {
  items: Tables<"gate_template_items">[];
}

// requiresPhoto/requiresSignoffRole are display-only hints read from the
// item's own template origin (custom, per-project-added items have
// neither, since there's no template_item_id to look them up from) — the
// actual enforcement lives server-side in lib/gates/actions.ts, this is
// just so the UI can show the right controls without duplicating that
// logic.
export interface ProjectGateItemWithHints extends Tables<"project_gate_items"> {
  requiresPhoto: boolean;
  requiresSignoffRole: string | null;
}

export interface ProjectStageWithItems extends Tables<"project_stages"> {
  items: ProjectGateItemWithHints[];
}

export interface NextAction {
  itemId: string;
  stageKey: GateStageKey;
  label: string;
  dueDate: string | null;
  isOverdue: boolean;
}

// Top 3 open items of the active stage + anything overdue anywhere in the
// project (an overridden stage can still carry an incomplete-but-overdue
// item worth surfacing) — de-duplicated, since an active-stage item can
// also itself be overdue.
export function computeNextActions(lifecycle: ProjectStageWithItems[]): NextAction[] {
  const today = todayIso();
  const activeStage = lifecycle.find((s) => s.status === "active");

  const activeOpen = (activeStage?.items ?? [])
    .filter((i) => !i.done)
    .slice(0, 3)
    .map((i) => ({ item: i, stageKey: activeStage!.stage_key }));

  const overdue = lifecycle.flatMap((stage) =>
    stage.items
      .filter((i) => !i.done && i.due_date && i.due_date < today)
      .map((i) => ({ item: i, stageKey: stage.stage_key }))
  );

  const seen = new Set<string>();
  const result: NextAction[] = [];
  for (const { item, stageKey } of [...activeOpen, ...overdue]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push({
      itemId: item.id,
      stageKey,
      label: item.label,
      dueDate: item.due_date,
      isOverdue: Boolean(item.due_date && item.due_date < today),
    });
  }
  return result;
}

export function isProjectStalled(
  lastActivityAt: string,
  stalledAfterDays: number
): boolean {
  const msSinceActivity = Date.now() - new Date(lastActivityAt).getTime();
  return msSinceActivity > stalledAfterDays * 24 * 60 * 60 * 1000;
}
