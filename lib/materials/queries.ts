import { createClient } from "@/lib/supabase/server";
import type { MaterialReceiptStatus, Tables } from "@/lib/supabase/database.types";

export interface MaterialReceiptTotals {
  materialId: string;
  totalsByStatus: Partial<Record<MaterialReceiptStatus, number>>;
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
