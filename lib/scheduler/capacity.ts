import { addDays } from "@/lib/dates";
import { getOrgSettings } from "@/lib/org/queries";
import { createClient } from "@/lib/supabase/server";

// The capacity model, deliberately coarse (ADR-044): one scheduled
// project-day consumes one crew for that day — a project with work
// scheduled on a date needs at least one crew there, so the number of
// DISTINCT active projects scheduled on any date can't exceed
// organizations.num_crews. Assignments (which crew, exactly) stay a
// separate, finer-grained concern; this gate is about not promising two
// customers the same crew-day in the first place.

export interface CapacityConflictDay {
  date: string;
  projectNames: string[];
}

export interface CapacityCheck {
  conflicts: CapacityConflictDay[];
  suggestedStart: string | null;
  numCrews: number;
}

export async function checkScheduleCapacity(
  projectId: string,
  dates: string[]
): Promise<CapacityCheck> {
  const org = await getOrgSettings();
  const numCrews = org?.num_crews ?? 2;
  const workingDays = new Set(org?.default_working_days ?? [1, 2, 3, 4, 5]);
  if (dates.length === 0)
    return { conflicts: [], suggestedStart: null, numCrews };

  const supabase = await createClient();
  const sorted = [...dates].sort();
  const rangeStart = sorted[0];
  // The forward scan for a suggestion needs occupancy well past the
  // requested window — fetch a year out in one query.
  const rangeEnd = addDays(sorted[sorted.length - 1], 365);

  const { data: scheduleRows, error } = await supabase
    .from("project_schedule")
    .select("work_date, project_id")
    .neq("project_id", projectId)
    .gte("work_date", rangeStart)
    .lte("work_date", rangeEnd);
  if (error) throw error;

  const otherProjectIds = [...new Set(scheduleRows.map((r) => r.project_id))];
  const { data: projects, error: projectsError } =
    otherProjectIds.length > 0
      ? await supabase
          .from("projects")
          .select("id, name, status")
          .in("id", otherProjectIds)
      : {
          data: [] as { id: string; name: string; status: string }[],
          error: null,
        };
  if (projectsError) throw projectsError;
  // Only active projects consume crews — an estimate draft or a
  // completed job holding old schedule rows shouldn't block anyone.
  const activeNameById = new Map(
    projects.filter((p) => p.status === "active").map((p) => [p.id, p.name])
  );

  const projectsByDate = new Map<string, Set<string>>();
  for (const row of scheduleRows) {
    if (!activeNameById.has(row.project_id)) continue;
    const set = projectsByDate.get(row.work_date) ?? new Set<string>();
    set.add(row.project_id);
    projectsByDate.set(row.work_date, set);
  }

  const conflicts: CapacityConflictDay[] = [];
  for (const date of sorted) {
    const others = projectsByDate.get(date);
    if (others && others.size + 1 > numCrews) {
      conflicts.push({
        date,
        projectNames: [...others].map((id) => activeNameById.get(id)!).sort(),
      });
    }
  }
  if (conflicts.length === 0) {
    return { conflicts: [], suggestedStart: null, numCrews };
  }

  // First feasible start: the earliest start date from which a run of
  // the same LENGTH fits entirely within capacity, walking the org's
  // working days. Bounded scan — if a year out is still full, the
  // suggestion honestly comes back null rather than lying.
  const runLength = sorted.length;
  let suggestedStart: string | null = null;
  let candidate = addDays(rangeStart, 1);
  const scanLimit = addDays(rangeStart, 365);
  while (candidate <= scanLimit && !suggestedStart) {
    const run: string[] = [];
    let cursor = candidate;
    while (run.length < runLength && cursor <= rangeEnd) {
      const weekday = new Date(`${cursor}T00:00:00Z`).getUTCDay();
      if (workingDays.has(weekday)) run.push(cursor);
      cursor = addDays(cursor, 1);
    }
    if (run.length < runLength) break;
    const fits = run.every((date) => {
      const others = projectsByDate.get(date);
      return !others || others.size + 1 <= numCrews;
    });
    if (fits) suggestedStart = candidate;
    else candidate = addDays(candidate, 1);
  }

  return { conflicts, suggestedStart, numCrews };
}

export interface CapacityOverrideSummary {
  projectId: string;
  projectName: string;
  reason: string;
  conflictDates: string[];
  createdByName: string | null;
  createdAt: string;
}

// Every capacity override on an active project, org-wide — the same
// "exceptions only, batch-fetched" dashboard convention as
// listOverriddenStages (ADR-042): the override is the accountable escape
// hatch, and visibility is what keeps it accountable.
export async function listCapacityOverrides(): Promise<
  CapacityOverrideSummary[]
