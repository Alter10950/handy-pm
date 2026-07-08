import { createClient } from "@/lib/supabase/server";

export * from "@/lib/scope/shared";

export async function listScopeItems(projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scope_item_progress")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

// Total scope labor_units for a project — the estimator and scheduler
// both need this figure alongside materials.labor_units; kept here
// (not duplicated in lib/estimating or lib/scheduler) since it's a
// scope_items-native aggregate, not derived from anything those modules
// already fetch.
export async function getTotalScopeLaborUnits(
  projectId: string
): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scope_items")
    .select("labor_units")
    .eq("project_id", projectId);
  if (error) throw error;
  return data.reduce((sum, item) => sum + (item.labor_units ?? 0), 0);
}
