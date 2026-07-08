import { createClient } from "@/lib/supabase/server";
import type {
  MaterialReceiptStatus,
  Tables,
} from "@/lib/supabase/database.types";

export interface MaterialReceiptTotals {
  materialId: string;
  totalsByStatus: Partial<Record<MaterialReceiptStatus, number>>;
}

export interface MaterialsReadiness {
  materialCount: number;
  totalNeeded: number;
  totalReceived: number; // capped per-material at needed
  totalVerified: number; // capped per-material at needed
  pctReceived: number; // 0..1
  pctVerified: number; // 0..1
  openFlagCount: number; // count of materials with unresolved short/damaged/wrong qty
  openFlagQty: number;
  isReady: boolean;
  blockedReason: string | null; // human sentence when !isReady
}

// The Materials gate's actual condition — computed from the receiving
// event log, never from checkbox state, so hand-ticking the checklist
// can't fake it (completeStage re-checks this server-side for the
// materials stage; see ADR-042). "Ready" = a real BOM exists, every
// unit is received AND verified, and no short/damaged/wrong flag is
// still open. A zero-material project is deliberately NOT ready — a BOM
// nobody loaded is exactly the iBuy failure mode, and the owner/pm
// override exists for the genuine no-materials job.
export async function getMaterialsReadiness(
  projectId: string
): Promise<MaterialsReadiness> {
  const supabase = await createClient();
  const { data: recon, error } = await supabase
    .from("material_reconciliation")
    .select("needed, received, verified, open_flag_qty")
    .eq("project_id", projectId);
  if (error) throw error;

  const withNeed = recon.filter((r) => r.needed > 0);
  const totalNeeded = withNeed.reduce((sum, r) => sum + r.needed, 0);
  const totalReceived = withNeed.reduce(
    (sum, r) => sum + Math.min(r.received, r.needed),
    0
  );
  const totalVerified = withNeed.reduce(
    (sum, r) => sum + Math.min(r.verified, r.needed),
    0
  );
  const openFlagCount = recon.filter((r) => r.open_flag_qty > 0).length;
  const openFlagQty = recon.reduce((sum, r) => sum + r.open_flag_qty, 0);

  const pctReceived = totalNeeded > 0 ? totalReceived / totalNeeded : 0;
  const pctVerified = totalNeeded > 0 ? totalVerified / totalNeeded : 0;

  let blockedReason: string | null = null;
  if (totalNeeded === 0) {
    blockedReason = "No materials loaded yet — load the BOM first.";
  } else if (pctReceived < 1) {
    blockedReason = `${Math.round(pctReceived * 100)}% of the BOM received.`;
  } else if (pctVerified < 1) {
    blockedReason = `${Math.round(pctVerified * 100)}% verified against the packing slip.`;
  } else if (openFlagQty > 0) {
    blockedReason = `${openFlagQty} unit(s) flagged short/damaged/wrong and unresolved.`;
  }

  return {
    materialCount: recon.length,
    totalNeeded,
    totalReceived,
    totalVerified,
    pctReceived,
    pctVerified,
    openFlagCount,
    openFlagQty,
    isReady: blockedReason === null,
    blockedReason,
  };
}

// Every receipt event for a project's materials, aggregated to a running
// total per (material, status) — material_receipts is an event log (a
// shipment can arrive in batches), so "how much has reached 'verified'
// so far" is a sum, not a single column. materials.received stays the
// fast-read aggregate for the reconciliation view; this is the fuller
// breakdown across every lifecycle stage, not just "received."
export async function getMaterialReceiptTotals(
  projectId: string
): Promise<MaterialReceiptTotals[]> {
  const supabase = await createClient();
  const { data: materials, error: materialsError } = await supabase
    .from("materials")
    .select("id")
    .eq("project_id", projectId);
  if (materialsError) throw materialsError;
  if (materials.length === 0) return [];

  const materialIds = materials.map((m) => m.id);
  const { data: receipts, error } = await supabase
    .from("material_receipts")
    .select("material_id, status, qty")
    .in("material_id", materialIds);
  if (error) throw error;

  const totalsByMaterial = new Map<
    string,
    Partial<Record<MaterialReceiptStatus, number>>
  >();
  for (const receipt of receipts) {
    const totals = totalsByMaterial.get(receipt.material_id) ?? {};
    totals[receipt.status] = (totals[receipt.status] ?? 0) + receipt.qty;
    totalsByMaterial.set(receipt.material_id, totals);
  }

  return materialIds.map((materialId) => ({
    materialId,
    totalsByStatus: totalsByMaterial.get(materialId) ?? {},
  }));
}

// Full per-material receipt log for a project, newest first — the
// Receiving screen's expandable "History" disclosure. One query for every
// material's log (same in-clause shape as getMaterialReceiptTotals above),
// not one query per material.
export async function listMaterialReceiptHistoryByProject(
  projectId: string
): Promise<Map<string, Tables<"material_receipts">[]>> {
  const supabase = await createClient();
  const { data: materials, error: materialsError } = await supabase
    .from("materials")
    .select("id")
    .eq("project_id", projectId);
  if (materialsError) throw materialsError;
  if (materials.length === 0) return new Map();

  const materialIds = materials.map((m) => m.id);
  const { data: receipts, error } = await supabase
    .from("material_receipts")
    .select("*")
    .in("material_id", materialIds)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const historyByMaterial = new Map<string, Tables<"material_receipts">[]>();
  for (const receipt of receipts) {
    const history = historyByMaterial.get(receipt.material_id) ?? [];
    history.push(receipt);
    historyByMaterial.set(receipt.material_id, history);
  }
  return historyByMaterial;
}
