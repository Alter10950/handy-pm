import { Resend } from "resend";

import { buildProjectReportData, type ReportPeriod } from "@/lib/reports/data";
import { renderProjectReportHtml, reportSubject } from "@/lib/reports/render";
import { createAdminClient } from "@/lib/supabase/admin";

// Resend's sandbox sender (onboarding@resend.dev) can only deliver to the
// Resend account's own verified address until a custom domain is
// verified — a real production "from" needs RESEND_FROM_EMAIL set to an
// address on a verified domain. Documented as a NEEDS-YOU item; not a
// blocker for building/testing the feature itself.
const DEFAULT_FROM = "Handy PM <onboarding@resend.dev>";

export interface SendReportsResult {
  configured: boolean;
  projectsAttempted: number;
  projectsSent: number;
  recipientCount: number;
  errors: string[];
}

// Every owner/pm across every org (single-tenant in practice today, see
// auth_bootstrap.sql's own comment — looped rather than hardcoded to
// "the first org" so this keeps working if that ever changes) — reports
// are an internal, office-side concern (Batch 3); a customer-facing
// comms channel is explicitly a later batch's job, not this one's.
async function listReportRecipientEmails(): Promise<string[]> {
  const admin = createAdminClient();
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id")
    .in("role", ["owner", "pm"]);
  if (error) throw error;
  if (profiles.length === 0) return [];

  const emails = await Promise.all(
    profiles.map(async (profile) => {
      const { data, error: userError } = await admin.auth.admin.getUserById(
        profile.id
      );
      if (userError) throw userError;
      return data.user?.email ?? null;
    })
  );
  return emails.filter((email): email is string => Boolean(email));
}

async function listActiveProjectIds(): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("projects")
    .select("id, name")
    .eq("status", "active");
  if (error) throw error;
  return data;
}

// The one function both the cron route and the manual "email now" Server
// Action call — sends every active project's report (or just one, when
// projectId is given) to every owner/pm in the org. Returns a result
// object rather than throwing on missing config: a cron run or a button
// click should both get a clear "not configured" signal, not a 500.
export async function sendReports(
  period: ReportPeriod,
  projectId?: string
): Promise<SendReportsResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      configured: false,
      projectsAttempted: 0,
      projectsSent: 0,
      recipientCount: 0,
      errors: [],
    };
  }

  const [recipients, projects] = await Promise.all([
    listReportRecipientEmails(),
    projectId
      ? Promise.resolve([{ id: projectId, name: "" }])
      : listActiveProjectIds(),
  ]);
  if (recipients.length === 0 || projects.length === 0) {
    return {
      configured: true,
      projectsAttempted: projects.length,
      projectsSent: 0,
      recipientCount: recipients.length,
      errors: [],
    };
  }

  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
  const errors: string[] = [];
  let projectsSent = 0;

  for (const project of projects) {
    try {
      const data = await buildProjectReportData(project.id, period);
      if (!data) continue;
      const { error } = await resend.emails.send({
        from,
        to: recipients,
        subject: reportSubject(data, period),
        html: renderProjectReportHtml(data),
      });
      if (error) {
        errors.push(`${project.name || project.id}: ${error.message}`);
        continue;
      }
      projectsSent += 1;
    } catch (err) {
      errors.push(
        `${project.name || project.id}: ${err instanceof Error ? err.message : "unknown error"}`
      );
    }
  }

  return {
    configured: true,
    projectsAttempted: projects.length,
    projectsSent,
    recipientCount: recipients.length,
    errors,
  };
}
