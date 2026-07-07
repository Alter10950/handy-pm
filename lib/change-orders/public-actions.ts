"use server";

import { mergeApprovedChangeOrder } from "@/lib/change-orders/merge";
import { createAdminClient } from "@/lib/supabase/admin";

// The app's only unauthenticated write path: the customer deciding a
// change order from the emailed link. There is deliberately NO
// requireRole/requireOrg here — the single-purpose, unguessable,
// nulled-after-use token is the entire authorization (ADR-043), the same
// trust model as the read-only portal (ADR-035) extended to exactly two
// transitions on exactly one row. Every other write in the codebase
// still goes through a session + RLS.
//
// The status filter in each update is the replay/race guard: a token is
// only decidable while the CO is still pending_customer, and the first
// decision nulls the token — a second submit (double click, stale tab,
// forwarded email) finds no matching row and lands on the already-decided
// screen instead of flipping anything twice. The merge runs on the admin
// client for the same no-session reason as the reads.

export interface PublicDecisionResult {
  ok: boolean;
  error?: string;
}

export async function approveChangeOrderViaToken(
  token: string,
  approverName: string
): Promise<PublicDecisionResult> {
  const name = approverName.trim();
  if (!name) return { ok: false, error: "Please enter your name to approve." };
  if (!token || token.length < 16) return { ok: false, error: "Invalid link." };

  const admin = createAdminClient();
  const { data: co, error: findError } = await admin
    .from("change_orders")
    .select("id, project_id, status")
    .eq("approval_token", token)
    .maybeSingle();
  if (findError) {
    console.error("approveChangeOrderViaToken lookup failed", findError);
    return { ok: false, error: "Something went wrong — try again." };
  }
  if (!co || co.status !== "pending_customer") {
    return { ok: false, error: "This link is no longer valid." };
  }

  const { data: updated, error: updateError } = await admin
    .from("change_orders")
    .update({
      status: "approved",
      customer_approved_via: "email_link",
      customer_approved_at: new Date().toISOString(),
      customer_approver_name: name,
      approval_token: null,
    })
    .eq("id", co.id)
    .eq("status", "pending_customer")
    .select("id");
  if (updateError) {
    console.error("approveChangeOrderViaToken update failed", updateError);
    return { ok: false, error: "Something went wrong — try again." };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, error: "This link is no longer valid." };
  }

  try {
    await mergeApprovedChangeOrder(admin, co.id, co.project_id);
  } catch (err) {
    // The approval itself stood — surface the merge failure to the office
    // via logs rather than telling the customer their approval failed.
    console.error("mergeApprovedChangeOrder (public) failed", err);
  }

  // Deliberately NO revalidatePath here: it would make the customer's own
  // router refetch this page, whose token just went invalid — unmounting
  // the thank-you card mid-read (the same race as a manual
  // router.refresh, see change-order-decision.tsx). The office pages this
  // would have freshened are all force-dynamic and refetch per-request
  // anyway.
  return { ok: true };
}

export async function declineChangeOrderViaToken(
  token: string,
  note: string
): Promise<PublicDecisionResult> {
  if (!token || token.length < 16) return { ok: false, error: "Invalid link." };

  const admin = createAdminClient();
  const { data: co, error: findError } = await admin
    .from("change_orders")
    .select("id, project_id, status, description")
    .eq("approval_token", token)
    .maybeSingle();
  if (findError) {
    console.error("declineChangeOrderViaToken lookup failed", findError);
    return { ok: false, error: "Something went wrong — try again." };
  }
  if (!co || co.status !== "pending_customer") {
    return { ok: false, error: "This link is no longer valid." };
  }

  const trimmedNote = note.trim();
  const { data: updated, error: updateError } = await admin
    .from("change_orders")
    .update({
      status: "rejected",
      customer_approved_via: "email_link",
      customer_approved_at: new Date().toISOString(),
      approval_token: null,
      // A declined-with-note CO keeps the customer's words alongside the
      // office's own description rather than in a new column.
      ...(trimmedNote
        ? {
            description: `${co.description ? `${co.description}\n\n` : ""}Customer declined: ${trimmedNote}`,
          }
        : {}),
    })
    .eq("id", co.id)
    .eq("status", "pending_customer")
    .select("id");
  if (updateError) {
    console.error("declineChangeOrderViaToken update failed", updateError);
    return { ok: false, error: "Something went wrong — try again." };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, error: "This link is no longer valid." };
  }

  // No revalidatePath — same reasoning as the approve path above.
  return { ok: true };
}
