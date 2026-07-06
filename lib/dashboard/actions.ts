"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

// Matches blockers_update RLS exactly (owner/pm) — resolving/editing a
// blocker was already owner/pm-only at the database level; this is the
// first application code that actually exercises that write path
// (blockers.resolved_at has sat unused in the schema since Batch 2).
const BLOCKER_RESOLVERS = ["owner", "pm"] as const;

export async function resolveBlocker(blockerId: string) {
  await requireRole(BLOCKER_RESOLVERS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("blockers")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", blockerId)
    .is("resolved_at", null);
  if (error) throw error;

  revalidatePath("/app/dashboard");
}
