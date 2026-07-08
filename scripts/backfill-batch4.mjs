// Batch 4 Sub-phase J: backfill EXISTING projects' lifecycle stages
// safely (see docs/DECISIONS.md ADR-047). Idempotent: only touches
// ACTIVE projects that have NO project_stages rows at all — anything
// already bootstrapped (by opening its Overview post-Batch-4) or
// walked forward by real usage is left alone.
//
// Position is EVIDENCE-based, so a job mid-execution never gets locked
// behind gates that didn't exist when it started:
//   installs logged            -> execute
//   schedule committed         -> materials
//   layout rows exist          -> schedule  (sold + laid out = handoff/scope de-facto done)
//   otherwise                  -> handoff   (true new-style start)
// Every stage BEFORE the position is marked overridden with reason
// 'pre-Batch-4 backfill' — visible on the dashboard's override list,
// exactly like any other accountable skip.
//
// Run with: node --env-file=.env.local scripts/backfill-batch4.mjs

import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const admin = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const STAGE_ORDER = [
  "handoff",
  "scope",
  "schedule",
  "materials",
  "mobilize",
  "execute",
  "punch",
  "closeout",
];

async function determinePosition(projectId) {
  const { data: rows, error: rowsError } = await admin
    .from("rows")
    .select("id")
    .eq("project_id", projectId);
  if (rowsError) throw rowsError;

  if (rows.length > 0) {
    const { count, error: installsError } = await admin
      .from("installs")
      .select("id", { count: "exact", head: true })
      .in(
        "row_id",
        rows.map((r) => r.id)
      );
    if (installsError) throw installsError;
    if ((count ?? 0) > 0) return "execute";
  }

  const { count: scheduleCount, error: scheduleError } = await admin
    .from("project_schedule")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (scheduleError) throw scheduleError;
  if ((scheduleCount ?? 0) > 0) return "materials";

  if (rows.length > 0) return "schedule";
  return "handoff";
}

async function bootstrapStages(projectId, orgId) {
  const { data: template, error: templateError } = await admin
    .from("gate_templates")
    .select("id")
    .eq("org_id", orgId)
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();
  if (templateError) throw templateError;
  if (!template) return false;

  const { data: templateStages, error: stagesError } = await admin
    .from("gate_template_stages")
    .select("id, stage_key, position")
    .eq("template_id", template.id)
    .order("position");
  if (stagesError) throw stagesError;

  for (const stage of templateStages) {
    const { data: projectStage, error: insertError } = await admin
      .from("project_stages")
      .insert({
        project_id: projectId,
        stage_key: stage.stage_key,
        status: stage.stage_key === "handoff" ? "active" : "locked",
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    const { data: items, error: itemsError } = await admin
      .from("gate_template_items")
      .select("id, label, position")
      .eq("template_stage_id", stage.id)
      .order("position");
    if (itemsError) throw itemsError;
    if (items.length > 0) {
      const { error: itemInsertError } = await admin
        .from("project_gate_items")
        .insert(
          items.map((item) => ({
            project_stage_id: projectStage.id,
            template_item_id: item.id,
            label: item.label,
            position: item.position,
          }))
        );
      if (itemInsertError) throw itemInsertError;
    }
  }
  return true;
}

async function main() {
  const { data: projects, error } = await admin
    .from("projects")
    .select("id, name, org_id, status")
    .eq("status", "active");
  if (error) throw error;

  const results = [];
  for (const project of projects) {
    const { data: existing, error: existingError } = await admin
      .from("project_stages")
      .select("id")
      .eq("project_id", project.id)
      .limit(1);
    if (existingError) throw existingError;
    if (existing.length > 0) {
      results.push({ project: project.name, action: "skipped (stages exist)" });
      continue;
    }

    const bootstrapped = await bootstrapStages(project.id, project.org_id);
    if (!bootstrapped) {
      results.push({ project: project.name, action: "skipped (no template)" });
      continue;
    }

    const position = await determinePosition(project.id);
    const positionIndex = STAGE_ORDER.indexOf(position);
    const priorStages = STAGE_ORDER.slice(0, positionIndex);

    if (priorStages.length > 0) {
      const { error: overrideError } = await admin
        .from("project_stages")
        .update({
          status: "overridden",
          override_reason: "pre-Batch-4 backfill",
          completed_at: new Date().toISOString(),
        })
        .eq("project_id", project.id)
        .in("stage_key", priorStages);
      if (overrideError) throw overrideError;
    }
    const { error: activateError } = await admin
      .from("project_stages")
      .update({ status: "active" })
      .eq("project_id", project.id)
      .eq("stage_key", position);
    if (activateError) throw activateError;

    const { error: projectError } = await admin
      .from("projects")
      .update({ stage_key: position })
      .eq("id", project.id);
    if (projectError) throw projectError;

    results.push({
      project: project.name,
      action: `backfilled -> ${position}`,
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
