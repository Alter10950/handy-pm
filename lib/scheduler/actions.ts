"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { listProjectSchedule, listRemainingByMaterial } from "@/lib/scheduler/queries";
import { createClient } from "@/lib/supabase/server";

// Matches assignments_write / targets_write / project_schedule_write RLS.
const SCHEDULERS = ["owner", "pm", "scheduler"] as const;

function revalidateScheduler(projectId: string) {
  revalidatePath("/scheduler");
  revalidatePath(`/scheduler/${projectId}`);
}

export async function upsertPlannedDays(
  projectId: string,
  plannedDays: number | null
): Promise<void> {
  await requireRole(SCHEDULERS);
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
  await requireRole(SCHEDULERS);
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
  await requireRole(SCHEDULERS);
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
  await requireRole(SCHEDULERS);
  const supabase = await createClient();
  const { error } = await supabase.from("assignments").delete().eq("id", id);
  if (error) throw error;
  revalidateScheduler(projectId);
}

// Drag-and-drop move on the cross-project calendar — scoped to
// whole-project assignments (row_id null) only; a rows/phase-scoped
// assignment is really N underlying rows (one per row_id, see
// createAssignment) and moving those as a batch via a single drag
// isn't what the calendar's simple crew-x-day grid models. Finer-grained
// reassignment stays in the per-project AssignCrewForm dialog.
export async function moveAssignment(
  assignmentId: string,
  newCrewId: string,
  newWorkDate: string
): Promise<void> {
  await requireRole(SCHEDULERS);
  const supabase = await createClient();
  const { data: existing, error: findError } = await supabase
    .from("assignments")
    .select("project_id")
    .eq("id", assignmentId)
    .single();
  if (findError) throw findError;

  const { error } = await supabase
    .from("assignments")
    .update({ crew_id: newCrewId, work_date: newWorkDate })
    .eq("id", assignmentId);
  if (error) throw error;
  revalidateScheduler(existing.project_id);
}

export interface DoubleBookingHit {
  projectId: string;
  projectName: string;
}

// Read-only pre-flight check before creating/moving an assignment — a
// plain read (assignments_select has no role restriction), not gated
// like the writes above. Excludes the assignment being moved itself, so
// dropping a chip back on its own cell doesn't warn against itself.
export async function checkDoubleBooking(
  crewId: string,
  workDate: string,
  excludeAssignmentId?: string
): Promise<DoubleBookingHit[]> {
  const supabase = await createClient();
  let query = supabase
    .from("assignments")
    .select("id, project_id")
    .eq("crew_id", crewId)
    .eq("work_date", workDate);
  if (excludeAssignmentId) query = query.neq("id", excludeAssignmentId);
  const { data, error } = await query;
  if (error) throw error;
  if (data.length === 0) return [];

  const projectIds = [...new Set(data.map((a) => a.project_id))];
  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, name")
    .in("id", projectIds);
  if (projectsError) throw projectsError;
  return projects.map((p) => ({ projectId: p.id, projectName: p.name }));
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
  await requireRole(SCHEDULERS);
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
  await requireRole(SCHEDULERS);
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
