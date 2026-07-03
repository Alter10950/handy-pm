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
