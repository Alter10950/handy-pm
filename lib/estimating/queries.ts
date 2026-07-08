import { todayIso } from "@/lib/dates";
import {
  computeCrewDays,
  computeProjectLines,
  type EstimateLine,
  type LearnedRate,
  type SkuCategory,
} from "@/lib/estimating/engine";
import {
  forecastFinishFromCrewDays,
  type CrewRateLookup,
  type LaborStandard,
  type RateSource,
} from "@/lib/estimating/labor";
import {
  categoryHoursFromDb,
  materialToLineInput,
  type SkuCatalogEntry,
  type StandardTiers,
} from "@/lib/estimating/standards";
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
    const perTask =
      byCrew.get(rate.crew_id) ?? new Map<string, CrewRateLookup>();
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

  const totals = new Map<
    string,
    { weightedSum: number; totalSamples: number }
  >();
  for (const rate of data) {
    if (rate.units_per_hour === null || rate.samples <= 0) continue;
    const entry = totals.get(rate.task_key) ?? {
      weightedSum: 0,
      totalSamples: 0,
    };
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
//
// scope_items (Batch 4 Sub-phase C) fold into the same two maps, keyed
// by work_type — a bucket disjoint from materials' own task_keys (scope
// items have no task_key of their own, only work_type). A scope item has
// no "qty installed" concept, only a done/partial/not-started status
// (scope_item_progress's own latest-logged-update column) — so its full
// labor_units always counts toward totalByTaskKey, and counts toward
// remainingByTaskKey unless status is 'done'.
export async function getProjectLaborUnitsByTaskKey(
  projectId: string
): Promise<ProjectLaborUnits> {
  const supabase = await createClient();
  const [
    { data: materials, error: materialsError },
    { data: reconciliation, error: reconError },
    { data: scopeItems, error: scopeError },
  ] = await Promise.all([
    supabase
      .from("materials")
      .select("id, task_key, labor_units, total_needed")
      .eq("project_id", projectId),
    supabase
      .from("material_reconciliation")
      .select("material_id, installed")
      .eq("project_id", projectId),
    supabase
      .from("scope_item_progress")
      .select("work_type, labor_units, status")
      .eq("project_id", projectId),
  ]);
  if (materialsError) throw materialsError;
  if (reconError) throw reconError;
  if (scopeError) throw scopeError;

  const installedByMaterial = new Map(
    reconciliation.map((r) => [r.material_id, r.installed])
  );

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
      (remainingByTaskKey.get(material.task_key) ?? 0) +
        remainingQty * material.labor_units
    );
  }

  for (const item of scopeItems) {
    if (!item.work_type || !item.labor_units) continue;
    totalByTaskKey.set(
      item.work_type,
      (totalByTaskKey.get(item.work_type) ?? 0) + item.labor_units
    );
    if (item.status !== "done") {
      remainingByTaskKey.set(
        item.work_type,
        (remainingByTaskKey.get(item.work_type) ?? 0) + item.labor_units
      );
    }
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
  estimatedHours: number; // remaining hours at resolved standards
  estimatedDays: number; // crew-days (shift × efficiency, see engine)
  forecastFinish: string;
  confidence: "high" | "medium" | "low";
  crewCount: number;
  crewIds: string[];
  startDate: string;
  breakdown: TaskKeyBreakdownEntry[];
  /** per-SKU engine lines (Phase 13) — the real detail behind breakdown */
  lines: EstimateLine[];
  /** guardrail warnings — implausible standards/forecasts, never silent */
  engineWarnings: string[];
}

export interface EstimateOptions {
  crewCount?: number;
  crewIds?: string[];
  startDate?: string;
}

// Lean tier view for WRITE paths (material create/update/import): only
// the category defaults — per-SKU/learned tiers don't apply to the
// stored labor_units figure.
export async function loadCategoryTiers(): Promise<StandardTiers> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("labor_standards")
    .select("task_key, base_labor_units, unit_basis");
  if (error) throw error;
  return {
    categoryHours: categoryHoursFromDb(data),
    skuHours: new Map(),
    learned: new Map(),
  };
}

