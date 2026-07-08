import { createClient } from "@/lib/supabase/server";
import type {
  ChangeOrderItemRow,
  ChangeOrderRow,
} from "@/lib/change-orders/shared";

export * from "@/lib/change-orders/shared";

export async function listChangeOrders(
  projectId: string
): Promise<ChangeOrderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("change_orders")
    .select("*")
    .eq("project_id", projectId)
    .order("number", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getChangeOrder(changeOrderId: string): Promise<{
  changeOrder: ChangeOrderRow;
  items: ChangeOrderItemRow[];
} | null> {
  const supabase = await createClient();
  const { data: changeOrder, error } = await supabase
    .from("change_orders")
    .select("*")
    .eq("id", changeOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!changeOrder) return null;

  const { data: items, error: itemsError } = await supabase
    .from("change_order_items")
    .select("*")
    .eq("change_order_id", changeOrderId)
    .order("created_at", { ascending: true });
  if (itemsError) throw itemsError;

  return { changeOrder, items };
}

export interface ApprovedChangeOrderTotals {
  count: number;
  laborUnits: number;
  addedDays: number;
  price: number;
}

// "The project keeps BOTH numbers" — current approved estimate is always
// original + these totals, computed live so there's no second stored
// figure to drift out of sync (ADR-043).
export async function getApprovedChangeOrderTotals(
  projectId: string
): Promise<ApprovedChangeOrderTotals> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("change_orders")
    .select("labor_units, added_days, price")
    .eq("project_id", projectId)
    .eq("status", "approved");
  if (error) throw error;

  return {
    count: data.length,
    laborUnits: data.reduce((sum, co) => sum + (co.labor_units ?? 0), 0),
    addedDays: data.reduce((sum, co) => sum + (co.added_days ?? 0), 0),
    price: data.reduce((sum, co) => sum + (co.price ?? 0), 0),
  };
}
