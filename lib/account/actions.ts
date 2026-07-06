"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

// Goes through update_own_full_name (SECURITY DEFINER), not a plain
// profiles update — profiles_update's RLS policy only lets owner/pm
// update ANY row, so a crew/scheduler user couldn't self-edit their own
// name through it. The RPC hardcodes both "only the caller's own row"
// and "only this one column," so it's safe to expose to every role.
export async function updateOwnName(fullName: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { error } = await supabase.rpc("update_own_full_name", {
    p_full_name: fullName,
  });
  if (error) throw error;

  revalidatePath("/account");
  revalidatePath("/app/team");
}
