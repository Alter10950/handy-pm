"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireOrg, requireRole } from "@/lib/auth/session";
import { ensureOriginalEstimate } from "@/lib/change-orders/actions";
import { recomputeCrewSkuRates } from "@/lib/estimating/flywheel";
import { ROLLING_WINDOW_DAYS } from "@/lib/estimating/labor";
import {
  computeProjectEstimate,
  type ComputedEstimate,
} from "@/lib/estimating/queries";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

// Matches labor_standards_write/crew_rates_write/project_estimates_write
// RLS exactly — estimating is scheduler-adjacent, not owner/pm-only.
const ESTIMATORS = ["owner", "pm", "scheduler"] as const;
// Matches projects_insert/update RLS (PROJECT_EDITORS in lib/projects/actions.ts).
const PROJECT_EDITORS = ["owner", "pm"] as const;

export async function updateLaborStandard(
  id: string,
  patch: Partial<{ base_labor_units: number; unit_basis: string }>
) {
  await requireRole(ESTIMATORS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("labor_standards")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/app/estimate");
}

export interface RecomputeCrewRatesResult {
  crewsUpdated: number;
  taskKeysUpdated: number;
  /** per-SKU flywheel pass (Phase 15) — null until its tables exist */
  skuFlywheel: { crewsUpdated: number; skusUpdated: number } | null;
}

// Relearns crew_rates.units_per_hour from the last ROLLING_WINDOW_DAYS of
// install history: for each day_log with both install_start and
// install_end set, allocate that day's hours across whichever task_keys
// were actually installed that (crew, project, day), weighted by each
// task_key's own share of that day's labor units — the same "no per-task
// time-tracking exists, so attribute proportionally to output" reasoning
// ADR-022/029 already used for target/capacity splitting. Days with a
// blocker logged for that (crew, project, date) are excluded entirely: a
// day the crew couldn't work normally would otherwise read as terrible
// productivity and drag the average down unfairly. See ADR-030.
export async function recomputeCrewRates(): Promise<RecomputeCrewRatesResult> {
  await requireRole(ESTIMATORS);
  const supabase = await createClient();

  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - ROLLING_WINDOW_DAYS);
  const windowStartStr = windowStart.toISOString().slice(0, 10);

  const [
    { data: dayLogs, error: dayLogsError },
    { data: blockers, error: blockersError },
  ] = await Promise.all([
    supabase
      .from("day_logs")
      .select("crew_id, project_id, work_date, install_start, install_end")
      .gte("work_date", windowStartStr)
      .not("crew_id", "is", null)
      .not("install_start", "is", null)
      .not("install_end", "is", null),
    supabase
      .from("blockers")
      .select("project_id, crew_id, work_date")
      .gte("work_date", windowStartStr)
      .not("crew_id", "is", null),
  ]);
  if (dayLogsError) throw dayLogsError;
  if (blockersError) throw blockersError;

  const blockedKeys = new Set(
    blockers.map((b) => `${b.crew_id}|${b.project_id}|${b.work_date}`)
  );
  const qualifyingLogs = dayLogs.filter(
    (log) =>
      !blockedKeys.has(`${log.crew_id}|${log.project_id}|${log.work_date}`)
  );
  if (qualifyingLogs.length === 0) {
    // Still run the per-SKU flywheel — installs may exist on days whose
    // day_log lacked start/end times in the window edge cases; it applies
    // its own qualifying rules.
    const skuFlywheelEarly = await runSkuFlywheel();
    return {
      crewsUpdated: 0,
      taskKeysUpdated: 0,
      skuFlywheel: skuFlywheelEarly,
    };
  }

  const projectIds = [...new Set(qualifyingLogs.map((l) => l.project_id))];
  const workDates = [...new Set(qualifyingLogs.map((l) => l.work_date))];

  const [
    { data: rows, error: rowsError },
    { data: installs, error: installsError },
  ] = await Promise.all([
    supabase.from("rows").select("id, project_id").in("project_id", projectIds),
    supabase
      .from("installs")
      .select("row_id, material_id, qty, crew_id, installed_on")
      .in("installed_on", workDates)
      .not("crew_id", "is", null),
  ]);
  if (rowsError) throw rowsError;
  if (installsError) throw installsError;

  const projectIdByRow = new Map(rows.map((r) => [r.id, r.project_id]));
  const materialIds = [...new Set(installs.map((i) => i.material_id))];
  const { data: materials, error: materialsError } =
    materialIds.length > 0
      ? await supabase
          .from("materials")
          .select("id, task_key, labor_units")
          .in("id", materialIds)
      : {
          data: [] as { id: string; task_key: string; labor_units: number }[],
          error: null,
        };
  if (materialsError) throw materialsError;
  const materialById = new Map(materials.map((m) => [m.id, m]));

  // Labor units installed per (crew, project, day, task_key).
  const laborByDayKey = new Map<string, Map<string, number>>();
  for (const install of installs) {
    const projectId = projectIdByRow.get(install.row_id);
    if (!projectId) continue;
    const material = materialById.get(install.material_id);
    if (!material) continue;
    const dayKey = `${install.crew_id}|${projectId}|${install.installed_on}`;
    const perTask = laborByDayKey.get(dayKey) ?? new Map<string, number>();
    perTask.set(
      material.task_key,
      (perTask.get(material.task_key) ?? 0) + install.qty * material.labor_units
    );
    laborByDayKey.set(dayKey, perTask);
  }

  const perCrew = new Map<
    string,
    Map<string, { laborUnits: number; hours: number; days: number }>
  >();
  for (const log of qualifyingLogs) {
    const dayKey = `${log.crew_id}|${log.project_id}|${log.work_date}`;
    const perTask = laborByDayKey.get(dayKey);
    if (!perTask) continue; // hours logged but nothing installed — no signal to learn from
    const totalLaborUnits = [...perTask.values()].reduce((a, b) => a + b, 0);
    if (totalLaborUnits <= 0) continue;
    const hoursThatDay =
      (new Date(log.install_end!).getTime() -
        new Date(log.install_start!).getTime()) /
      3_600_000;
    if (hoursThatDay <= 0) continue;

    const crewMap = perCrew.get(log.crew_id!) ?? new Map();
    for (const [taskKey, laborUnits] of perTask) {
      const allocatedHours = hoursThatDay * (laborUnits / totalLaborUnits);
      const entry = crewMap.get(taskKey) ?? {
        laborUnits: 0,
        hours: 0,
        days: 0,
      };
      entry.laborUnits += laborUnits;
      entry.hours += allocatedHours;
      entry.days += 1;
      crewMap.set(taskKey, entry);
    }
    perCrew.set(log.crew_id!, crewMap);
  }

  const upserts: {
    crew_id: string;
    task_key: string;
    units_per_hour: number;
    samples: number;
  }[] = [];
  const taskKeysSeen = new Set<string>();
  for (const [crewId, taskMap] of perCrew) {
    for (const [taskKey, entry] of taskMap) {
      if (entry.hours <= 0) continue;
      taskKeysSeen.add(taskKey);
      upserts.push({
        crew_id: crewId,
        task_key: taskKey,
        units_per_hour: entry.laborUnits / entry.hours,
        samples: entry.days,
      });
    }
  }

  if (upserts.length > 0) {
    const { error: upsertError } = await supabase
      .from("crew_rates")
      .upsert(upserts, { onConflict: "crew_id,task_key" });
    if (upsertError) throw upsertError;
  }

  revalidatePath("/app/estimate");
  revalidatePath("/scheduler/calendar");
  const skuFlywheel = await runSkuFlywheel();
  return {
    crewsUpdated: perCrew.size,
    taskKeysUpdated: taskKeysSeen.size,
    skuFlywheel,
  };

  // One button, both learners: the task-key tier (above, legacy) and the
  // Phase 15 per-SKU tier. The flywheel guards its own table existence.
}

