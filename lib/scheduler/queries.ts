import { createClient } from "@/lib/supabase/server";
import type { Tables, Views } from "@/lib/supabase/database.types";

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
