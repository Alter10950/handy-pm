"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

function revalidateCrews() {
  revalidatePath("/scheduler");
  revalidatePath("/field");
}

async function requireOrgId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();
  if (error) throw error;
  if (!profile.org_id) {
    throw new Error(
      "Your account isn't assigned to an organization yet. Ask an owner/PM to assign you one."
    );
  }
  return profile.org_id;
}

export async function createCrew(
  name: string,
  size: number,
  costPerHour: number | null
): Promise<{ id: string }> {
  const orgId = await requireOrgId();
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
  const supabase = await createClient();
  const { error } = await supabase
    .from("crews")
    .update({ name, size, cost_per_hour: costPerHour })
    .eq("id", crewId);
  if (error) throw error;
  revalidateCrews();
}

export async function deleteCrew(crewId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("crews").delete().eq("id", crewId);
  if (error) throw error;
  revalidateCrews();
}

export async function addCrewMember(
  crewId: string,
  name: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("crew_members")
    .insert({ crew_id: crewId, name });
  if (error) throw error;
  revalidateCrews();
}

export async function removeCrewMember(memberId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("crew_members")
    .delete()
    .eq("id", memberId);
  if (error) throw error;
  revalidateCrews();
}
