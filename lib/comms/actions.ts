"use server";

import { revalidatePath } from "next/cache";
import { Resend } from "resend";

import { requireRole } from "@/lib/auth/session";
import {
  buildCustomerReportData,
  renderCustomerReportHtml,
} from "@/lib/comms/customer-report";
import { tryMilestone } from "@/lib/comms/milestones";
import { createClient } from "@/lib/supabase/server";
import type { CommsChannel } from "@/lib/supabase/database.types";

// project_comms RLS is owner/pm both ways; the customer-contact fields
// live on projects (owner/pm update). The finish-changed notice includes
// schedulers — they own the estimate saves that surface it.
const COMMS_MANAGERS = ["owner", "pm"] as const;
const FINISH_NOTIFIERS = ["owner", "pm", "scheduler"] as const;

const DEFAULT_FROM = "Handy PM <onboarding@resend.dev>";

function revalidateComms(projectId: string) {
  revalidatePath(`/app/project/${projectId}/comms`);
  revalidatePath(`/app/project/${projectId}`);
}

export async function updateCustomerContact(
  projectId: string,
  input: {
    name: string;
    email: string;
    commsMilestones: boolean;
    commsWeeklyReport: boolean;
  }
): Promise<void> {
  const email = input.email.trim();
  if (email && !email.includes("@")) {
    throw new Error("That doesn't look like a valid email address.");
  }
  await requireRole(COMMS_MANAGERS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({
      customer_contact_name: input.name.trim() || null,
      customer_contact_email: email || null,
      comms_milestones: input.commsMilestones,
      comms_weekly_report: input.commsWeeklyReport,
    })
    .eq("id", projectId);
  if (error) throw error;
  revalidateComms(projectId);
}

// Manual log entry — calls, texts, hallway conversations — so the comms
// log is the COMPLETE record of what the customer knows, not just the
// automated sends.
export async function logManualComm(
  projectId: string,
  input: { channel: CommsChannel; subject: string; body: string }
): Promise<void> {
  const subject = input.subject.trim();
  if (!subject) throw new Error("A short summary is required.");
  if (input.channel !== "logged_call" && input.channel !== "logged_other") {
    throw new Error("Manual entries are logged calls or other conversations.");
  }
  const { userId } = await requireRole(COMMS_MANAGERS);
  const supabase = await createClient();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("customer_contact_email")
    .eq("id", projectId)
    .single();
  if (projectError) throw projectError;

  const { error } = await supabase.from("project_comms").insert({
    project_id: projectId,
    kind: "manual",
    channel: input.channel,
    recipient: project.customer_contact_email,
    subject,
    body_snapshot: input.body.trim() || null,
    sent_by: userId,
  });
  if (error) throw error;
  revalidateComms(projectId);
}

// "Send an update now" — the weekly customer report on demand, e.g.
// right after a customer call asking where things stand. Bypasses the
// cron's stage filter (an explicit click IS the opt-in) but still
// requires an email on file.
export async function sendCustomerReportNow(projectId: string): Promise<void> {
  await requireRole(COMMS_MANAGERS);
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Email isn't configured (RESEND_API_KEY).");
  }
  const data = await buildCustomerReportData(projectId);
  if (!data) {
    throw new Error("No customer email on file — set it above first.");
  }

  const subject = `${data.projectName} — progress update`;
  const html = renderCustomerReportHtml(data);
  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
  const { error: sendError } = await resend.emails.send({
    from,
    to: [data.customerEmail],
    subject,
    html,
  });
  if (sendError) throw new Error(`Email failed to send: ${sendError.message}`);

  const supabase = await createClient();
  const { error: logError } = await supabase.from("project_comms").insert({
    project_id: projectId,
    kind: "weekly_report",
    channel: "email",
    recipient: data.customerEmail,
    subject,
    body_snapshot: html,
  });
  if (logError) throw logError;

  revalidateComms(projectId);
}

// The proactive schedule-slip notice: expected finish changed, with
// old → new and a HUMAN-WORDED, customer-safe reason ("material
// logistics", not "supplier shipped wrong beams"). Deliberately not
// fully automatic — the dates are detected by the estimate panel, the
// wording is the PM's (ADR-045).
export async function sendFinishChangedNotice(
  projectId: string,
  input: { oldFinish: string | null; newFinish: string; reason: string }
): Promise<void> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A customer-facing reason is required.");
  await requireRole(FINISH_NOTIFIERS);

  const result = await tryMilestone(projectId, "finish_changed", {
    subjectSuffix: "updated expected finish date",
    bodyLines: [
      input.oldFinish
        ? `Your project's expected finish has moved from <strong>${input.oldFinish}</strong> to <strong>${input.newFinish}</strong>.`
        : `Your project's expected finish is now <strong>${input.newFinish}</strong>.`,
      `Reason: ${reason}.`,
      "If you'd like to talk through the schedule, just reply to this email.",
    ],
    dedupe: false,
  });
  if (!result?.sent) {
    throw new Error(
      result?.skipped === "no_email"
        ? "No customer email on file — set it on the Comms tab first."
        : result?.skipped === "opted_out"
          ? "This project has milestone notifications turned off."
          : "Email isn't configured (RESEND_API_KEY)."
    );
  }

  revalidateComms(projectId);
  revalidatePath(`/app/project/${projectId}/estimate`);
}
