"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { MaterialReceiptStatus } from "@/lib/supabase/database.types";

// Matches material_receipts_write RLS exactly (owner/pm) — receiving/
// reconciliation stays an office task, same as materials_write itself.
const RECEIVERS = ["owner", "pm"] as const;

// Logs one receiving event (a shipment can arrive in batches, so this is
// an append to the log, never an overwrite) and — only for 'received' —
// also bumps materials.received, the fast aggregate the reconciliation
// view already depends on. This is the "log feeds an aggregate column"
// sync sub-phase 0's own migration comment flagged as this sub-phase's
// job; every other status (verified/staged/short/damaged/wrong) has no
// separate aggregate column to keep in sync — the log is authoritative.
export async function recordMaterialReceipt(
  materialId: string,
  projectId: string,
  status: MaterialReceiptStatus,
  qty: number,
  note: string
): Promise<void> {
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Quantity must be a positive number.");
  }
  const { userId } = await requireRole(RECEIVERS);
  const supabase = await createClient();

  const { error: receiptError } = await supabase.from("material_receipts").insert({
    material_id: materialId,
    status,
    qty,
    note: note.trim() || null,
    created_by: userId,
  });
  if (receiptError) throw receiptError;

  if (status === "received") {
    const { data: material, error: materialError } = await supabase
      .from("materials")
      .select("received")
      .eq("id", materialId)
      .single();
    if (materialError) throw materialError;

    const { error: updateError } = await supabase
      .from("materials")
      .update({ received: material.received + qty })
      .eq("id", materialId);
    if (updateError) throw updateError;
  }

  revalidatePath(`/app/project/${projectId}/receiving`);
  revalidatePath(`/app/project/${projectId}/materials`);
}
