"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { todayIso } from "@/lib/dates";
import { computeProjectEstimate } from "@/lib/estimating/queries";
import { getOrgSettings } from "@/lib/org/queries";
import {
  requireClearedForDispatch,
  syncScheduleGateItem,
} from "@/lib/scheduler/actions";
import { fillWorkingDays, snapToWorkingDay } from "@/lib/scheduler/board";
import { createClient } from "@/lib/supabase/server";

// Bulk day-range writes for the drag-drop schedule board (design pass v3
// F1). A "bar" is every whole-project (row_id null) assignment a crew has
// for a project; move / resize / reassign / skip-paint / tray-drop all
// reduce to ONE primitive — replace that bar's date set — so there is a
// single enforcement point for the dispatch gate (ADR-042) and the
// crew-capacity hard limit (ADR-044).

const SCHEDULERS = ["owner", "pm", "scheduler"] as const;

function revalidateBoard(projectId: string) {
  revalidatePath("/scheduler");
  revalidatePath("/scheduler/board");
  revalidatePath("/scheduler/calendar");
  revalidatePath(`/scheduler/${projectId}`);
}

export type WriteBarResult =
  | { ok: true; start: string | null; end: string | null }
  | { ok: false; overCapacity: string[]; numCrews: number };

// The distinct-projects-per-day capacity rule, same source of truth as
// checkScheduleCapacity (project_schedule, ADR-044). Returns the subset
// of `dates` that would push the org past numCrews concurrent projects.
async function findOverCapacityDates(
  projectId: string,
  dates: string[],
  numCrews: number
): Promise<string[]> {
  if (dates.length === 0) return [];
  const supabase = await createClient();
  const sorted = [...dates].sort();
  const { data, error } = await supabase
    .from("project_schedule")
    .select("work_date, project_id")
    .neq("project_id", projectId)
    .gte("work_date", sorted[0])
    .lte("work_date", sorted[sorted.length - 1]);
  if (error) throw error;

  const othersByDate = new Map<string, Set<string>>();
  for (const row of data) {
    const set = othersByDate.get(row.work_date) ?? new Set<string>();
    set.add(row.project_id);
    othersByDate.set(row.work_date, set);
  }
  return sorted.filter(
    (date) => (othersByDate.get(date)?.size ?? 0) + 1 > numCrews
  );
}

/**
 * Replace the whole-project assignment set for (project, crew) with
 * `dates` — the board's one write primitive. Pass `fromCrewId` on a
 * cross-lane drag to clear the old crew's bar in the same commit.
 * `project_schedule` stays in sync (dates a crew now works get scheduled;
 * dates this edit abandoned and no other crew covers get unscheduled) so
 * capacity math and target generation keep working off it.
 */
export async function writeProjectBar(input: {
  projectId: string;
  crewId: string;
  dates: string[];
  fromCrewId?: string;
}): Promise<WriteBarResult> {
  const { orgId } = await requireRole(SCHEDULERS);
  const { projectId, crewId, fromCrewId } = input;
  const dates = [...new Set(input.dates)].sort();

  // Clearing a bar isn't a dispatch; committing days is.
  if (dates.length > 0) await requireClearedForDispatch(projectId, orgId);

  const org = await getOrgSettings();
  const numCrews = org?.num_crews ?? 2;
  const overCapacity = await findOverCapacityDates(projectId, dates, numCrews);
  if (overCapacity.length > 0) {
    return { ok: false, overCapacity, numCrews };
  }

  const supabase = await createClient();
  const touchedCrewIds = [
    ...new Set([crewId, ...(fromCrewId ? [fromCrewId] : [])]),
  ];

  // Old date set across the crews this edit touches — needed for the
  // project_schedule diff below.
  const { data: oldRows, error: oldError } = await supabase
    .from("assignments")
    .select("id, work_date")
    .eq("project_id", projectId)
    .in("crew_id", touchedCrewIds)
    .is("row_id", null);
  if (oldError) throw oldError;
  const oldDates = new Set(oldRows.map((r) => r.work_date));

  if (oldRows.length > 0) {
    const { error: deleteError } = await supabase
      .from("assignments")
      .delete()
      .in(
        "id",
        oldRows.map((r) => r.id)
      );
    if (deleteError) throw deleteError;
  }

  if (dates.length > 0) {
    const { error: insertError } = await supabase.from("assignments").insert(
      dates.map((workDate) => ({
        project_id: projectId,
        crew_id: crewId,
        row_id: null,
        work_date: workDate,
      }))
    );
    if (insertError) throw insertError;
  }

  // ── project_schedule sync ──
  // Add: newly-assigned dates missing from the schedule. Remove: only
  // dates THIS edit walked away from that no remaining assignment (other
  // crew, row-scoped) still covers — manually planned days a scheduler
  // committed without a crew are deliberately left alone.
  const newDates = new Set(dates);
  const added = dates.filter((d) => !oldDates.has(d));
  const abandoned = [...oldDates].filter((d) => !newDates.has(d));

  const { data: scheduleRows, error: scheduleError } = await supabase
    .from("project_schedule")
    .select("work_date")
    .eq("project_id", projectId);
  if (scheduleError) throw scheduleError;
  const scheduled = new Set(scheduleRows.map((r) => r.work_date));

  const toInsert = added.filter((d) => !scheduled.has(d));
  if (toInsert.length > 0) {
    const { error } = await supabase.from("project_schedule").insert(
      toInsert.map((workDate) => ({
        project_id: projectId,
        work_date: workDate,
      }))
    );
    if (error) throw error;
  }

  if (abandoned.length > 0) {
    const { data: remaining, error: remainingError } = await supabase
      .from("assignments")
      .select("work_date")
      .eq("project_id", projectId)
      .in("work_date", abandoned);
    if (remainingError) throw remainingError;
    const stillCovered = new Set(remaining.map((r) => r.work_date));
    const toDelete = abandoned.filter(
      (d) => !stillCovered.has(d) && scheduled.has(d)
    );
    if (toDelete.length > 0) {
      const { error } = await supabase
        .from("project_schedule")
        .delete()
        .eq("project_id", projectId)
        .in("work_date", toDelete);
      if (error) throw error;
    }
  }

  if (dates.length > 0) {
    await syncScheduleGateItem(projectId, "Crew assigned");
    await syncScheduleGateItem(projectId, "Dates committed within capacity");
  }

  revalidateBoard(projectId);
  return {
    ok: true,
    start: dates[0] ?? null,
    end: dates[dates.length - 1] ?? null,
  };
}

