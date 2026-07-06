"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { BlockerCode } from "@/lib/supabase/database.types";

function revalidateField(projectId: string) {
  revalidatePath("/field");
  revalidatePath(`/field/${projectId}`);
}

// idempotency_key makes this safe to replay: the offline queue (see
// lib/field/offline-queue.ts) retries a queued delta until it succeeds,
// and a retry after a dropped connection (network failed, but the insert
// actually landed) must not double-count. A unique-violation on that key
// means this exact delta already made it in — treated as success, not an
// error, so the caller can drop it from the queue either way.
export async function logInstallDelta(
  rowId: string,
  projectId: string,
  materialId: string,
  qty: number,
  crewId: string | null,
  idempotencyKey: string,
  deviceId: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("installs").insert({
    row_id: rowId,
    material_id: materialId,
    qty,
    crew_id: crewId,
    idempotency_key: idempotencyKey,
    device_id: deviceId,
  });
  if (error && error.code !== "23505") throw error;
  revalidateField(projectId);
}

export async function createBlocker(
  projectId: string,
  rowId: string | null,
  crewId: string | null,
  code: BlockerCode,
  note: string,
  photoPath: string | null
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("blockers").insert({
    project_id: projectId,
    row_id: rowId,
    crew_id: crewId,
    code,
    note: note.trim() || null,
    photo_path: photoPath,
  });
  if (error) throw error;
  revalidateField(projectId);
}

export interface DayLogFields {
  arrivedAt?: string | null;
  offloadStart?: string | null;
  offloadEnd?: string | null;
  installStart?: string | null;
  installEnd?: string | null;
  departedAt?: string | null;
  note?: string | null;
}

function toRow(fields: DayLogFields) {
  return {
    ...(fields.arrivedAt !== undefined && { arrived_at: fields.arrivedAt }),
    ...(fields.offloadStart !== undefined && {
      offload_start: fields.offloadStart,
    }),
    ...(fields.offloadEnd !== undefined && { offload_end: fields.offloadEnd }),
    ...(fields.installStart !== undefined && {
      install_start: fields.installStart,
    }),
    ...(fields.installEnd !== undefined && { install_end: fields.installEnd }),
    ...(fields.departedAt !== undefined && { departed_at: fields.departedAt }),
    ...(fields.note !== undefined && { note: fields.note }),
  };
}

// Not a Postgres ON CONFLICT upsert: crew_id is nullable, and Postgres
// treats every NULL in a unique column as distinct from every other NULL,
// so `unique (project_id, crew_id, work_date)` doesn't catch "no crew
// picked" duplicates the way it does for a real crew_id. Find-or-create
// explicitly instead.
export async function upsertDayLog(
  projectId: string,
  crewId: string | null,
  fields: DayLogFields
): Promise<void> {
  const supabase = await createClient();
  const workDate = new Date().toISOString().slice(0, 10);

  let existing = supabase
    .from("day_logs")
    .select("id")
    .eq("project_id", projectId)
    .eq("work_date", workDate);
  existing = crewId
    ? existing.eq("crew_id", crewId)
    : existing.is("crew_id", null);
  const { data: found, error: findError } = await existing.maybeSingle();
  if (findError) throw findError;

  if (found) {
    const { error } = await supabase
      .from("day_logs")
      .update(toRow(fields))
      .eq("id", found.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("day_logs").insert({
      project_id: projectId,
      crew_id: crewId,
      work_date: workDate,
      ...toRow(fields),
    });
    if (error) throw error;
  }
  revalidateField(projectId);
}

export async function closeDay(
  projectId: string,
  crewId: string | null
): Promise<void> {
  await upsertDayLog(projectId, crewId, {
    departedAt: new Date().toISOString(),
  });
}

// End-of-day documentation photos — distinct from blockers.photo_path
// (one photo tied to one reported problem); these are general "here's
// the work today" photos, so a day can have more than one. Same
// find-or-create shape as upsertDayLog, reusing its own upsert logic by
// reading the current array first (a plain read-modify-write, not a
// Postgres array_append — fine for how infrequently one device adds a
// photo, no realistic concurrent-write race for a single crew's own day).
export async function addDayLogPhoto(
  projectId: string,
  crewId: string | null,
  storagePath: string
): Promise<void> {
  const supabase = await createClient();
  const workDate = new Date().toISOString().slice(0, 10);

  let existing = supabase
    .from("day_logs")
    .select("id, photo_paths")
    .eq("project_id", projectId)
    .eq("work_date", workDate);
  existing = crewId
    ? existing.eq("crew_id", crewId)
    : existing.is("crew_id", null);
  const { data: found, error: findError } = await existing.maybeSingle();
  if (findError) throw findError;

  if (found) {
    const { error } = await supabase
      .from("day_logs")
      .update({ photo_paths: [...found.photo_paths, storagePath] })
      .eq("id", found.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("day_logs").insert({
      project_id: projectId,
      crew_id: crewId,
      work_date: workDate,
      photo_paths: [storagePath],
    });
    if (error) throw error;
  }
  revalidateField(projectId);
}

export async function removeDayLogPhoto(
  dayLogId: string,
  projectId: string,
  storagePath: string
): Promise<void> {
  const supabase = await createClient();
  const { data: found, error: findError } = await supabase
    .from("day_logs")
    .select("photo_paths")
    .eq("id", dayLogId)
    .single();
  if (findError) throw findError;

  const { error } = await supabase
    .from("day_logs")
    .update({
      photo_paths: found.photo_paths.filter((path) => path !== storagePath),
    })
    .eq("id", dayLogId);
  if (error) throw error;
  revalidateField(projectId);
}
