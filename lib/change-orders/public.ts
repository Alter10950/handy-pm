// Server-only reads for the PUBLIC change-order approval page — the
// customer clicking an emailed link has no session, so RLS has nothing
// to scope against; the unguessable token IS the authorization, exactly
// like the customer portal (ADR-035, lib/portal/public.ts). Everything
// here selects the narrowest possible column set: a customer sees the
// CO and its lines, never org internals.
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ChangeOrderReason,
  ChangeOrderStatus,
  Tables,
} from "@/lib/supabase/database.types";

export interface PublicChangeOrder {
  id: string;
  number: number;
  title: string;
  description: string | null;
  reason: ChangeOrderReason;
  status: ChangeOrderStatus;
  laborUnits: number | null;
  addedDays: number | null;
  price: number | null;
  projectName: string;
  orgName: string;
  customerApproverName: string | null;
  customerApprovedAt: string | null;
  items: Pick<
    Tables<"change_order_items">,
    "id" | "kind" | "work_type" | "description" | "qty" | "unit"
  >[];
}

export async function resolveChangeOrderToken(
  token: string
): Promise<PublicChangeOrder | null> {
  if (!token || token.length < 16) return null;
  const admin = createAdminClient();

  const { data: co, error } = await admin
    .from("change_orders")
    .select(
      "id, project_id, number, title, description, reason, status, labor_units, added_days, price, customer_approver_name, customer_approved_at"
    )
    .eq("approval_token", token)
    .maybeSingle();
  if (error) throw error;
  if (!co) return null;

  const [
    { data: project, error: projectError },
    { data: items, error: itemsError },
  ] = await Promise.all([
    admin.from("projects").select("name, org_id").eq("id", co.project_id).single(),
    admin
      .from("change_order_items")
      .select("id, kind, work_type, description, qty, unit")
      .eq("change_order_id", co.id)
      .order("created_at", { ascending: true }),
  ]);
  if (projectError) throw projectError;
  if (itemsError) throw itemsError;

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("name")
    .eq("id", project.org_id)
    .single();
  if (orgError) throw orgError;

  return {
    id: co.id,
    number: co.number,
    title: co.title,
    description: co.description,
    reason: co.reason,
    status: co.status,
    laborUnits: co.labor_units,
    addedDays: co.added_days,
    price: co.price,
    projectName: project.name,
    orgName: org.name,
    customerApproverName: co.customer_approver_name,
    customerApprovedAt: co.customer_approved_at,
    items,
  };
}
