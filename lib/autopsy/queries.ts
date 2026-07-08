import { createClient } from "@/lib/supabase/server";
import type { AutopsyRow } from "@/lib/autopsy/shared";

export * from "@/lib/autopsy/shared";

export async function getAutopsy(
  projectId: string
): Promise<AutopsyRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_autopsies")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface CompanyAutopsyEntry {
  projectId: string;
  projectName: string;
  createdAt: string;
  daysPct: number | null; // signed variance %, actual vs estimated
  laborUnitsPct: number | null;
  changeOrderCount: number;
  blockerDays: number;
}

// Every autopsy across the org, newest first — the "estimate accuracy
// trending" company view (ADR-046): bids get sharper by seeing where
// they've been landing.
export async function listCompanyAutopsies(): Promise<CompanyAutopsyEntry[]> {
  const supabase = await createClient();
  const { data: autopsies, error } = await supabase
    .from("project_autopsies")
    .select(
      "project_id, created_at, estimated_days, actual_days, estimated_labor_units, actual_labor_units, change_order_count, blocker_days"
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (autopsies.length === 0) return [];

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, name")
    .in(
      "id",
      autopsies.map((a) => a.project_id)
    );
  if (projectsError) throw projectsError;
  const nameById = new Map(projects.map((p) => [p.id, p.name]));

  const pctOf = (
    estimated: number | null,
    actual: number | null
  ): number | null =>
    estimated !== null && actual !== null && estimated > 0
      ? Math.round(((actual - estimated) / estimated) * 100)
      : null;

  return autopsies.map((a) => ({
    projectId: a.project_id,
    projectName: nameById.get(a.project_id) ?? "Unknown project",
    createdAt: a.created_at,
    daysPct: pctOf(a.estimated_days, a.actual_days),
    laborUnitsPct: pctOf(a.estimated_labor_units, a.actual_labor_units),
    changeOrderCount: a.change_order_count,
    blockerDays: a.blocker_days,
  }));
}

export interface LaborStandardDivergence {
  taskKey: string;
  learnedUnitsPerHour: number;
  crews: number;
  // >0: crews are FASTER than the seed assumes (seed pessimistic);
  // <0: slower (seed optimistic — quotes will run over).
  divergencePct: number;
}

// labor_standards whose seeds diverge from learned reality: 1 labor unit
// is defined as 1 hour at standard pace, so a company-blended learned
// rate far from 1.0 units/hour means the seed hours-per-unit is wrong by
// about that factor. Only rates with enough samples to trust (same
// MIN_SAMPLES bar the estimator itself uses) are counted.
export async function listLaborStandardDivergence(): Promise<
  LaborStandardDivergence[]
> {
  const supabase = await createClient();
  const { data: rates, error } = await supabase
    .from("crew_rates")
    .select("task_key, units_per_hour, samples")
    .gte("samples", 3);
  if (error) throw error;
  if (rates.length === 0) return [];

  const byTask = new Map<string, { total: number; count: number }>();
  for (const rate of rates) {
    if (rate.units_per_hour === null) continue;
    const entry = byTask.get(rate.task_key) ?? { total: 0, count: 0 };
    entry.total += rate.units_per_hour;
    entry.count += 1;
    byTask.set(rate.task_key, entry);
  }

  return [...byTask.entries()]
    .map(([taskKey, { total, count }]) => {
      const learned = total / count;
      return {
        taskKey,
        learnedUnitsPerHour: Math.round(learned * 100) / 100,
        crews: count,
        divergencePct: Math.round((learned - 1) * 100),
      };
    })
    .filter((entry) => Math.abs(entry.divergencePct) > 25)
    .sort((a, b) => Math.abs(b.divergencePct) - Math.abs(a.divergencePct));
}
