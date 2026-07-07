"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Resend } from "resend";

import { requireRole } from "@/lib/auth/session";
import { mergeApprovedChangeOrder } from "@/lib/change-orders/merge";
import { suggestedAddedDays } from "@/lib/change-orders/shared";
import { laborUnitsFor } from "@/lib/estimating/labor";
import { computeProjectEstimate, loadLaborStandardsMap } from "@/lib/estimating/queries";
import { touchProjectActivity } from "@/lib/projects/actions";
import { createClient } from "@/lib/supabase/server";
import type {
  ChangeOrderItemKind,
  ChangeOrderReason,
  ScopeWorkType,
} from "@/lib/supabase/database.types";

// Matches change_orders_write / change_order_items_write RLS exactly.
const CO_MANAGERS = ["owner", "pm"] as const;

const DEFAULT_FROM = "Handy PM <onboarding@resend.dev>";

function revalidateChangeOrders(projectId: string) {
  revalidatePath(`/app/project/${projectId}/change-orders`);
  revalidatePath(`/app/project/${projectId}`);
  revalidatePath(`/app/project/${projectId}/estimate`);
}

export async function createChangeOrder(
  projectId: string,
  input: { title: string; reason: ChangeOrderReason; description: string }
): Promise<void> {
  const title = input.title.trim();
  if (!title) throw new Error("A title is required.");
  const { userId } = await requireRole(CO_MANAGERS);
  const supabase = await createClient();

  // Sequential per-project numbering (CO-1, CO-2, …) — same
  // max-plus-one shape as project_gate_items.position (ADR-038); the
  // unique (project_id, number) constraint backstops a race.
  const { data: last, error: lastError } = await supabase
    .from("change_orders")
    .select("number")
    .eq("project_id", projectId)
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw lastError;

  const { data: created, error } = await supabase
    .from("change_orders")
    .insert({
      project_id: projectId,
      number: (last?.number ?? 0) + 1,
      title,
      reason: input.reason,
      description: input.description.trim() || null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw error;

  await touchProjectActivity(projectId);
  revalidateChangeOrders(projectId);
  redirect(`/app/project/${projectId}/change-orders/${created.id}`);
}

export async function updateChangeOrder(
  changeOrderId: string,
  projectId: string,
  patch: Partial<{
    title: string;
    description: string | null;
    reason: ChangeOrderReason;
    laborUnits: number | null;
    addedDays: number | null;
    price: number | null;
  }>
): Promise<void> {
  await requireRole(CO_MANAGERS);
  const supabase = await createClient();

  const { data: current, error: currentError } = await supabase
    .from("change_orders")
    .select("status")
    .eq("id", changeOrderId)
    .single();
  if (currentError) throw currentError;
  if (current.status !== "draft") {
    throw new Error("Only a draft change order can be edited.");
  }

  const dbPatch: {
    title?: string;
    description?: string | null;
    reason?: ChangeOrderReason;
    labor_units?: number | null;
    added_days?: number | null;
    price?: number | null;
  } = {};
  if (patch.title !== undefined) {
    const trimmed = patch.title.trim();
    if (!trimmed) throw new Error("A title is required.");
    dbPatch.title = trimmed;
  }
  if (patch.description !== undefined) dbPatch.description = patch.description;
  if (patch.reason !== undefined) dbPatch.reason = patch.reason;
  if (patch.laborUnits !== undefined) dbPatch.labor_units = patch.laborUnits;
  if (patch.addedDays !== undefined) dbPatch.added_days = patch.addedDays;
  if (patch.price !== undefined) dbPatch.price = patch.price;
  if (Object.keys(dbPatch).length === 0) return;

  const { error } = await supabase
    .from("change_orders")
    .update(dbPatch)
    .eq("id", changeOrderId);
  if (error) throw error;

  revalidateChangeOrders(projectId);
}

// Re-derives the CO's suggested labor_units (Σ line labor) and added_days
// after any line change. Deliberately overwrites: the suggestion tracks
// the lines until the office manually edits the figures right before
// sending — "auto-computed via the estimator (editable)" (ADR-043).
async function recomputeChangeOrderTotals(changeOrderId: string): Promise<void> {
  const supabase = await createClient();
  const { data: items, error } = await supabase
    .from("change_order_items")
    .select("labor_units")
    .eq("change_order_id", changeOrderId);
  if (error) throw error;

  const laborUnits =
    Math.round(items.reduce((sum, item) => sum + (item.labor_units ?? 0), 0) * 100) /
    100;
  const { error: updateError } = await supabase
    .from("change_orders")
    .update({ labor_units: laborUnits, added_days: suggestedAddedDays(laborUnits) })
    .eq("id", changeOrderId);
  if (updateError) throw updateError;
}

export async function addChangeOrderItem(
  changeOrderId: string,
  projectId: string,
  input: {
    kind: ChangeOrderItemKind;
    workType?: ScopeWorkType;
    description: string;
    qty?: number | null;
    unit?: string | null;
  }
): Promise<void> {
  const description = input.description.trim();
  if (!description) throw new Error("A description is required.");
  if (input.kind === "scope" && !input.workType) {
    throw new Error("A work type is required for scope lines.");
  }
  await requireRole(CO_MANAGERS);
  const supabase = await createClient();

  const { data: co, error: coError } = await supabase
    .from("change_orders")
    .select("status")
    .eq("id", changeOrderId)
    .single();
  if (coError) throw coError;
  if (co.status !== "draft") {
    throw new Error("Only a draft change order can be edited.");
  }

  // Same labor suggestions the rest of the app uses: a scope line prices
  // like a Scope-tab item (base units for its work_type × qty), a
  // material line like a materials row (per-unit units × qty; task_key
  // "general" — addMaterial's own default for a bare name).
  const standards = await loadLaborStandardsMap();
  const qty = input.qty && input.qty > 0 ? input.qty : null;
  const perUnit = laborUnitsFor(
    standards,
    input.kind === "scope" ? input.workType! : "general",
    null
  );
  const laborUnits = Math.round(perUnit * (qty ?? 1) * 100) / 100;

  const { error } = await supabase.from("change_order_items").insert({
    change_order_id: changeOrderId,
    kind: input.kind,
    work_type: input.kind === "scope" ? input.workType : null,
    description,
    qty,
    unit: input.unit?.trim() || null,
    labor_units: laborUnits,
  });
  if (error) throw error;

  await recomputeChangeOrderTotals(changeOrderId);
  revalidateChangeOrders(projectId);
}

export async function removeChangeOrderItem(
  itemId: string,
  changeOrderId: string,
  projectId: string
): Promise<void> {
  await requireRole(CO_MANAGERS);
  const supabase = await createClient();

  const { data: co, error: coError } = await supabase
    .from("change_orders")
    .select("status")
    .eq("id", changeOrderId)
    .single();
  if (coError) throw coError;
  if (co.status !== "draft") {
    throw new Error("Only a draft change order can be edited.");
  }

  const { error } = await supabase
    .from("change_order_items")
    .delete()
    .eq("id", itemId);
  if (error) throw error;

  await recomputeChangeOrderTotals(changeOrderId);
  revalidateChangeOrders(projectId);
}

// Snapshots the project's original estimate exactly once — the "before
// any change orders" baseline that keeps variance honest. Called from
// estimate→active conversion and (for projects created directly active)
// lazily at first CO approval.
export async function ensureOriginalEstimate(projectId: string): Promise<void> {
  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from("projects")
    .select("original_estimate_saved_at")
    .eq("id", projectId)
    .single();
  if (error) throw error;
  if (project.original_estimate_saved_at) return;

  const estimate = await computeProjectEstimate(projectId);
  const { error: updateError } = await supabase
    .from("projects")
    .update({
      original_estimate_labor_units: estimate.fullScopeLaborUnits,
      original_estimate_days: estimate.estimatedDays,
      original_estimate_saved_at: new Date().toISOString(),
    })
    .eq("id", projectId);
  if (updateError) throw updateError;
}

// Manual approval — "record verbal/written approval (who/when/how)."
export async function recordManualApproval(
  changeOrderId: string,
  projectId: string,
  input: { via: "verbal" | "written"; approverName: string }
): Promise<void> {
  const approverName = input.approverName.trim();
  if (!approverName) throw new Error("Who approved it? A name is required.");
  await requireRole(CO_MANAGERS);
  const supabase = await createClient();

  const { data: co, error: coError } = await supabase
    .from("change_orders")
    .select("status")
    .eq("id", changeOrderId)
    .single();
  if (coError) throw coError;
  if (co.status !== "draft" && co.status !== "pending_customer") {
    throw new Error("This change order has already been decided.");
  }

  // Baseline BEFORE the merge, so "original" never includes CO work.
  await ensureOriginalEstimate(projectId);

  const { error } = await supabase
    .from("change_orders")
    .update({
      status: "approved",
      customer_approved_via: input.via,
      customer_approved_at: new Date().toISOString(),
      customer_approver_name: approverName,
      approval_token: null,
    })
    .eq("id", changeOrderId);
  if (error) throw error;

  await mergeApprovedChangeOrder(supabase, changeOrderId, projectId);
  await touchProjectActivity(projectId);
  revalidateChangeOrders(projectId);
  revalidatePath(`/app/project/${projectId}/materials`);
  revalidatePath(`/app/project/${projectId}/scope`);
}

// Emails the customer a tokenized approve/decline link (Resend, same
// client-per-call shape as lib/reports/send.ts) and logs the send in
// project_comms — a CO going out IS a customer communication.
export async function sendChangeOrderForApproval(
  changeOrderId: string,
  projectId: string
): Promise<void> {
  const { userId } = await requireRole(CO_MANAGERS);
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Email isn't configured (RESEND_API_KEY) — record the customer's approval manually instead."
    );
  }
  const supabase = await createClient();

  const [{ data: co, error: coError }, { data: project, error: projectError }] =
    await Promise.all([
      supabase
        .from("change_orders")
        .select("status, number, title, description, labor_units, added_days, price")
        .eq("id", changeOrderId)
        .single(),
      supabase
        .from("projects")
        .select("name, org_id, customer_contact_name, customer_contact_email")
        .eq("id", projectId)
        .single(),
    ]);
  if (coError) throw coError;
  if (projectError) throw projectError;
  if (co.status !== "draft") {
    throw new Error("Only a draft change order can be sent for approval.");
  }
  const customerEmail = project.customer_contact_email?.trim();
  if (!customerEmail) {
    throw new Error(
      "No customer email on file — set it below first, or record approval manually."
    );
  }

  // Snapshot the baseline NOW, while an office session exists — the
  // customer's eventual tokenized approval runs with no session at all
  // and can't compute an estimate through RLS'd queries (ADR-043).
  await ensureOriginalEstimate(projectId);

  const token = randomBytes(16).toString("hex");
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.replace(/^(?!https?:\/\/)/, "https://") ||
    "http://localhost:3001";
  const approvalUrl = `${baseUrl}/portal/co/${token}`;

  const subject = `${project.name} — Change order CO-${co.number} needs your approval`;
  const priceLine =
    co.price !== null
      ? `<p style="margin:8px 0;font-size:15px;"><strong>Price:</strong> $${co.price.toLocaleString()}</p>`
      : "";
  const daysLine =
    co.added_days !== null && co.added_days > 0
      ? `<p style="margin:8px 0;font-size:15px;"><strong>Schedule impact:</strong> ~${co.added_days} added day(s)</p>`
      : "";
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
      <h1 style="font-size:20px;">Change order CO-${co.number}: ${escapeHtml(co.title)}</h1>
      <p style="font-size:15px;">Hi${project.customer_contact_name ? ` ${escapeHtml(project.customer_contact_name)}` : ""},</p>
      <p style="font-size:15px;">
        A change to the scope of <strong>${escapeHtml(project.name)}</strong> needs
        your approval before we proceed.
      </p>
      ${co.description ? `<p style="font-size:15px;">${escapeHtml(co.description)}</p>` : ""}
      ${priceLine}
      ${daysLine}
      <p style="margin:24px 0;">
        <a href="${approvalUrl}"
           style="background:#f2c00e;color:#1a1a1a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
          Review &amp; respond
        </a>
      </p>
      <p style="font-size:13px;color:#666;">
        Or copy this link: ${approvalUrl}
      </p>
    </div>`;

  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
  const { error: sendError } = await resend.emails.send({
    from,
    to: [customerEmail],
    subject,
    html,
  });
  if (sendError) throw new Error(`Email failed to send: ${sendError.message}`);

  const { error: updateError } = await supabase
    .from("change_orders")
    .update({
      status: "pending_customer",
      approval_token: token,
      sent_at: new Date().toISOString(),
      sent_to: customerEmail,
    })
    .eq("id", changeOrderId);
  if (updateError) throw updateError;

  const { error: commsError } = await supabase.from("project_comms").insert({
    project_id: projectId,
    kind: "change_order",
    channel: "email",
    recipient: customerEmail,
    subject,
    body_snapshot: html,
    sent_by: userId,
  });
  if (commsError) {
    console.error("project_comms log for CO send failed", commsError);
  }

  await touchProjectActivity(projectId);
  revalidateChangeOrders(projectId);
}

// Office-side decline/withdraw.
export async function rejectChangeOrder(
  changeOrderId: string,
  projectId: string
): Promise<void> {
  await requireRole(CO_MANAGERS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("change_orders")
    .update({ status: "rejected", approval_token: null })
    .eq("id", changeOrderId)
    .in("status", ["draft", "pending_customer"]);
  if (error) throw error;
  revalidateChangeOrders(projectId);
}

export async function cancelChangeOrder(
  changeOrderId: string,
  projectId: string
): Promise<void> {
  await requireRole(CO_MANAGERS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("change_orders")
    .update({ status: "cancelled", approval_token: null })
    .eq("id", changeOrderId)
    .in("status", ["draft", "pending_customer"]);
  if (error) throw error;
  revalidateChangeOrders(projectId);
}

// Small helper the CO detail page uses to capture the customer email
// inline when it's missing (full customer-comms management is Sub-phase
// H's job; a CO shouldn't be blocked on it).
export async function setCustomerContactEmail(
  projectId: string,
  email: string
): Promise<void> {
  const trimmed = email.trim();
  if (!trimmed || !trimmed.includes("@")) {
    throw new Error("A valid email address is required.");
  }
  await requireRole(CO_MANAGERS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ customer_contact_email: trimmed })
    .eq("id", projectId);
  if (error) throw error;
  revalidateChangeOrders(projectId);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
