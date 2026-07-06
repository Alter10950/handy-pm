import { createClient } from "@/lib/supabase/server";
import type { Tables, Views } from "@/lib/supabase/database.types";

/**
 * Read-only data access for the Field (crew) app. Same RLS-scoped
 * convention as lib/projects/queries.ts — nothing here filters by org_id
 * manually.
 */

export async function listActiveProjectsForField(): Promise<
  Views<"project_progress">[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_progress")
    .select("*")
    .eq("status", "active")
    .order("name");
  if (error) throw error;
  return data;
}

// Cumulative installed qty so far, per (row, material) — the running total
// the field "+/-" stepper adds to, not a single day's entries. Summed here
// rather than via a view: the install log for one project is small enough
// that fetching raw rows and reducing server-side is simpler than adding a
// new aggregate view for a single caller.
export async function getInstalledTotals(
  rowIds: string[]
): Promise<Map<string, number>> {
  if (rowIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("installs")
    .select("row_id, material_id, qty")
    .in("row_id", rowIds);
  if (error) throw error;

  const totals = new Map<string, number>();
  for (const install of data) {
    const key = `${install.row_id}:${install.material_id}`;
    totals.set(key, (totals.get(key) ?? 0) + install.qty);
  }
  return totals;
}

// Every crew's entry for today, not just one: which crew the current
// device is logging as is client-side state (remembered per-browser, see
// components/field/use-crew-selection.ts), so the server can't know which
// row to filter to ahead of render. The client matches its own crew_id
// (including "no crew picked" as null) against this small list instead.
export async function listTodayDayLogs(
  projectId: string
): Promise<Tables<"day_logs">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("day_logs")
    .select("*")
    .eq("project_id", projectId)
    .eq("work_date", new Date().toISOString().slice(0, 10));
  if (error) throw error;
  return data;
}

export async function listTodayBlockers(
  projectId: string
): Promise<Tables<"blockers">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blockers")
    .select("*")
    .eq("project_id", projectId)
    .eq("work_date", new Date().toISOString().slice(0, 10))
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

// The signed-in user's own assigned crew (profiles.crew_id, Batch 3
// sub-phase A) — used only as useCrewSelection's fallback default, never
// as the source of truth for "which crew is this device logging as"
// (that stays the localStorage pick, so a shared tablet can still log as
// a different crew than whoever happens to be signed in on it).
export async function getMyCrewId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("crew_id")
    .eq("id", user.id)
    .maybeSingle();
  return profile?.crew_id ?? null;
}

// Signed URLs for a set of daily-photos storage paths — day-log photos
// live in the same private bucket blockers' photos do, just recorded on
// a different column (day_logs.photo_paths, an array, vs. blockers'
// single photo_path).
export async function getSignedDailyPhotoUrls(
  storagePaths: string[]
): Promise<Record<string, string>> {
  if (storagePaths.length === 0) return {};
  const supabase = await createClient();
  const entries = await Promise.all(
    storagePaths.map(async (path) => {
      const { data, error } = await supabase.storage
        .from("daily-photos")
        .createSignedUrl(path, 3600);
      if (error) throw error;
      return [path, data.signedUrl] as const;
    })
  );
  return Object.fromEntries(entries);
}

export interface TodayAssignment {
  id: string;
  projectId: string;
  crewId: string | null;
  rowId: string | null;
}

// Every crew's assignments for today, org-wide, not just one project or
// one crew — same "client matches its own crew_id" convention as
// listTodayDayLogs/listTodayBlockers above, since which crew this device
// is logging as is client-side state the server can't filter by ahead of
// render. Small dataset (one day, whichever projects have work scheduled
// today), so no pagination/project filter needed server-side.
export async function listTodayAssignments(): Promise<TodayAssignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assignments")
    .select("id, project_id, crew_id, row_id")
    .eq("work_date", new Date().toISOString().slice(0, 10));
  if (error) throw error;
  return data.map((a) => ({
    id: a.id,
    projectId: a.project_id,
    crewId: a.crew_id,
    rowId: a.row_id,
  }));
}

export interface TodayInstall {
  rowId: string;
  materialId: string;
  crewId: string | null;
  qty: number;
}

// Raw today's install deltas for a set of rows (one project's worth) —
// summed client-side per (row, material, crew), same "reduce here rather
// than add a view for one caller" reasoning as getInstalledTotals above.
// Powers both the material stepper's "today" figure and the day-close
// summary review.
export async function listTodayInstalls(
  rowIds: string[]
): Promise<TodayInstall[]> {
  if (rowIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("installs")
    .select("row_id, material_id, crew_id, qty")
    .in("row_id", rowIds)
    .eq("installed_on", new Date().toISOString().slice(0, 10));
  if (error) throw error;
  return data.map((i) => ({
    rowId: i.row_id,
    materialId: i.material_id,
    crewId: i.crew_id,
    qty: i.qty,
  }));
}
