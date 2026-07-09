import { getCompanyRatesByTaskKey } from "@/lib/estimating/queries";
import { resolveRate, type CrewRateLookup } from "@/lib/estimating/labor";
import { createClient } from "@/lib/supabase/server";
import type { Tables, Views } from "@/lib/supabase/database.types";

// resolveRate is called here with crewId=null (project-level, not
// per-crew), so its crewRates lookup is never actually consulted — a
// shared empty Map avoids reallocating one on every reduce iteration.
const EMPTY_CREW_RATES = new Map<string, Map<string, CrewRateLookup>>();

export async function listAssignments(
  projectId: string
): Promise<Tables<"assignments">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assignments")
    .select("*")
    .eq("project_id", projectId)
    .order("work_date");
  if (error) throw error;
  return data;
}

export async function listProjectSchedule(
  projectId: string
): Promise<Tables<"project_schedule">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_schedule")
    .select("*")
    .eq("project_id", projectId)
    .order("work_date");
  if (error) throw error;
  return data;
}

export async function listTargets(
  projectId: string
): Promise<Tables<"targets">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("targets")
    .select("*")
    .eq("project_id", projectId)
    .order("work_date");
  if (error) throw error;
  return data;
}

// Materials remaining to *install* — assigned (required across rows) minus
// installed so far. Deliberately not material_reconciliation.left_qty:
// that column is needed-minus-assigned (procurement — "still needs to be
// ordered/allocated to a row"), a different number from "how much of what's
// already assigned still needs to go in the wall."
export async function listRemainingByMaterial(
  projectId: string
): Promise<{ materialId: string; name: string; remaining: number }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("material_reconciliation")
    .select("material_id, name, assigned, installed")
    .eq("project_id", projectId);
  if (error) throw error;
  return data.map((row) => ({
    materialId: row.material_id,
    name: row.name,
    remaining: Math.max(0, row.assigned - row.installed),
  }));
}

// Actual installed qty per day, summed across all materials — the
// Scheduler cares about total daily output vs. target, not a
// material-by-material breakdown (that's the Materials tab's job).
export async function getDailyActuals(
  projectId: string
): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data: rows, error: rowsError } = await supabase
    .from("rows")
    .select("id")
    .eq("project_id", projectId);
  if (rowsError) throw rowsError;
  const rowIds = rows.map((row) => row.id);
  if (rowIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("installs")
    .select("installed_on, qty")
    .in("row_id", rowIds);
  if (error) throw error;

  const totals = new Map<string, number>();
  for (const install of data) {
    totals.set(
      install.installed_on,
      (totals.get(install.installed_on) ?? 0) + install.qty
    );
  }
  return totals;
}

