import { todayIso } from "@/lib/dates";
import {
  computeConfidence,
  forecastFinishDate,
  resolveRate,
  type CrewRateLookup,
  type LaborStandard,
  type RateSource,
} from "@/lib/estimating/labor";
import { getOrgSettings } from "@/lib/org/queries";
import { createClient } from "@/lib/supabase/server";
import type { Tables, Views } from "@/lib/supabase/database.types";

export async function listLaborStandards(): Promise<
  Tables<"labor_standards">[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("labor_standards")
    .select("*")
    .order("task_key");
  if (error) throw error;
  return data;
}

export async function loadLaborStandardsMap(): Promise<
  Map<string, LaborStandard>
> {
  const standards = await listLaborStandards();
  return new Map(
    standards.map((s) => [
      s.task_key,
      { baseLaborUnits: s.base_labor_units, unitBasis: s.unit_basis },
    ])
  );
}

export async function listCrewRates(): Promise<Tables<"crew_rates">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crew_rates")
    .select("*")
    .order("task_key");
  if (error) throw error;
  return data;
}

// crewId -> task_key -> {unitsPerHour, samples}. Small table (crews ×
// recognized task_keys), safe to fetch whole and index in memory.
export async function getCrewRatesLookup(): Promise<
  Map<string, Map<string, CrewRateLookup>>
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crew_rates")
    .select("crew_id, task_key, units_per_hour, samples");
  if (error) throw error;

  const byCrew = new Map<string, Map<string, CrewRateLookup>>();
  for (const rate of data) {
    if (rate.units_per_hour === null) continue;
    const perTask = byCrew.get(rate.crew_id) ?? new Map<string, CrewRateLookup>();
    perTask.set(rate.task_key, {
      unitsPerHour: rate.units_per_hour,
      samples: rate.samples,
    });
    byCrew.set(rate.crew_id, perTask);
  }
  return byCrew;
}

// Company-wide blended rate per task_key, weighted by each crew_rates row's
// own sample count — cheap (reads the already-learned crew_rates table,
// not the raw install/day-log history recomputeCrewRates draws from).
export async function getCompanyRatesByTaskKey(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crew_rates")
    .select("task_key, units_per_hour, samples");
  if (error) throw error;

  const totals = new Map<string, { weightedSum: number; totalSamples: number }>();
  for (const rate of data) {
    if (rate.units_per_hour === null || rate.samples <= 0) continue;
    const entry = totals.get(rate.task_key) ?? { weightedSum: 0, totalSamples: 0 };
    entry.weightedSum += rate.units_per_hour * rate.samples;
    entry.totalSamples += rate.samples;
    totals.set(rate.task_key, entry);
  }
  return new Map(
    [...totals.entries()]
      .filter(([, { totalSamples }]) => totalSamples > 0)
      .map(([taskKey, { weightedSum, totalSamples }]) => [
        taskKey,
        weightedSum / totalSamples,
      ])
  );
}

export interface ProjectLaborUnits {
  totalByTaskKey: Map<string, number>; // full scope, from total_needed
  remainingByTaskKey: Map<string, number>; // total_needed minus installed
}

// Two different "how much labor" numbers: `totalByTaskKey` is the whole
// job's scope (sum of every material's total_needed), available even for
// a pre-sale draft with no rows/drawing at all; `remainingByTaskKey` is
// what's left to actually finish (total_needed minus installed-so-far).
// Deliberately NOT the scheduler's assigned-minus-installed figure
// (lib/scheduler/queries.ts#getProjectRemainingLaborUnits) — that one
// answers "how much of what's already been mapped onto specific rows is
// ready to schedule right now," a narrower, day-to-day question. This one
// answers "how much of the whole project is left," which is what a
// forecast-to-finish needs — the two agree once every material has been
// fully assigned to rows, but diverge early in a project's life (or for a
// draft with no rows at all, where assigned is always 0).
// material_reconciliation.installed is already capped at assigned <=
// total_needed, so total_needed - installed can never go negative.
export async function getProjectLaborUnitsByTaskKey(
  projectId: string
): Promise<ProjectLaborUnits> {
  const supabase = await createClient();
  const [{ data: materials, error: materialsError }, { data: reconciliation, error: reconError }] =
    await Promise.all([
      supabase
        .from("materials")
        .select("id, task_key, labor_units, total_needed")
        .eq("project_id", projectId),
      supabase
        .from("material_reconciliation")
        .select("material_id, installed")
        .eq("project_id", projectId),
    ]);
  if (materialsError) throw materialsError;
  if (reconError) throw reconError;

  const installedByMaterial = new Map(reconciliation.map((r) => [r.material_id, r.installed]));

  const totalByTaskKey = new Map<string, number>();
  const remainingByTaskKey = new Map<string, number>();
  for (const material of materials) {
    const totalUnits = material.total_needed * material.labor_units;
    totalByTaskKey.set(
      material.task_key,
      (totalByTaskKey.get(material.task_key) ?? 0) + totalUnits
    );

    const installed = installedByMaterial.get(material.id) ?? 0;
    const remainingQty = Math.max(0, material.total_needed - installed);
    remainingByTaskKey.set(
      material.task_key,
      (remainingByTaskKey.get(material.task_key) ?? 0) + remainingQty * material.labor_units
    );
  }
  return { totalByTaskKey, remainingByTaskKey };
}

