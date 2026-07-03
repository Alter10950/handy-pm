import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export async function listPhases(
  projectId: string
): Promise<Tables<"phases">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("phases")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}
