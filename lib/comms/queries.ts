import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type ProjectCommRow = Tables<"project_comms">;

// The complete record of what the customer knows — newest first.
export async function listProjectComms(projectId: string): Promise<ProjectCommRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_comms")
    .select("*")
    .eq("project_id", projectId)
    .order("sent_at", { ascending: false });
  if (error) throw error;
  return data;
}
