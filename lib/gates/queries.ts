import {
  computeNextActions,
  isProjectStalled,
  STAGE_ORDER,
  type NextAction,
  type ProjectGateItemWithHints,
  type ProjectStageWithItems,
  type TemplateStageWithItems,
} from "@/lib/gates/shared";
import { getOrgSettings } from "@/lib/org/queries";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export * from "@/lib/gates/shared";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

// Shared by getProjectLifecycle (one project) and listOrgWideNextActions
// (every active project, batch-fetched) — looks up each item's
// requiresPhoto/requiresSignoffRole display hint from its template
// origin, grouped by project_stage_id.
async function attachTemplateHints(
  supabase: ServerSupabaseClient,
  items: Tables<"project_gate_items">[]
): Promise<Map<string, ProjectGateItemWithHints[]>> {
  const templateItemIds = [
    ...new Set(
      items.map((i) => i.template_item_id).filter((id): id is string => id !== null)
    ),
  ];
  const { data: templateItems, error } =
    templateItemIds.length > 0
      ? await supabase
          .from("gate_template_items")
          .select("id, requires_photo, requires_signoff_role")
          .in("id", templateItemIds)
      : { data: [] as { id: string; requires_photo: boolean; requires_signoff_role: string | null }[], error: null };
  if (error) throw error;
  const templateItemById = new Map(templateItems.map((t) => [t.id, t]));

  const itemsByStage = new Map<string, ProjectGateItemWithHints[]>();
  for (const item of items) {
    const hint = item.template_item_id ? templateItemById.get(item.template_item_id) : null;
    const list = itemsByStage.get(item.project_stage_id) ?? [];
    list.push({
      ...item,
      requiresPhoto: hint?.requires_photo ?? false,
      requiresSignoffRole: hint?.requires_signoff_role ?? null,
    });
    itemsByStage.set(item.project_stage_id, list);
  }
  return itemsByStage;
}

export async function getDefaultGateTemplateId(orgId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("gate_templates")
    .select("id")
    .eq("org_id", orgId)
    .eq("is_default", true)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function getTemplateStagesWithItems(
  templateId: string
): Promise<TemplateStageWithItems[]> {
  const supabase = await createClient();
  const { data: stages, error: stagesError } = await supabase
    .from("gate_template_stages")
    .select("*")
    .eq("template_id", templateId)
    .order("position");
  if (stagesError) throw stagesError;
  if (stages.length === 0) return [];

  const stageIds = stages.map((s) => s.id);
  const { data: items, error: itemsError } = await supabase
    .from("gate_template_items")
    .select("*")
    .in("template_stage_id", stageIds)
    .order("position");
  if (itemsError) throw itemsError;

  const itemsByStage = new Map<string, Tables<"gate_template_items">[]>();
  for (const item of items) {
    const list = itemsByStage.get(item.template_stage_id) ?? [];
    list.push(item);
    itemsByStage.set(item.template_stage_id, list);
  }
  return stages.map((s) => ({ ...s, items: itemsByStage.get(s.id) ?? [] }));
}

// Ordered by STAGE_ORDER, not created_at — every project_stages row is
// inserted together by ensureProjectStages, so insertion order isn't a
// reliable proxy for the stage sequence.
export async function getProjectLifecycle(
  projectId: string
): Promise<ProjectStageWithItems[]> {
  const supabase = await createClient();
  const { data: stages, error: stagesError } = await supabase
    .from("project_stages")
    .select("*")
    .eq("project_id", projectId);
  if (stagesError) throw stagesError;
  if (stages.length === 0) return [];

  const stageIds = stages.map((s) => s.id);
  const { data: items, error: itemsError } = await supabase
    .from("project_gate_items")
    .select("*")
    .in("project_stage_id", stageIds)
    .order("position");
  if (itemsError) throw itemsError;

  const itemsByStage = await attachTemplateHints(supabase, items);
  const byKey = new Map(stages.map((s) => [s.stage_key, s]));
  return STAGE_ORDER.filter((key) => byKey.has(key)).map((key) => {
    const stage = byKey.get(key)!;
    return { ...stage, items: itemsByStage.get(stage.id) ?? [] };
  });
}

export interface OrgNextActionsSummary {
  projectId: string;
  projectName: string;
  isStalled: boolean;
  daysSinceActivity: number;
  actions: NextAction[];
}

// Dashboard-level fan-out — mirrors lib/dashboard/queries.ts's own
// batch-fetch-then-group-in-memory convention (see its file header)
// rather than calling getProjectLifecycle once per active project, which
// would repeat its same N+1 shape against project_stages/
// project_gate_items company-wide. Only returns projects that actually
// need attention (something overdue, or genuinely stalled) — the same
// "exceptions only" convention as listShortagesAcrossProjects/
// listUnresolvedBlockersAcrossProjects, not a redundant full project list
// (the dashboard's main list already shows every active project).
export async function listOrgWideNextActions(): Promise<OrgNextActionsSummary[]> {
  const supabase = await createClient();
  const org = await getOrgSettings();
  const stalledAfterDays = org?.stalled_after_days ?? 3;

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, name, last_activity_at")
    .eq("status", "active");
  if (projectsError) throw projectsError;
  if (projects.length === 0) return [];

  const projectIds = projects.map((p) => p.id);
  const { data: stages, error: stagesError } = await supabase
    .from("project_stages")
    .select("*")
    .in("project_id", projectIds);
  if (stagesError) throw stagesError;

  const stageIds = stages.map((s) => s.id);
  const { data: items, error: itemsError } =
    stageIds.length > 0
      ? await supabase
          .from("project_gate_items")
          .select("*")
          .in("project_stage_id", stageIds)
          .order("position")
      : { data: [] as Tables<"project_gate_items">[], error: null };
  if (itemsError) throw itemsError;

  const itemsByStage = await attachTemplateHints(supabase, items);
  const stagesByProject = new Map<string, Tables<"project_stages">[]>();
  for (const stage of stages) {
    const list = stagesByProject.get(stage.project_id) ?? [];
    list.push(stage);
    stagesByProject.set(stage.project_id, list);
  }

  const summaries = projects.map((project) => {
    const byKey = new Map(
      (stagesByProject.get(project.id) ?? []).map((s) => [s.stage_key, s])
    );
    const lifecycle = STAGE_ORDER.filter((key) => byKey.has(key)).map((key) => {
      const stage = byKey.get(key)!;
      return { ...stage, items: itemsByStage.get(stage.id) ?? [] };
    });
    const daysSinceActivity = Math.floor(
      (Date.now() - new Date(project.last_activity_at).getTime()) / 86_400_000
    );
    return {
      projectId: project.id,
      projectName: project.name,
      isStalled: isProjectStalled(project.last_activity_at, stalledAfterDays),
      daysSinceActivity,
      actions: computeNextActions(lifecycle),
    };
  });

  return summaries
    .filter((s) => s.isStalled || s.actions.some((a) => a.isOverdue))
    .sort((a, b) => {
      if (a.isStalled !== b.isStalled) return a.isStalled ? -1 : 1;
      const aOverdue = a.actions.filter((x) => x.isOverdue).length;
      const bOverdue = b.actions.filter((x) => x.isOverdue).length;
      if (aOverdue !== bOverdue) return bOverdue - aOverdue;
      return a.projectName.localeCompare(b.projectName);
    });
}
