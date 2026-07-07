"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { toggleGateItem } from "@/lib/gates/actions";
import { getMaterialsReadiness } from "@/lib/materials/queries";
import { notifyUsers } from "@/lib/notifications/create";
import { touchProjectActivity } from "@/lib/projects/actions";
import { createClient } from "@/lib/supabase/server";
import type { MaterialReceiptStatus } from "@/lib/supabase/database.types";

// Matches material_receipts_write RLS exactly (owner/pm) — receiving/
// reconciliation stays an office task, same as materials_write itself.
const RECEIVERS = ["owner", "pm"] as const;

const FLAG_STATUSES = ["short", "damaged", "wrong"] as const;
export type MaterialFlagStatus = (typeof FLAG_STATUSES)[number];

function revalidateReceiving(projectId: string) {
  revalidatePath(`/app/project/${projectId}/receiving`);
  revalidatePath(`/app/project/${projectId}/materials`);
  revalidatePath(`/app/project/${projectId}`);
}

// Best-effort, label-matched sync of the Materials stage's own seeded
// checklist from computed readiness — same pattern (and same reasoning)
// as lib/handoff/actions.ts's markHandoffItemDone: the receiving event
// log is the actual source of truth (completeStage re-verifies it
// server-side, see ADR-042), this just saves the PM duplicate manual
// clicks. Tick-only, never un-ticks: if readiness regresses after a tick
// (a late damage discovery), the stage-completion recompute is the guard,
// not checkbox state. "Material staged/ready" is deliberately left
// manual — physically staging material is a human confirmation, and
// keeping one manual item keeps a human decision in the loop before the
// stage can complete.
async function syncMaterialsGateItems(projectId: string): Promise<void> {
  try {
    const readiness = await getMaterialsReadiness(projectId);
    if (readiness.totalNeeded === 0) return;

    const supabase = await createClient();
    const { data: stage } = await supabase
      .from("project_stages")
      .select("id")
      .eq("project_id", projectId)
      .eq("stage_key", "materials")
      .maybeSingle();
    if (!stage) return;

    const labelConditions: [string, boolean][] = [
      ["100% of BOM received", readiness.pctReceived >= 1],
      ["Received verified against packing slip", readiness.pctVerified >= 1],
      [
        "Shortages/damage resolved or accepted",
        readiness.pctReceived >= 1 && readiness.openFlagQty === 0,
      ],
    ];

    for (const [label, condition] of labelConditions) {
      if (!condition) continue;
      const { data: item } = await supabase
        .from("project_gate_items")
        .select("id, done")
        .eq("project_stage_id", stage.id)
        .eq("label", label)
        .maybeSingle();
      if (!item || item.done) continue;
      await toggleGateItem(item.id, projectId, { done: true });
    }
  } catch (err) {
    console.error("syncMaterialsGateItems failed", err);
  }
}

// Logs one receiving event (a shipment can arrive in batches, so this is
// an append to the log, never an overwrite) and — only for 'received' —
// also bumps materials.received, the fast aggregate the reconciliation
// view already depends on. `received` means USABLE units on hand: the
// verification worksheet logs good quantity here and bad quantity as a
// separate flag event, never both for the same physical unit — which is
// what keeps to_order the single reorder truth (ADR-042).
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

  await syncMaterialsGateItems(projectId);
  await touchProjectActivity(projectId);
  revalidateReceiving(projectId);
}

// The verification worksheet's "confirm" tap: these units arrived AND
// match the packing slip — one call logs both lifecycle events (received
// + verified) and bumps the aggregate, so the dock check-off is a single
// gesture per line instead of two separate form submissions.
export async function logVerifiedReceipt(
  materialId: string,
  projectId: string,
  qty: number,
  note: string
): Promise<void> {
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Quantity must be a positive number.");
  }
  const { userId } = await requireRole(RECEIVERS);
  const supabase = await createClient();

  const trimmedNote = note.trim() || null;
  const { error: insertError } = await supabase.from("material_receipts").insert([
    { material_id: materialId, status: "received", qty, note: trimmedNote, created_by: userId },
    { material_id: materialId, status: "verified", qty, note: trimmedNote, created_by: userId },
  ]);
  if (insertError) throw insertError;

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

  await syncMaterialsGateItems(projectId);
  await touchProjectActivity(projectId);
  revalidateReceiving(projectId);
}

// The worksheet's short/damaged/wrong flag: logs the event (which blocks
// the Materials gate until resolved) and notifies the PM the same day —
// in-app, immediately, one notification per discovery, not a digest.
// Flagged units are never received-bumped, so needed - received
// (to_order) automatically carries them onto the reorder list with no
// separate shortage math.
export async function flagMaterial(
  materialId: string,
  projectId: string,
  status: MaterialFlagStatus,
  qty: number,
  note: string
): Promise<void> {
  if (!FLAG_STATUSES.includes(status)) {
    throw new Error("Flag must be short, damaged, or wrong.");
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Quantity must be a positive number.");
  }
  const { userId, orgId } = await requireRole(RECEIVERS);
  const supabase = await createClient();

  const { error: receiptError } = await supabase.from("material_receipts").insert({
    material_id: materialId,
    status,
    qty,
    note: note.trim() || null,
    created_by: userId,
  });
  if (receiptError) throw receiptError;

  // Same-day PM notification: the project's PM of record if set (and not
  // the flagger themselves), else every owner/pm — same recipient
  // convention as the gate nags.
  try {
    const [{ data: project }, { data: material }] = await Promise.all([
      supabase.from("projects").select("name, pm_user_id").eq("id", projectId).single(),
      supabase.from("materials").select("name").eq("id", materialId).single(),
    ]);
    let recipients: string[] = [];
    if (project?.pm_user_id) {
      recipients = [project.pm_user_id];
    } else {
      const { data: officeRoles } = await supabase
        .from("profiles")
        .select("id")
        .in("role", ["owner", "pm"]);
      recipients = (officeRoles ?? []).map((p) => p.id);
    }
    recipients = recipients.filter((id) => id !== userId);
    if (recipients.length > 0 && project && material) {
      await notifyUsers(supabase, orgId, recipients, "material_flagged", {
        projectId,
        projectName: project.name,
        materialName: material.name,
        flagStatus: status,
        qty,
      });
    }
  } catch (err) {
    console.error("material_flagged notification failed", err);
  }

  await touchProjectActivity(projectId);
  revalidateReceiving(projectId);
}

// Closes an open short/damaged/wrong flag — the replacement arrived (log
// it separately as received/verified), or the shortfall was accepted.
// Until every flag is resolved, the Materials gate stays red.
export async function resolveMaterialFlag(
  receiptId: string,
  projectId: string
): Promise<void> {
  const { userId } = await requireRole(RECEIVERS);
  const supabase = await createClient();

  const { data: receipt, error: fetchError } = await supabase
    .from("material_receipts")
    .select("status, resolved_at")
    .eq("id", receiptId)
    .single();
  if (fetchError) throw fetchError;
  if (!FLAG_STATUSES.includes(receipt.status as MaterialFlagStatus)) {
    throw new Error("Only short/damaged/wrong flags can be resolved.");
  }
  if (receipt.resolved_at) return;

  const { error } = await supabase
    .from("material_receipts")
    .update({ resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq("id", receiptId);
  if (error) throw error;

  await syncMaterialsGateItems(projectId);
  await touchProjectActivity(projectId);
  revalidateReceiving(projectId);
}