// ── Phase 13 tier loading (ADR-051) ────────────────────────────────────
// labor_standards is the category-default tier (per-each rows only —
// standards.ts filters the poisoned per-linear-ft/per-ft-height seeds).
// The catalog tables may not exist until the corrective migration is
// approved; their reads are guarded so a missing relation degrades to
// read-time parsing instead of erroring.
async function loadStandardTiers(crewIds: string[]): Promise<StandardTiers> {
  const supabase = await createClient();
  const { data: categoryRows, error: categoryError } = await supabase
    .from("labor_standards")
    .select("task_key, base_labor_units, unit_basis");
  if (categoryError) throw categoryError;

  const tiers: StandardTiers = {
    categoryHours: categoryHoursFromDb(categoryRows),
    skuHours: new Map(),
    learned: new Map(),
  };

  const [skuStandards, learnedRates] = await Promise.all([
    supabase.from("sku_labor_standards").select("sku_id, hours_per_unit"),
    supabase
      .from("crew_sku_rates")
      .select("crew_id, sku_id, hours_per_unit, samples"),
  ]);
  // Missing relation (migration not yet applied) → tier stays empty.
  if (!skuStandards.error) {
    for (const row of skuStandards.data) {
      if (row.hours_per_unit > 0)
        tiers.skuHours.set(row.sku_id, row.hours_per_unit);
    }
  }
  if (!learnedRates.error) {
    // Blend to one learned rate per SKU, weighted by samples — scoped to
    // the selected crews when any are picked, company-wide otherwise.
    const scoped =
      crewIds.length > 0
        ? learnedRates.data.filter((r) => crewIds.includes(r.crew_id))
        : learnedRates.data;
    const perSku = new Map<string, { weighted: number; samples: number }>();
    for (const row of scoped) {
      if (row.hours_per_unit <= 0 || row.samples <= 0) continue;
      const entry = perSku.get(row.sku_id) ?? { weighted: 0, samples: 0 };
      entry.weighted += row.hours_per_unit * row.samples;
      entry.samples += row.samples;
      perSku.set(row.sku_id, entry);
    }
    for (const [skuId, { weighted, samples }] of perSku) {
      tiers.learned.set(skuId, {
        hoursPerUnit: weighted / samples,
        samples,
      } satisfies LearnedRate);
    }
  }
  return tiers;
}

async function loadSkuCatalog(): Promise<Map<string, SkuCatalogEntry>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("material_skus")
    .select("id, category, height_in, length_in, weight_lbs, requires_lift");
  if (error) return new Map(); // relation missing until migration lands
  return new Map(
    data.map((row) => [
      row.id,
      {
        category: row.category as SkuCategory,
        heightIn: row.height_in,
        lengthIn: row.length_in,
        weightLbs: row.weight_lbs,
        requiresLift: row.requires_lift,
      },
    ])
  );
}

