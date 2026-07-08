// Auto milestone notifications — the push channel (the portal stays
// pull). Not a "use server" file: these are side-effects called from
// other server code's success paths (schedule saves, stage advances,
// crew install logging), never directly from a client.
//
// Uses the service-role admin client throughout (same ADR-032 reasoning
// as reports): the triggering session varies wildly — a scheduler
// committing dates, an owner overriding a stage, a CREW member logging
// the install that crosses 50% — and project_comms RLS is office-only,
// so a cookie-scoped insert from the crew path would silently vanish.
// The milestone is the org talking to its customer, not the individual
// user; the admin client makes that identity explicit.
import { Resend } from "resend";

import { createAdminClient } from "@/lib/supabase/admin";

const DEFAULT_FROM = "Handy PM <onboarding@resend.dev>";

export type MilestoneKey =
  | "schedule_confirmed"
  | "install_started"
  | "pct_50"
  | "phase_complete"
  | "finish_changed"
  | "punch_complete"
  | "closeout_sent";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function milestoneHtml(
  customerName: string | null,
  projectName: string,
  bodyLines: string[]
): string {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
      <p style="font-size:15px;">Hi${customerName ? ` ${escapeHtml(customerName)}` : ""},</p>
      ${bodyLines.map((line) => `<p style="font-size:15px;">${line}</p>`).join("")}
      <p style="color:#999;font-size:12px;margin-top:24px;">
        Update on ${escapeHtml(projectName)} — sent automatically by Handy PM.
      </p>
    </div>`;
}

export interface MilestoneResult {
  sent: boolean;
  skipped: null | "no_email" | "opted_out" | "not_configured" | "already_sent";
}

// Sends one milestone email and logs it to project_comms — the log IS
// the dedupe: an exact (project, kind='milestone', subject) match means
// this milestone already went out (subjects are deterministic per key,
// and repeatable keys like finish_changed pass dedupe=false). Fully
// best-effort at every call site: a milestone must never fail the
// operation that triggered it.
export async function sendMilestone(
  projectId: string,
  key: MilestoneKey,
  options: {
    subjectSuffix: string;
    bodyLines: string[];
    dedupe?: boolean;
  }
): Promise<MilestoneResult> {
  const admin = createAdminClient();

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select(
      "name, comms_milestones, customer_contact_name, customer_contact_email"
    )
    .eq("id", projectId)
    .single();
  if (projectError) throw projectError;

  if (!project.comms_milestones) return { sent: false, skipped: "opted_out" };
  const email = project.customer_contact_email?.trim();
  if (!email) return { sent: false, skipped: "no_email" };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, skipped: "not_configured" };

  const subject = `${project.name}: ${options.subjectSuffix}`;

  if (options.dedupe !== false) {
    const { data: existing, error: existingError } = await admin
      .from("project_comms")
      .select("id")
      .eq("project_id", projectId)
      .eq("kind", "milestone")
      .eq("subject", subject)
      .limit(1);
    if (existingError) throw existingError;
    if (existing.length > 0) return { sent: false, skipped: "already_sent" };
  }

  const html = milestoneHtml(
    project.customer_contact_name,
    project.name,
    options.bodyLines
  );
  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
  const { error: sendError } = await resend.emails.send({
    from,
    to: [email],
    subject,
    html,
  });
  if (sendError)
    throw new Error(`Milestone email failed: ${sendError.message}`);

  const { error: logError } = await admin.from("project_comms").insert({
    project_id: projectId,
    kind: "milestone",
    channel: "email",
    recipient: email,
    subject,
    body_snapshot: html,
  });
  if (logError) throw logError;

  return { sent: true, skipped: null };
}

// The best-effort wrapper every hook actually calls — a milestone
// failure is logged, never thrown into the triggering operation.
// Returns the result (null on error) so a caller can react to a real
// send (e.g. ticking "Customer notified of schedule") without ever
// reacting to a skip.
export async function tryMilestone(
  projectId: string,
  key: MilestoneKey,
  options: { subjectSuffix: string; bodyLines: string[]; dedupe?: boolean }
): Promise<MilestoneResult | null> {
  try {
    return await sendMilestone(projectId, key, options);
  } catch (err) {
    console.error(`milestone ${key} for ${projectId} failed`, err);
    return null;
  }
}
