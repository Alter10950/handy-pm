import { todayIso } from "@/lib/dates";
import { getCrewRatesLookup } from "@/lib/estimating/queries";
import { listOrgAssignmentsInRange } from "@/lib/scheduler/queries";
import {
  classifySpi,
  computeProjectSpi,
  type RiskTier,
} from "@/lib/scheduler/spi";
import { createClient } from "@/lib/supabase/server";
import type { BlockerCode, Tables } from "@/lib/supabase/database.types";
import { listTeamMembers } from "@/lib/team/queries";

export interface DashboardProject {
  projectId: string;
  name: string;
  pct: number;
  spi: number | null;
  riskTier: RiskTier;
  assignedCrewNames: string[];
  forecastFinish: string | null;
  deadline: string | null;
  pmName: string | null;
}

// The office dashboard's main list — every active project with enough
// signal to triage at a glance. Was deliberately N+1 (one targets/actuals
// fetch per project via the existing per-project scheduler functions) to
// guarantee this dashboard's SPI numbers stayed identical to the
// per-project Scheduler page rather than risk a second computation
// quietly drifting from the first — correct, but ~4 round trips per
// active project, real at 20+. Fixed by batch-fetching targets/rows/
// installs/estimates for every project in one query each (`.in(...)`),
// grouping in memory, then calling the SAME `computeProjectSpi` per
// project from that already-fetched data — identical computation, zero
// drift risk, just far fewer round trips.
export async function listActiveProjectsForDashboard(): Promise<
  DashboardProject[]
> {
  const supabase = await createClient();
  const { data: projects, error } = await supabase
    .from("project_progress")
    .select("*")
    .eq("status", "active")
    .order("name");
  if (error) throw error;
  if (projects.length === 0) return [];

  const projectIds = projects.map((p) => p.project_id);
  const today = todayIso();

  const [
    { data: allTargets, error: targetsError },
    { data: allRows, error: rowsError },
    assignmentsToday,
    { data: allEstimates, error: estimatesError },
    teamMembers,
  ] = await Promise.all([
    supabase.from("targets").select("*").in("project_id", projectIds),
    supabase.from("rows").select("id, project_id").in("project_id", projectIds),
    listOrgAssignmentsInRange(today, today),
    supabase
      .from("project_estimates")
      .select("project_id, forecast_finish, created_at")
      .in("project_id", projectIds)
      .order("created_at", { ascending: false }),
    listTeamMembers(),
  ]);
  if (targetsError) throw targetsError;
  if (rowsError) throw rowsError;
  if (estimatesError) throw estimatesError;
  const pmNameById = new Map(
    teamMembers.map((m) => [m.id, m.fullName || m.email])
  );

  const rowIds = allRows.map((r) => r.id);
  const { data: allInstalls, error: installsError } =
    rowIds.length > 0
      ? await supabase
          .from("installs")
          .select("row_id, installed_on, qty")
          .in("row_id", rowIds)
      : {
          data: [] as { row_id: string; installed_on: string; qty: number }[],
          error: null,
        };
  if (installsError) throw installsError;

  const targetsByProject = new Map<string, Tables<"targets">[]>();
  for (const target of allTargets) {
    const list = targetsByProject.get(target.project_id) ?? [];
    list.push(target);
    targetsByProject.set(target.project_id, list);
  }

  const projectIdByRow = new Map(allRows.map((r) => [r.id, r.project_id]));
  const actualsByProject = new Map<string, Map<string, number>>();
  for (const install of allInstalls) {
    const projectId = projectIdByRow.get(install.row_id);
    if (!projectId) continue;
    const dateMap =
      actualsByProject.get(projectId) ?? new Map<string, number>();
    dateMap.set(
      install.installed_on,
      (dateMap.get(install.installed_on) ?? 0) + install.qty
    );
    actualsByProject.set(projectId, dateMap);
  }

  // Ordered newest-first, so the first row seen per project is its latest.
  const forecastByProject = new Map<string, string | null>();
  for (const estimate of allEstimates) {
    if (!forecastByProject.has(estimate.project_id)) {
      forecastByProject.set(estimate.project_id, estimate.forecast_finish);
    }
  }

  const crewNamesByProject = new Map<string, Set<string>>();
  for (const a of assignmentsToday) {
    const set = crewNamesByProject.get(a.projectId) ?? new Set<string>();
    set.add(a.crewName);
    crewNamesByProject.set(a.projectId, set);
  }

  return projects.map((p) => {
    const spi = computeProjectSpi(
      targetsByProject.get(p.project_id) ?? [],
      actualsByProject.get(p.project_id) ?? new Map()
    );
    return {
      projectId: p.project_id,
      name: p.name,
      pct: p.pct,
      spi,
      riskTier: classifySpi(spi),
      assignedCrewNames: [...(crewNamesByProject.get(p.project_id) ?? [])],
      forecastFinish: forecastByProject.get(p.project_id) ?? null,
      deadline: p.deadline,
      pmName: p.pm_user_id ? (pmNameById.get(p.pm_user_id) ?? null) : null,
    };
  });
}

