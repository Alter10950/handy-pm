"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

// Matches the organizations_update RLS policy exactly.
const ORG_MANAGERS = ["owner", "pm"] as const;

export async function updateOrgSettings(
  name: string,
  address: string,
  defaultWorkingDays: number[]
): Promise<void> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Organization name is required.");
  const days = [...new Set(defaultWorkingDays)]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort();
  if (days.length === 0) {
    throw new Error("Pick at least one default working day.");
  }

  const { orgId } = await requireRole(ORG_MANAGERS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      name: trimmedName,
      address: address.trim() || null,
      default_working_days: days,
    })
    .eq("id", orgId);
  if (error) throw error;

  revalidatePath("/app/settings");
}

export async function recordOrgLogo(storagePath: string): Promise<void> {
  const { orgId } = await requireRole(ORG_MANAGERS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ logo_path: storagePath })
    .eq("id", orgId);
  if (error) throw error;

  revalidatePath("/app/settings");
}
