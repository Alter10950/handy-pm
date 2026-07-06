"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

// Matches crews_write / crew_members_write RLS exactly.
const CREW_MANAGERS = ["owner", "pm", "scheduler"] as const;

function revalidateCrews() {
  revalidatePath("/scheduler");
  revalidatePath("/field");
}

export async function createCrew(
  name: string,
  size: number,
  costPerHour: number | null
): Promise<{ id: string }> {
  const { orgId } = await requireRole(CREW_MANAGERS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crews")
    .insert({
      org_id: orgId,
      name,
      size,
      cost_per_hour: costPerHour,
    })
    .select("id")
    .single();
  if (error) throw error;
  revalidateCrews();
  return { id: data.id };
}

export async function updateCrew(
  crewId: string,
  name: string,
  size: number,
  costPerHour: number | null
): Promise<void> {
  await requireRole(CREW_MANAGERS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("crews")
    .update({ name, size, cost_per_hour: costPerHour })
    .eq("id", crewId);
  if (error) throw error;
  revalidateCrews();
}

export async function deleteCrew(crewId: string): Promise<void> {
  await requireRole(CREW_MANAGERS);
  const supabase = await createClient();
  const { error } = await supabase.from("crews").delete().eq("id", crewId);
  if (error) throw error;
  revalidateCrews();
}

export async function addCrewMember(
  crewId: string,
  name: string
): Promise<void> {
  await requireRole(CREW_MANAGERS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("crew_members")
    .insert({ crew_id: crewId, name });
  if (error) throw error;
  revalidateCrews();
}

export async function removeCrewMember(memberId: string): Promise<void> {
  await requireRole(CREW_MANAGERS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("crew_members")
    .delete()
    .eq("id", memberId);
  if (error) throw error;
  revalidateCrews();
}