export type AutoPlanResult =
  | {
      ok: true;
      crewId: string;
      start: string;
      end: string;
      days: number;
      source: "estimate" | "planned_days" | "fallback";
    }
  | { ok: false; overCapacity: string[]; numCrews: number };

/**
 * Auto-plan: fill a bar for the project from its estimate — crew-days
 * from the per-SKU estimate engine (falling back to planned_days, then a
 * single day), laid onto org working days starting at the next working
 * day, skipping any date already at the org's crew-capacity limit. Picks
 * the least-loaded crew over the coming weeks when none is given.
 */
export async function autoPlanProjectBar(
  projectId: string,
  crewId?: string
): Promise<AutoPlanResult> {
  const { orgId } = await requireRole(SCHEDULERS);
  await requireClearedForDispatch(projectId, orgId);
  const supabase = await createClient();

  // How many crew-days: estimate engine first, planned_days as fallback.
  let days = 0;
  let source: "estimate" | "planned_days" | "fallback" = "fallback";
  try {
    const estimate = await computeProjectEstimate(projectId);
    if (estimate.estimatedDays > 0) {
      days = Math.ceil(estimate.estimatedDays);
      source = "estimate";
    }
  } catch {
    // No estimate data yet — fall through to planned_days.
  }
  if (days <= 0) {
    const { data: project } = await supabase
      .from("projects")
      .select("planned_days")
      .eq("id", projectId)
      .single();
    if (project?.planned_days && project.planned_days > 0) {
      days = Math.ceil(project.planned_days);
      source = "planned_days";
    }
  }
  if (days <= 0) {
    days = 1;
    source = "fallback";
  }

  const org = await getOrgSettings();
  const numCrews = org?.num_crews ?? 2;
  const workingWeekdays = new Set(org?.default_working_days ?? [1, 2, 3, 4, 5]);

  const start = snapToWorkingDay(todayIso(), workingWeekdays);
  // Dates already at capacity are blocked so the fill flows around them —
  // a year of schedule is plenty of room for any sane plan.
  const { data: scheduleRows, error: scheduleError } = await supabase
    .from("project_schedule")
    .select("work_date, project_id")
    .neq("project_id", projectId)
    .gte("work_date", start);
  if (scheduleError) throw scheduleError;
  const othersByDate = new Map<string, Set<string>>();
  for (const row of scheduleRows) {
    const set = othersByDate.get(row.work_date) ?? new Set<string>();
    set.add(row.project_id);
    othersByDate.set(row.work_date, set);
  }
  const blocked = new Set(
    [...othersByDate.entries()]
      .filter(([, set]) => set.size + 1 > numCrews)
      .map(([date]) => date)
  );

  const dates = fillWorkingDays(start, days, workingWeekdays, blocked);
  if (dates.length === 0) {
    return { ok: false, overCapacity: [start], numCrews };
  }

  let targetCrewId = crewId ?? null;
  if (!targetCrewId) {
    // Least-loaded crew across the fill window.
    const { data: crews, error: crewsError } = await supabase
      .from("crews")
      .select("id")
      .order("created_at", { ascending: true });
    if (crewsError) throw crewsError;
    if (!crews || crews.length === 0) {
      throw new Error("Add a crew on the Scheduler page first.");
    }
    const { data: load, error: loadError } = await supabase
      .from("assignments")
      .select("crew_id")
      .gte("work_date", dates[0])
      .lte("work_date", dates[dates.length - 1]);
    if (loadError) throw loadError;
    const loadByCrew = new Map<string, number>();
    for (const row of load) {
      if (!row.crew_id) continue;
      loadByCrew.set(row.crew_id, (loadByCrew.get(row.crew_id) ?? 0) + 1);
    }
    targetCrewId = crews.reduce((best, crew) =>
      (loadByCrew.get(crew.id) ?? 0) < (loadByCrew.get(best.id) ?? 0)
        ? crew
        : best
    ).id;
  }

  const result = await writeProjectBar({
    projectId,
    crewId: targetCrewId,
    dates,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    crewId: targetCrewId,
    start: dates[0],
    end: dates[dates.length - 1],
    days: dates.length,
    source,
  };
}
