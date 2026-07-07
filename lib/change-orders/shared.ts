// Pure types/labels — zero server-only imports, safe for Client
// Components to import directly. See lib/gates/shared.ts for why this
// split exists in this codebase.
import type {
  ChangeOrderReason,
  ChangeOrderStatus,
  Tables,
} from "@/lib/supabase/database.types";

export type ChangeOrderRow = Tables<"change_orders">;
export type ChangeOrderItemRow = Tables<"change_order_items">;

export const CO_REASON_LABEL: Record<ChangeOrderReason, string> = {
  scope_missed: "Scope missed in estimate",
  customer_request: "Customer request",
  site_condition: "Site condition",
  material_issue: "Material issue",
  other: "Other",
};

export const CO_STATUS_LABEL: Record<ChangeOrderStatus, string> = {
  draft: "Draft",
  pending_customer: "Pending customer",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const CO_STATUS_BADGE_CLASS: Record<ChangeOrderStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_customer: "bg-primary/15 text-primary",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function coLabel(number: number): string {
  return `CO-${number}`;
}

// Suggested added-days from a CO's total labor units — standard pace
// (1 labor unit = 1 hour, ADR-030) over the same 8-hour crew day the
// whole estimator uses. Deliberately simpler than
// computeProjectEstimate's crew-rate blend: a draft CO is a quote-time
// figure the office reviews and can overwrite, not a schedule forecast.
export function suggestedAddedDays(laborUnits: number): number {
  if (laborUnits <= 0) return 0;
  return Math.round((laborUnits / 8) * 100) / 100;
}
