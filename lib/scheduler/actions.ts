"use server";

import { revalidatePath } from "next/cache";

import { listProjectSchedule, listRemainingByMaterial } from "@/lib/scheduler/queries";
import { createClient } from "@/lib/supabase/server";

function revalidateScheduler(projectId: string) {
  revalidatePath("/scheduler");
  revalidatePath(`/scheduler/${projectId}`);
}

export async function upsertPlannedDays(
  projectId: string,
  plannedDays: number | null
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ planned_days: plannedDays })
    .eq("id", projectId);
  if (error) throw error;
  revalidateScheduler(projectId);
}

// Replace-the-whole-set semantics: simpler and just as correct as diffing,
// since project_schedule rows carry no other state (a date is either
// scheduled or it isn't — nothing to preserve across a rebuild).
export async function setProjectSchedule(
  projectId: string,
  dates: string[]
): Promise<void> {
  const supabase = await createClient();
  const { error: deleteError } = await supabase
    .from("project_schedule")
    .delete()
    .eq("project_id", projectId);
  if (deleteError) throw deleteError;

  if (dates.length > 0) {
    const { error: insertError } = await supabase
      .from("project_schedule")
      .insert(dates.map((workDate) => ({ project_id: projectId, work_date: workDate })));
    if (insertError) throw insertError;
  }
  revalidateScheduler(projectId);
}

export async function createAssignment(
  projectId: string,
  crewId: string,
  workDate: string,
  rowIds: string[] | null
): Promise<void> {
  const supabase = await createClient();
  const rows = rowIds && rowIds.length > 0 ? rowIds : [null];
  const { error } = await supabase.from("assignments").insert(
    rows.map((rowId) => ({
      project_id: projectId,
      crew_id: crewId,
      row_id: rowId,
      work_date: workDate,
    }))
  );
  if (error) throw error;
  revalidateScheduler(projectId);
}

export async function deleteAssignment(
  id: string,
  projectId: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("assignments").delete().eq("id", id);
  if (error) throw error;
  revalidateScheduler(projectId);
}

// targets has no unique constraint on (project_id, crew_id, work_date,
// material_id) — find-or-update-or-insert by hand, same reasoning as
// day_logs' upsert (and crew_id is nullable here too).
export async function upsertTarget(
  projectId: string,
  crewId: string | null,
  workDate: string,
  materialId: string,
  targetQty: number
): Promise<void> {
  const supabase = await createClient();
  let existing = supabase
    .from("targets")
    .select("id")
    .eq("project_id", projectId)
    .eq("work_date", workDate)
    .eq("material_id", materialId);
  existing = crewId
    ? existing.eq("crew_id", crewId)
    : existing.is("crew_id", null);
  const { data: found, error: findError } = await existing.maybeSingle();
  if (findError) throw findError;

  if (found) {
    const { error } = await supabase
      .from("targets")
      .update({ target_qty: targetQty })
      .eq("id", found.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("targets").insert({
      project_id: projectId,
      crew_id: crewId,
      work_date: workDate,
      material_id: materialId,
      target_qty: targetQty,
    });
    if (error) throw error;
  }
  revalidateScheduler(projectId);
}

// "Daily targets auto-suggested from remaining material ÷ remaining days":
// splits each material's remaining qty (assigned - installed, see
// listRemainingByMaterial) evenly across every scheduled day from today
// forward, project-wide (crew_id null — a day can have more than one crew
// assigned, and the spec doesn't ask for a per-crew split of the target).
// Replaces any existing today-forward targets rather than layering on top,
// so re-running this after progress changes gives a clean recompute
// instead of accumulating stale rows.
export async function generateTargets(projectId: string): Promise<number> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [remaining, schedule] = await Promise.all([
    listRemainingByMaterial(projectId),
    listProjectSchedule(projectId),
  ]);
  const upcomingDates = schedule
    .map((entry) => entry.work_date)
    .filter((date) => date >= today)
    .sort();
  if (upcomingDates.length === 0) return 0;

  const { error: deleteError } = await supabase
    .from("targets")
    .delete()
    .eq("project_id", projectId)
    .is("crew_id", null)
    .gte("work_date", today);
  if (deleteError) throw deleteError;

  const rows = upcomingDates.flatMap((workDate) =>
    remaining
      .filter((material) => material.remaining > 0)
      .map((material) => ({
        project_id: projectId,
        crew_id: null,
        work_date: workDate,
        material_id: material.materialId,
        target_qty: Math.ceil(material.remaining / upcomingDates.length),
      }))
  );
  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("targets").insert(rows);
    if (insertError) throw insertError;
  }
  revalidateScheduler(projectId);
  return upcomingDates.length;
}
