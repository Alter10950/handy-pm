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

export async function listCrewMembers(
  crewIds: string[]
): Promise<Tables<"crew_members">[]> {
  if (crewIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crew_members")
    .select("*")
    .in("crew_id", crewIds)
    .order("name");
  if (error) throw error;
  return data;
}
