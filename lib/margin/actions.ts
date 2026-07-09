"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

// Owner-only: set a project's contract quote (the manual-entry path that
// always works, with or without a QuickBooks connection).
export async function setProjectQuote(
  projectId: string,
  amount: number | null
): Promise<void> {
  await requireRole(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ quoted_amount: amount })
    .eq("id", projectId);
  if (error) {
    // The column doesn't exist yet (quote migration not applied) — surface
    // a clear message rather than a raw Postgres error.
    if (/quoted_amount/.test(error.message)) {
      throw new Error(
        "The quote field isn't available yet — the quote migration needs to be applied."
      );
    }
    throw error;
  }
  revalidatePath(`/app/project/${projectId}/estimate`);
}
