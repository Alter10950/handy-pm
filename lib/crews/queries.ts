import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export async function listCrews(): Promise<Tables<"crews">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crews")
    .select("*")
    .order("name");
  if (error) throw error;
  return data;
}