export async function listProjectEstimates(
  projectId: string
): Promise<Tables<"project_estimates">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_estimates")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function listEstimateProjects(): Promise<
  Views<"project_progress">[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_progress")
    .select("*")
    .eq("status", "estimate")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export interface TaskKeyBreakdownEntry {
  taskKey: string;
  laborUnits: number;
  unitsPerHour: number;
  hours: number;
  rateSource: RateSource;
}

export interface ComputedEstimate {
  fullScopeLaborUnits: number;
  remainingLaborUnits: number;
  estimatedHours: number; // remaining, at resolved rates
  estimatedDays: number; // crew-days (estimatedHours / HOURS_PER_CREW_DAY)
  forecastFinish: string;
  confidence: "high" | "medium" | "low";
  crewCount: number;
  crewIds: string[];
  startDate: string;
  breakdown: TaskKeyBreakdownEntry[];
}

export interface EstimateOptions {
  crewCount?: number;
  crewIds?: string[];
  startDate?: string;
}

// The one function both the initial server-rendered Estimate tab and the
// client-side what-if tool call (as a Server Action) — pure read, no
// write, so the what-if tool can call it on every slider tweak without
// persisting anything. Saving a snapshot is a separate, explicit action
// (lib/estimating/actions.ts#saveProjectEstimate).
export async function computeProjectEstimate(
  projectId: string,
  options: EstimateOptions = {}
): Promise<ComputedEstimate> {
  const [{ totalByTaskKey, remainingByTaskKey }, crewRates, companyRates, org] =
    await Promise.all([
      getProjectLaborUnitsByTaskKey(projectId),
      getCrewRatesLookup(),
      getCompanyRatesByTaskKey(),
      getOrgSettings(),
    ]);

  const workingDaysOfWeek = org?.default_working_days ?? [1, 2, 3, 4, 5];
  const crewIds = options.crewIds ?? [];
  const crewCount = options.crewCount ?? Math.max(1, crewIds.length);
  const startDate = options.startDate ?? todayIso();

  const breakdown: TaskKeyBreakdownEntry[] = [];
  let estimatedHours = 0;
  for (const [taskKey, laborUnits] of remainingByTaskKey) {
    if (laborUnits <= 0) continue;
    // Blend across every selected crew's own resolved rate for this task —
    // same "no rule specified, split/blend evenly" posture as ADR-022/029.
    const resolved =
      crewIds.length > 0
        ? crewIds.map((crewId) => resolveRate(taskKey, crewId, crewRates, companyRates))
        : [resolveRate(taskKey, null, crewRates, companyRates)];
    const avgRate =
      resolved.reduce((sum, r) => sum + r.unitsPerHour, 0) / resolved.length;
    const hours = laborUnits / avgRate;
    estimatedHours += hours;
    breakdown.push({
      taskKey,
      laborUnits,
      unitsPerHour: avgRate,
      hours,
      rateSource: resolved[0].source,
    });
  }

  const fullScopeLaborUnits = [...totalByTaskKey.values()].reduce((a, b) => a + b, 0);
  const remainingLaborUnits = [...remainingByTaskKey.values()].reduce((a, b) => a + b, 0);
  const { finishDate, crewDaysNeeded } = forecastFinishDate(
    estimatedHours,
    crewCount,
    workingDaysOfWeek,
    startDate
  );
  const confidence = computeConfidence(remainingByTaskKey, crewIds, crewRates, companyRates);

  return {
    fullScopeLaborUnits,
    remainingLaborUnits,
    estimatedHours,
    estimatedDays: crewDaysNeeded,
    forecastFinish: finishDate,
    confidence,
    crewCount,
    crewIds,
    startDate,
    breakdown,
  };
}
