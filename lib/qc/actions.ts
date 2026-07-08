"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { QC_CHECK_KEYS } from "@/lib/qc/shared";
import { createClient } from "@/lib/supabase/server";

// Any signed-in role can log QC — crews verify their own rows (same trust
// level as logging installs); RLS scopes to the org.
export async function setRowQcCheck(
  projectId: string,
  rowId: string,
  checkKey: string,
  passed: boolean,
  note?: string
) {
  if (!QC_CHECK_KEYS.includes(checkKey)) {
    throw new Error(`Unknown QC check: ${checkKey}`);
  }
  await requireRole(["owner", "pm", "scheduler", "crew"]);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("row_qc_checks").upsert(
    {
      row_id: rowId,
      check_key: checkKey,
      passed,
      note: note?.trim() || null,
      checked_by: user?.id ?? null,
      checked_at: new Date().toISOString(),
    },
    { onConflict: "row_id,check_key" }
  );
  if (error) {
    // Relation missing until the Phase 14 migration is approved.
    if (error.code === "PGRST205" || /row_qc_checks/.test(error.message)) {
      throw new Error(
        "QC checklists aren't enabled yet — the Phase 14 database migration is pending."
      );
    }
    throw error;
  }

  revalidatePath(`/app/project/${projectId}/progress`);
  revalidatePath(`/field/${projectId}`);
}
