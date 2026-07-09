"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { ensureProjectStages } from "@/lib/gates/actions";
import { listWonDeals } from "@/lib/integrations/zoho";
import { createClient } from "@/lib/supabase/server";

const PROJECT_EDITORS = ["owner", "pm"] as const;

// Batch 5 Sub-phase G: turn a won Zoho deal into a Handy PM project,
// pre-filled and linked. Gated: if Zoho isn't connected, listWonDeals
// returns [] and the UI shows a connect prompt — manual project creation
// is completely unchanged. The deal↔project link (integration_links) lets
// stage transitions push status back later.

export interface ImportableDeal {
  id: string;
  dealName: string;
  accountName: string | null;
  amount: number | null;
  address: string | null;
  alreadyImported: boolean;
}

export async function listImportableDeals(): Promise<{
  connected: boolean;
  deals: ImportableDeal[];
}> {
  const { orgId } = await requireRole(PROJECT_EDITORS);
  const deals = await listWonDeals(orgId);
  if (deals.length === 0) {
    // Either not connected or genuinely no won deals — the UI treats an
    // empty list plus not-connected differently, so report both.
    const { isZohoConnected } = await import("@/lib/integrations/zoho");
    return { connected: await isZohoConnected(orgId), deals: [] };
  }
  const supabase = await createClient();
  const { data: links } = await supabase
    .from("integration_links")
    .select("remote_id")
    .eq("provider", "zoho")
    .eq("local_kind", "project");
  const imported = new Set((links ?? []).map((l) => l.remote_id));
  return {
    connected: true,
    deals: deals.map((d) => ({
      id: d.id,
      dealName: d.dealName,
      accountName: d.accountName,
      amount: d.amount,
      address: d.address,
      alreadyImported: imported.has(d.id),
    })),
  };
}

export async function importDealAsProject(dealId: string): Promise<string> {
  const { orgId, userId } = await requireRole(PROJECT_EDITORS);
  const deals = await listWonDeals(orgId);
  const deal = deals.find((d) => d.id === dealId);
  if (!deal) throw new Error("That deal is no longer available in Zoho.");

  const supabase = await createClient();
  // Guard against a double import.
  const { data: existing } = await supabase
    .from("integration_links")
    .select("local_id")
    .eq("provider", "zoho")
    .eq("local_kind", "project")
    .eq("remote_id", dealId)
    .maybeSingle();
  if (existing) return existing.local_id;

  const name =
    deal.accountName && deal.dealName
      ? `${deal.accountName} — ${deal.dealName}`
      : deal.dealName;
  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      org_id: orgId,
      name,
      site_address: deal.address,
      quoted_amount: deal.amount,
      created_by: userId,
      // The importer becomes PM by default — they can reassign on Overview.
      pm_user_id: userId,
    })
    .select("id")
    .single();
  if (error) throw error;

  await supabase.from("integration_links").insert({
    org_id: orgId,
    provider: "zoho",
    local_kind: "project",
    local_id: project.id,
    remote_id: dealId,
    synced_at: new Date().toISOString(),
  });

  // Open the lifecycle at Handoff, same as any new active project.
  await ensureProjectStages(project.id, orgId);

  revalidatePath("/app");
  return project.id;
}