// Actual installed qty per (crew, day) — same shape as getDailyActuals,
// split one level further for the per-crew SPI view. installs.crew_id
// is nullable (a delta logged with no crew picked); those are excluded
// here since there's no crew to attribute them to.
export async function getCrewDailyActuals(
  projectId: string
): Promise<Map<string, Map<string, number>>> {
  const supabase = await createClient();
  const { data: rows, error: rowsError } = await supabase
    .from("rows")
    .select("id")
    .eq("project_id", projectId);
  if (rowsError) throw rowsError;
  const rowIds = rows.map((row) => row.id);
  if (rowIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("installs")
    .select("installed_on, qty, crew_id")
    .in("row_id", rowIds)
    .not("crew_id", "is", null);
  if (error) throw error;

  const byCrew = new Map<string, Map<string, number>>();
  for (const install of data) {
    const crewId = install.crew_id!;
    const perDate = byCrew.get(crewId) ?? new Map<string, number>();
    perDate.set(
      install.installed_on,
      (perDate.get(install.installed_on) ?? 0) + install.qty
    );
    byCrew.set(crewId, perDate);
  }
  return byCrew;
}

export async function getProjectWithSchedule(
  projectId: string
): Promise<Views<"project_progress"> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_progress")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Remaining ACTUAL crew-hours for a project — assigned-minus-installed per
// material (same "remaining" as listRemainingByMaterial), grouped by
// task_key and converted from standard labor units (1 = 1 standard hour)
// to real hours via the company-wide blended crew_rates for that task_key.
// Sub-phase D's own upgrade of what was a flat "labor_units read 1:1 as
// hours" placeholder (ADR-029) — this is a per-PROJECT blended figure, not
// per-crew, because getProjectDailyLaborLoad is computed once per project
// before the calendar knows which specific crew a given cell belongs to;
// see ADR-030 for why that's an intentional, documented simplification
// rather than a per-crew-accurate capacity check. Falls back to the
// standard pace (1.0) per task_key wherever no crew has any install
// history yet — identical to the pre-sub-phase-D numbers until then.
// scope_items (Batch 4 Sub-phase C) fold into the same remaining-hours
// figure — a not-yet-'done' item's full labor_units, resolved through
// the same resolveRate(work_type, ...) path materials use (work_type
// doubles as the task_key here; labor_standards was seeded with
// matching keys — see 20260707160000_scope_labor_standards.sql). No
// "assigned vs installed" concept for scope items, only done/not-done.
export async function getProjectRemainingLaborUnits(
  projectId: string
): Promise<number> {
  const supabase = await createClient();
  const [
    { data: materials, error: materialsError },
    { data: reconciliation, error: reconError },
    { data: scopeItems, error: scopeError },
    companyRates,
  ] = await Promise.all([
    supabase
      .from("materials")
      .select("id, task_key, labor_units")
      .eq("project_id", projectId),
    supabase
      .from("material_reconciliation")
      .select("material_id, assigned, installed")
      .eq("project_id", projectId),
    supabase
      .from("scope_item_progress")
      .select("work_type, labor_units, status")
      .eq("project_id", projectId),
    getCompanyRatesByTaskKey(),
  ]);
  if (materialsError) throw materialsError;
  if (reconError) throw reconError;
  if (scopeError) throw scopeError;

  const materialById = new Map(materials.map((m) => [m.id, m]));
  const materialsHours = reconciliation.reduce((sum, row) => {
    const material = materialById.get(row.material_id);
    if (!material) return sum;
    const remaining = Math.max(0, row.assigned - row.installed);
    const standardUnits = remaining * material.labor_units;
    const { unitsPerHour } = resolveRate(
      material.task_key,
      null,
      EMPTY_CREW_RATES,
      companyRates
    );
    return sum + standardUnits / unitsPerHour;
  }, 0);

  const scopeHours = scopeItems.reduce((sum, item) => {
    if (!item.work_type || !item.labor_units || item.status === "done")
      return sum;
    const { unitsPerHour } = resolveRate(
      item.work_type,
      null,
      EMPTY_CREW_RATES,
      companyRates
    );
    return sum + item.labor_units / unitsPerHour;
  }, 0);

  return materialsHours + scopeHours;
}

// A project's remaining labor, spread evenly across its remaining
// scheduled days from today forward — same "no rule specified, split
// evenly" reasoning generateTargets already uses for material qty
// (ADR-022), applied to labor units instead.
export async function getProjectDailyLaborLoad(
  projectId: string
): Promise<number> {
  const [remainingUnits, schedule] = await Promise.all([
    getProjectRemainingLaborUnits(projectId),
    listProjectSchedule(projectId),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const upcomingDays = schedule.filter((s) => s.work_date >= today).length;
  if (upcomingDays === 0) return 0;
  return remainingUnits / upcomingDays;
}

export interface OrgAssignment {
  id: string;
  projectId: string;
  projectName: string;
  crewId: string;
  crewName: string;
  rowId: string | null;
  workDate: string;
}

// Every crew's assignments across every active project within a date
// range — the cross-project calendar's whole reason for being (the
// per-project WeekView only ever shows one project at a time). Flat
// selects + JS-side joins, not embedded-resource syntax, matching this
// codebase's established convention.
export async function listOrgAssignmentsInRange(
  startDate: string,
  endDate: string
): Promise<OrgAssignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assignments")
    .select("id, project_id, crew_id, row_id, work_date")
    .gte("work_date", startDate)
    .lte("work_date", endDate)
    .not("crew_id", "is", null);
  if (error) throw error;

  const projectIds = [...new Set(data.map((a) => a.project_id))];
  const crewIds = [...new Set(data.map((a) => a.crew_id!))];
  const [
    { data: projects, error: projectsError },
    { data: crews, error: crewsError },
  ] = await Promise.all([
    projectIds.length > 0
      ? supabase.from("projects").select("id, name").in("id", projectIds)
      : Promise.resolve({
          data: [] as { id: string; name: string }[],
          error: null,
        }),
    crewIds.length > 0
      ? supabase.from("crews").select("id, name").in("id", crewIds)
      : Promise.resolve({
          data: [] as { id: string; name: string }[],
          error: null,
        }),
  ]);
  if (projectsError) throw projectsError;
  if (crewsError) throw crewsError;

  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
  const crewNameById = new Map(crews.map((c) => [c.id, c.name]));

  return data.map((a) => ({
    id: a.id,
    projectId: a.project_id,
    projectName: projectNameById.get(a.project_id) ?? "Unknown project",
    crewId: a.crew_id!,
    crewName: crewNameById.get(a.crew_id!) ?? "Unknown crew",
    rowId: a.row_id,
    workDate: a.work_date,
  }));
}

// Every phase's date range, inferred from when its rows were actually
// assigned to a crew (not a stored start/end — phases have no date
// columns of their own). Powers the project timeline (Gantt-style)
// view: a phase with no assignments yet simply has no bar to draw.
export interface PhaseTimelineEntry {
  phaseId: string;
  startDate: string;
  endDate: string;
  crewIds: string[];
}

export async function getPhaseTimelines(
  projectId: string
): Promise<PhaseTimelineEntry[]> {
  const supabase = await createClient();
  const [
    { data: rows, error: rowsError },
    { data: assignments, error: assignError },
  ] = await Promise.all([
    supabase.from("rows").select("id, phase_id").eq("project_id", projectId),
    supabase
      .from("assignments")
      .select("row_id, crew_id, work_date")
      .eq("project_id", projectId),
  ]);
  if (rowsError) throw rowsError;
  if (assignError) throw assignError;

  const phaseByRow = new Map(rows.map((r) => [r.id, r.phase_id]));
  // A whole-project assignment (row_id null) covers every phase that day.
  const allPhaseIds = [
    ...new Set(
      rows.map((r) => r.phase_id).filter((id): id is string => id !== null)
    ),
  ];

  const byPhase = new Map<
    string,
    { dates: Set<string>; crewIds: Set<string> }
  >();
  function record(phaseId: string, workDate: string, crewId: string | null) {
    const entry = byPhase.get(phaseId) ?? {
      dates: new Set(),
      crewIds: new Set(),
    };
    entry.dates.add(workDate);
    if (crewId) entry.crewIds.add(crewId);
    byPhase.set(phaseId, entry);
  }

  for (const assignment of assignments) {
    if (assignment.row_id === null) {
      for (const phaseId of allPhaseIds)
        record(phaseId, assignment.work_date, assignment.crew_id);
    } else {
      const phaseId = phaseByRow.get(assignment.row_id);
      if (phaseId) record(phaseId, assignment.work_date, assignment.crew_id);
    }
  }

  return [...byPhase.entries()].map(([phaseId, entry]) => {
    const dates = [...entry.dates].sort();
    return {
      phaseId,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      crewIds: [...entry.crewIds],
    };
  });
}

// ── Schedule board (design pass v3 F1) ────────────────────────────────

// Every project's committed schedule days in a range — feeds the board's
// capacity math (distinct projects per day, ADR-044) and its over-
// capacity column wash.
export interface OrgScheduleDay {
  projectId: string;
  workDate: string;
}

export async function listOrgScheduleInRange(
  startDate: string,
  endDate: string
): Promise<OrgScheduleDay[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_schedule")
    .select("project_id, work_date")
    .gte("work_date", startDate)
    .lte("work_date", endDate);
  if (error) throw error;
  return data.map((row) => ({
    projectId: row.project_id,
    workDate: row.work_date,
  }));
}

// Blockers in a date range — the board's delay-day markers (a red tick on
// the bar with the code/note as its reason).
export interface BoardBlocker {
  projectId: string;
  workDate: string;
  code: string;
  note: string | null;
  resolvedAt: string | null;
}

export async function listBlockersInRange(
  startDate: string,
  endDate: string
): Promise<BoardBlocker[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blockers")
    .select("project_id, work_date, code, note, resolved_at")
    .gte("work_date", startDate)
    .lte("work_date", endDate);
  if (error) throw error;
  return data.map((row) => ({
    projectId: row.project_id,
    workDate: row.work_date,
    code: row.code,
    note: row.note,
    resolvedAt: row.resolved_at,
  }));
}

// The board's project metadata in one query: deadlines drive the
// milestone diamonds, planned_days sizes a tray drop before an estimate
// exists.
export interface BoardProjectMeta {
  id: string;
  name: string;
  deadline: string | null;
  plannedDays: number | null;
}

export async function listBoardProjectMeta(): Promise<BoardProjectMeta[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, deadline, planned_days")
    .eq("status", "active")
    .order("name");
  if (error) throw error;
  return data.map((p) => ({
    id: p.id,
    name: p.name,
    deadline: p.deadline,
    plannedDays: p.planned_days,
  }));
}