async function runSkuFlywheel(): Promise<
  RecomputeCrewRatesResult["skuFlywheel"]
> {
  const result = await recomputeCrewSkuRates();
  return result.available
    ? { crewsUpdated: result.crewsUpdated, skusUpdated: result.skusUpdated }
    : null;
}

// Read-only — called directly from the what-if tool (client component) on
// every crew-count/crew-picker tweak, same "Server Action as a callable
// read" precedent as lib/scheduler/actions.ts#checkDoubleBooking. Nothing
// is persisted until saveProjectEstimate below.
export async function computeEstimatePreview(
  projectId: string,
  options: { crewCount?: number; crewIds?: string[] } = {}
): Promise<ComputedEstimate> {
  await requireOrg();
  return computeProjectEstimate(projectId, options);
}

export async function saveProjectEstimate(
  projectId: string,
  options: { crewCount?: number; crewIds?: string[] } = {}
) {
  await requireRole(ESTIMATORS);
  const estimate = await computeProjectEstimate(projectId, options);

  const supabase = await createClient();
  const { error } = await supabase.from("project_estimates").insert({
    project_id: projectId,
    estimated_labor_units: estimate.fullScopeLaborUnits,
    estimated_hours: estimate.estimatedHours,
    estimated_days: estimate.estimatedDays,
    forecast_finish: estimate.forecastFinish,
    confidence: estimate.confidence,
    // TaskKeyBreakdownEntry is a plain-data interface (string/number
    // fields only) but isn't structurally assignable to Json's index
    // signature without a cast — this data genuinely is JSON-safe.
    assumptions: {
      crew_count: estimate.crewCount,
      crew_ids: estimate.crewIds,
      start_date: estimate.startDate,
      hours_per_crew_day: 8,
      remaining_labor_units: estimate.remainingLaborUnits,
      breakdown: estimate.breakdown,
    } as unknown as Json,
  });
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}/estimate`);
}

export async function createEstimateProject(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Estimate name is required.");

  const { userId, orgId } = await requireRole(PROJECT_EDITORS);
  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      org_id: orgId,
      name,
      status: "estimate",
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw error;

  revalidatePath("/app/estimate");
  redirect(`/app/project/${project.id}/materials`);
}

export async function convertEstimateToActive(projectId: string) {
  await requireRole(PROJECT_EDITORS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ status: "active" })
    .eq("id", projectId)
    .eq("status", "estimate");
  if (error) throw error;

  // Conversion is the moment "the estimate" becomes "the deal" — snapshot
  // it as the original-estimate baseline change orders are measured
  // against (ADR-043). Idempotent; projects created directly active get
  // theirs lazily at first CO send/approval instead.
  await ensureOriginalEstimate(projectId);

  revalidatePath("/app/estimate");
  revalidatePath(`/app/project/${projectId}`);
  redirect(`/app/project/${projectId}`);
}