// The one function both the initial server-rendered Estimate tab and the
// client-side what-if tool call (as a Server Action) — pure read, no
// write, so the what-if tool can call it on every slider tweak without
// persisting anything. Saving a snapshot is a separate, explicit action
// (lib/estimating/actions.ts#saveProjectEstimate).
//
// Phase 13 (ADR-049/051): material hours come from the pure engine on
// typed attributes — per-PIECE standards, size as bounded modifiers,
// learned→SKU→category resolution. The old task_key×crew_rates blend is
// gone: those rates were learned against the poisoned labor_units and
// would re-import the 12× corruption. Scope items keep their stored,
// user-entered labor_units (no size parsing involved).
export async function computeProjectEstimate(
  projectId: string,
  options: EstimateOptions = {}
): Promise<ComputedEstimate> {
  const supabase = await createClient();
  const crewIds = options.crewIds ?? [];

  const [
    { data: materials, error: materialsError },
    { data: reconciliation, error: reconError },
    { data: scopeItems, error: scopeError },
    tiers,
    catalog,
    org,
  ] = await Promise.all([
    // select("*"), NOT an explicit column list: sku_id only exists after
    // the Phase 13 migration is approved — a named select would 400 until
    // then, while * simply omits it (undefined → null downstream).
    supabase.from("materials").select("*").eq("project_id", projectId),
    supabase
      .from("material_reconciliation")
      .select("material_id, installed")
      .eq("project_id", projectId),
    supabase
      .from("scope_item_progress")
      .select("work_type, labor_units, status")
      .eq("project_id", projectId),
    loadStandardTiers(options.crewIds ?? []),
    loadSkuCatalog(),
    getOrgSettings(),
  ]);
  if (materialsError) throw materialsError;
  if (reconError) throw reconError;
  if (scopeError) throw scopeError;

  const installedByMaterial = new Map(
    reconciliation.map((r) => [r.material_id, r.installed])
  );

  const lineInputs = materials.map((material) =>
    materialToLineInput(
      {
        id: material.id,
        name: material.name,
        size: material.size,
        totalNeeded: material.total_needed,
        installed: installedByMaterial.get(material.id) ?? 0,
        skuId: material.sku_id ?? null,
      },
      tiers,
      material.sku_id ? catalog.get(material.sku_id) : null
    )
  );
  const project = computeProjectLines(lineInputs);

  // Scope items (teardown/relocate/…) — stored hours, remaining unless done.
  let scopeTotalHours = 0;
  let scopeRemainingHours = 0;
  const scopeByWorkType = new Map<string, number>();
  for (const item of scopeItems) {
    if (!item.work_type || !item.labor_units) continue;
    scopeTotalHours += item.labor_units;
    if (item.status !== "done") {
      scopeRemainingHours += item.labor_units;
      scopeByWorkType.set(
        item.work_type,
        (scopeByWorkType.get(item.work_type) ?? 0) + item.labor_units
      );
    }
  }

  const workingDaysOfWeek = org?.default_working_days ?? [1, 2, 3, 4, 5];
  const crewCount = options.crewCount ?? Math.max(1, crewIds.length);
  const startDate = options.startDate ?? todayIso();

  const remainingHours = round2(project.remainingHours + scopeRemainingHours);
  const totalHours = round2(project.totalHours + scopeTotalHours);

  const { crewDays, warnings: crewDayWarnings } = computeCrewDays({
    remainingHours,
    crewSize: crewCount,
    shiftHours: 8,
  });
  const { finishDate } = forecastFinishFromCrewDays(
    crewDays,
    crewCount,
    workingDaysOfWeek,
    startDate
  );

  // Confidence = how much of the remaining work is backed by something
  // better than a category default (per-SKU standard or learned rate).
  const coveredHours = project.lines
    .filter((line) => line.source === "learned" || line.source === "sku")
    .reduce((sum, line) => sum + line.remainingHours, 0);
  const coverage = remainingHours > 0 ? coveredHours / remainingHours : 0;
  const confidence: ComputedEstimate["confidence"] =
    coverage >= 0.7 ? "high" : coverage >= 0.3 ? "medium" : "low";

  // Category rollup keeps the persisted-snapshot shape (project_estimates
  // .breakdown) stable across the engine swap.
  const byCategory = new Map<string, { hours: number; source: RateSource }>();
  for (const line of project.lines) {
    if (line.remainingHours <= 0) continue;
    const entry = byCategory.get(line.category) ?? {
      hours: 0,
      source: "standard",
    };
    entry.hours += line.remainingHours;
    if (line.source === "learned") entry.source = "crew";
    else if (line.source === "sku" && entry.source !== "crew")
      entry.source = "company";
    byCategory.set(line.category, entry);
  }
  const breakdown: TaskKeyBreakdownEntry[] = [
    ...[...byCategory.entries()].map(([taskKey, { hours, source }]) => ({
      taskKey,
      laborUnits: round2(hours),
      unitsPerHour: 1,
      hours: round2(hours),
      rateSource: source,
    })),
    ...[...scopeByWorkType.entries()].map(([taskKey, hours]) => ({
      taskKey,
      laborUnits: round2(hours),
      unitsPerHour: 1,
      hours: round2(hours),
      rateSource: "standard" as RateSource,
    })),
  ].sort((a, b) => b.hours - a.hours);

  return {
    fullScopeLaborUnits: totalHours,
    remainingLaborUnits: remainingHours,
    estimatedHours: remainingHours,
    estimatedDays: crewDays,
    forecastFinish: finishDate,
    confidence,
    crewCount,
    crewIds,
    startDate,
    breakdown,
    lines: project.lines,
    engineWarnings: [...project.warnings, ...crewDayWarnings],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