> {
  const supabase = await createClient();
  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("status", "active");
  if (projectsError) throw projectsError;
  if (projects.length === 0) return [];
  const nameById = new Map(projects.map((p) => [p.id, p.name]));

  const { data: overrides, error } = await supabase
    .from("capacity_overrides")
    .select("project_id, reason, conflict_dates, created_by, created_at")
    .in(
      "project_id",
      projects.map((p) => p.id)
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (overrides.length === 0) return [];

  const userIds = [
    ...new Set(
      overrides
        .map((o) => o.created_by)
        .filter((id): id is string => id !== null)
    ),
  ];
  const { data: profiles, error: profilesError } =
    userIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds)
      : { data: [] as { id: string; full_name: string | null }[], error: null };
  if (profilesError) throw profilesError;
  const profileNameById = new Map(profiles.map((p) => [p.id, p.full_name]));

  return overrides.map((o) => ({
    projectId: o.project_id,
    projectName: nameById.get(o.project_id) ?? "Unknown project",
    reason: o.reason,
    conflictDates: o.conflict_dates,
    createdByName: o.created_by
      ? (profileNameById.get(o.created_by) ?? null)
      : null,
    createdAt: o.created_at,
  }));
}

export interface CapacityBoardDay {
  date: string;
  // Distinct active projects scheduled this day.
  scheduled: { projectId: string; projectName: string }[];
  overCapacity: boolean;
}

export interface CapacityBoardAssignment {
  crewId: string;
  workDate: string;
  projectId: string;
  projectName: string;
}

export interface CapacityBoardData {
  days: CapacityBoardDay[];
  assignments: CapacityBoardAssignment[];
  numCrews: number;
}

// One month of commitments for the capacity board: which projects hold
// each day (from project_schedule — the commitment level) and which
// crew is actually assigned where (from whole-project assignments —
// the dispatch level).
export async function getCapacityBoardData(
  monthStart: string,
  monthEnd: string
): Promise<CapacityBoardData> {
  const org = await getOrgSettings();
  const numCrews = org?.num_crews ?? 2;
  const supabase = await createClient();

  const [
    { data: scheduleRows, error: scheduleError },
    { data: assignmentRows, error: assignmentsError },
  ] = await Promise.all([
    supabase
      .from("project_schedule")
      .select("work_date, project_id")
      .gte("work_date", monthStart)
      .lte("work_date", monthEnd),
    supabase
      .from("assignments")
      .select("crew_id, work_date, project_id, row_id")
      .gte("work_date", monthStart)
      .lte("work_date", monthEnd),
  ]);
  if (scheduleError) throw scheduleError;
  if (assignmentsError) throw assignmentsError;

  const projectIds = [
    ...new Set([
      ...scheduleRows.map((r) => r.project_id),
      ...assignmentRows.map((r) => r.project_id),
    ]),
  ];
  const { data: projects, error: projectsError } =
    projectIds.length > 0
      ? await supabase
          .from("projects")
          .select("id, name, status")
          .in("id", projectIds)
      : {
          data: [] as { id: string; name: string; status: string }[],
          error: null,
        };
  if (projectsError) throw projectsError;
  const activeNameById = new Map(
    projects.filter((p) => p.status === "active").map((p) => [p.id, p.name])
  );

  const byDate = new Map<string, Map<string, string>>();
  for (const row of scheduleRows) {
    const name = activeNameById.get(row.project_id);
    if (!name) continue;
    const map = byDate.get(row.work_date) ?? new Map<string, string>();
    map.set(row.project_id, name);
    byDate.set(row.work_date, map);
  }

  const days: CapacityBoardDay[] = [];
  let cursor = monthStart;
  while (cursor <= monthEnd) {
    const scheduled = [...(byDate.get(cursor) ?? new Map())].map(
      ([projectId, projectName]) => ({
        projectId,
        projectName: projectName as string,
      })
    );
    days.push({
      date: cursor,
      scheduled,
      overCapacity: scheduled.length > numCrews,
    });
    cursor = addDays(cursor, 1);
  }

  const assignments: CapacityBoardAssignment[] = assignmentRows
    // Whole-project assignments only — the board is a commitments view,
    // and per-row assignments always ride alongside a project-level
    // presence on that day anyway.
    .filter((a) => a.row_id === null && a.crew_id !== null)
    .map((a) => ({
      crewId: a.crew_id!,
      workDate: a.work_date,
      projectId: a.project_id,
      projectName: activeNameById.get(a.project_id) ?? "Unknown project",
    }));

  return { days, assignments, numCrews };
}