export interface DashboardShortage {
  projectId: string;
  projectName: string;
  materialId: string;
  materialName: string;
  toOrder: number;
}

// Materials still needing an order across EVERY active project — the
// project-scoped equivalent already exists per-project on the Materials
// tab (material_reconciliation.to_order); this is the same figure,
// fanned out across the whole company so an office user doesn't have to
// click into each project to find what's short.
export async function listShortagesAcrossProjects(): Promise<
  DashboardShortage[]
> {
  const supabase = await createClient();
  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("status", "active");
  if (projectsError) throw projectsError;
  if (projects.length === 0) return [];

  const projectIds = projects.map((p) => p.id);
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  const { data, error } = await supabase
    .from("material_reconciliation")
    .select("project_id, material_id, name, to_order")
    .in("project_id", projectIds)
    .gt("to_order", 0)
    .order("to_order", { ascending: false });
  if (error) throw error;

  return data.map((row) => ({
    projectId: row.project_id,
    projectName: projectNameById.get(row.project_id) ?? "Unknown project",
    materialId: row.material_id,
    materialName: row.name,
    toOrder: row.to_order,
  }));
}

export interface DashboardBlocker {
  id: string;
  projectId: string;
  projectName: string;
  crewName: string | null;
  code: BlockerCode;
  note: string | null;
  workDate: string;
  createdAt: string;
}

// Every unresolved blocker across every active project, oldest first —
// the longer one has sat open, the more it needs escalating. Nothing in
// this codebase set/read `blockers.resolved_at` before this sub-phase
// (schema-only since Batch 2); see resolveBlocker below for the other
// half of that gap.
export async function listUnresolvedBlockersAcrossProjects(): Promise<
  DashboardBlocker[]
> {
  const supabase = await createClient();
  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("status", "active");
  if (projectsError) throw projectsError;
  if (projects.length === 0) return [];

  const projectIds = projects.map((p) => p.id);
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  const { data: blockers, error } = await supabase
    .from("blockers")
    .select("id, project_id, crew_id, code, note, work_date, created_at")
    .in("project_id", projectIds)
    .is("resolved_at", null)
    .order("work_date", { ascending: true });
  if (error) throw error;

  const crewIds = [
    ...new Set(
      blockers.map((b) => b.crew_id).filter((id): id is string => id !== null)
    ),
  ];
  const { data: crews, error: crewsError } =
    crewIds.length > 0
      ? await supabase.from("crews").select("id, name").in("id", crewIds)
      : { data: [] as { id: string; name: string }[], error: null };
  if (crewsError) throw crewsError;
  const crewNameById = new Map(crews.map((c) => [c.id, c.name]));

  return blockers.map((b) => ({
    id: b.id,
    projectId: b.project_id,
    projectName: projectNameById.get(b.project_id) ?? "Unknown project",
    crewName: b.crew_id ? (crewNameById.get(b.crew_id) ?? null) : null,
    code: b.code,
    note: b.note,
    workDate: b.work_date,
    createdAt: b.created_at,
  }));
}

export type CrewPerformanceTier = "over" | "normal" | "under" | "no-data";

export interface DashboardCrewPerformance {
  crewId: string;
  crewName: string;
  blendedRate: number | null;
  totalSamples: number;
  tier: CrewPerformanceTier;
}

// Reuses the estimation brain's already-learned crew_rates (sub-phase D)
// instead of re-deriving a second per-crew productivity figure from
// targets/installs — crew_rates IS the company's best available signal
// for "how fast is this crew, really," blended across every task_key
// they have samples for (weighted by each rate's own sample count).
export async function getCrewPerformanceSummary(): Promise<
  DashboardCrewPerformance[]
