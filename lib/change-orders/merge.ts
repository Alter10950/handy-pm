// Not a "use server" action file — the merge runs under two different
// clients: the cookie-scoped client for office-side manual approval, and
// the service-role admin client for the customer's tokenized public
// approval (no session, RLS has nothing to scope against — same ADR-035
// reasoning as lib/portal/public.ts). The caller supplies whichever
// client its context makes legitimate, mirroring notifyUsers' shape.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

// The merge that makes an approval real: the CO's draft lines become
// actual scope_items/materials rows — so the estimator, scheduler,
// reconciliation, and field all pick them up through their existing
// queries, and nothing anywhere needs a CO-status join — tagged with
// change_order_id for traceability. Draft lines stay behind as the CO's
// own permanent record. Labor figures come from the stored line values
// (computed with an office session at line-entry time), never re-derived
// here — labor_standards isn't readable under the public path's
// non-session context, and re-deriving would silently disagree with what
// the customer was shown.
export async function mergeApprovedChangeOrder(
  supabase: SupabaseClient<Database>,
  changeOrderId: string,
  projectId: string
): Promise<void> {
  const { data: items, error } = await supabase
    .from("change_order_items")
    .select("*")
    .eq("change_order_id", changeOrderId);
  if (error) throw error;

  const scopeLines = items.filter((i) => i.kind === "scope");
  if (scopeLines.length > 0) {
    const { error: scopeError } = await supabase.from("scope_items").insert(
      scopeLines.map((line) => ({
        project_id: projectId,
        work_type: line.work_type ?? ("other" as const),
        description: line.description,
        qty: line.qty,
        unit: line.unit,
        labor_units: line.labor_units,
        source: "change_order" as const,
        change_order_id: changeOrderId,
      }))
    );
    if (scopeError) throw scopeError;
  }

  const materialLines = items.filter((i) => i.kind === "material");
  if (materialLines.length > 0) {
    const { error: materialsError } = await supabase.from("materials").insert(
      materialLines.map((line) => ({
        project_id: projectId,
        name: line.description,
        total_needed: line.qty ?? 0,
        unit: line.unit ?? "pcs",
        // received deliberately 0 — CO materials still have to be
        // ordered, received, and verified through the Sub-phase E gate
        // like everything else.
        received: 0,
        // materials.labor_units is PER UNIT; the stored line figure is
        // the line total (perUnit × qty at entry time).
        labor_units:
          line.qty && line.qty > 0
            ? Math.round(((line.labor_units ?? line.qty) / line.qty) * 10000) / 10000
            : (line.labor_units ?? 1),
        change_order_id: changeOrderId,
      }))
    );
    if (materialsError) throw materialsError;
  }
}
