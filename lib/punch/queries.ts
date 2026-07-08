import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export interface ProjectPunch {
  available: boolean;
  items: Tables<"punch_items">[];
  openCount: number;
}

// Guarded read — see lib/qc/queries.ts for the pattern.
export async function listPunchItems(projectId: string): Promise<ProjectPunch> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("punch_items")
    .select("*")
    .eq("project_id", projectId)
    .order("status", { ascending: false }) // open before done
    .order("created_at", { ascending: false });
  if (error) return { available: false, items: [], openCount: 0 };
  return {
    available: true,
    items: data,
    openCount: data.filter((item) => item.status === "open").length,
  };
}