> {
  const supabase = await createClient();
  const [{ data: crews, error: crewsError }, crewRates] = await Promise.all([
    supabase.from("crews").select("id, name").order("name"),
    getCrewRatesLookup(),
  ]);
  if (crewsError) throw crewsError;

  return crews.map((crew) => {
    const rates = crewRates.get(crew.id);
    if (!rates || rates.size === 0) {
      return {
        crewId: crew.id,
        crewName: crew.name,
        blendedRate: null,
        totalSamples: 0,
        tier: "no-data" as const,
      };
    }
    let weightedSum = 0;
    let totalSamples = 0;
    for (const rate of rates.values()) {
      weightedSum += rate.unitsPerHour * rate.samples;
      totalSamples += rate.samples;
    }
    const blendedRate = totalSamples > 0 ? weightedSum / totalSamples : null;
    const tier: CrewPerformanceTier =
      blendedRate === null
        ? "no-data"
        : blendedRate >= 1.05
          ? "over"
          : blendedRate >= 0.85
            ? "normal"
            : "under";
    return {
      crewId: crew.id,
      crewName: crew.name,
      blendedRate,
      totalSamples,
      tier,
    };
  });
}

export interface TodayActivity {
  installsToday: { projectId: string; projectName: string; qty: number }[];
  newBlockersToday: number;
  crewsWorkingToday: string[];
}

// "What changed today" — derived entirely from the existing event-
// sourced tables (installs, blockers, day_logs), not a new audit-log
// table: every fact this section needs already has an event-sourced
// home, so a new one would just be a slower-to-trust duplicate.
export async function getTodayActivitySummary(): Promise<TodayActivity> {
  const supabase = await createClient();
  const today = todayIso();

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("status", "active");
  if (projectsError) throw projectsError;
  if (projects.length === 0) {
    return { installsToday: [], newBlockersToday: 0, crewsWorkingToday: [] };
  }
  const projectIds = projects.map((p) => p.id);
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  const { data: rows, error: rowsError } = await supabase
    .from("rows")
    .select("id, project_id")
    .in("project_id", projectIds);
  if (rowsError) throw rowsError;
  const projectIdByRow = new Map(rows.map((r) => [r.id, r.project_id]));
  const rowIds = rows.map((r) => r.id);

  const [
    { data: installs, error: installsError },
    { data: blockersToday, error: blockersError },
    { data: dayLogsToday, error: dayLogsError },
  ] = await Promise.all([
    rowIds.length > 0
      ? supabase
          .from("installs")
          .select("row_id, qty")
          .in("row_id", rowIds)
          .eq("installed_on", today)
      : Promise.resolve({
          data: [] as { row_id: string; qty: number }[],
          error: null,
        }),
    supabase
      .from("blockers")
      .select("id")
      .in("project_id", projectIds)
      .eq("work_date", today),
    supabase
      .from("day_logs")
      .select("crew_id")
      .in("project_id", projectIds)
      .eq("work_date", today)
      .not("crew_id", "is", null),
  ]);
  if (installsError) throw installsError;
  if (blockersError) throw blockersError;
  if (dayLogsError) throw dayLogsError;

  const qtyByProject = new Map<string, number>();
  for (const install of installs) {
    const projectId = projectIdByRow.get(install.row_id);
    if (!projectId) continue;
    qtyByProject.set(
      projectId,
      (qtyByProject.get(projectId) ?? 0) + install.qty
    );
  }

  const crewIdsToday = [
    ...new Set(
      dayLogsToday
        .map((d) => d.crew_id)
        .filter((id): id is string => id !== null)
    ),
  ];
  const { data: crews, error: crewsError } =
    crewIdsToday.length > 0
      ? await supabase.from("crews").select("id, name").in("id", crewIdsToday)
      : { data: [] as { id: string; name: string }[], error: null };
  if (crewsError) throw crewsError;

  return {
    installsToday: [...qtyByProject.entries()].map(([projectId, qty]) => ({
      projectId,
      projectName: projectNameById.get(projectId) ?? "Unknown project",
      qty,
    })),
    newBlockersToday: blockersToday.length,
    crewsWorkingToday: crews.map((c) => c.name),
  };
}
