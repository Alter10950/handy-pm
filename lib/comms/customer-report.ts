// The customer-facing weekly report — the SAFE twin of the internal
// report (lib/reports/): % complete, what happened this week, next
// week's plan, expected finish. Deliberately NEVER includes shortages,
// costs, SPI/risk labels, blocker details, or reconciliation — those are
// internal-report content (ADR-045). Admin client throughout, same
// no-session cron reasoning as lib/reports/data.ts.
import { Resend } from "resend";

import { addDays, todayIso } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";

const DEFAULT_FROM = "Handy PM <onboarding@resend.dev>";

export interface CustomerReportData {
  projectId: string;
  projectName: string;
  customerName: string | null;
  customerEmail: string;
  pct: number;
  installsThisWeek: number;
  daysWorkedThisWeek: number;
  scheduledDaysNextWeek: number;
  forecastFinish: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export async function buildCustomerReportData(
  projectId: string
): Promise<CustomerReportData | null> {
  const admin = createAdminClient();
  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("name, customer_contact_name, customer_contact_email")
    .eq("id", projectId)
    .single();
  if (projectError) throw projectError;
  const customerEmail = project.customer_contact_email?.trim();
  if (!customerEmail) return null;

  const today = todayIso();
  const weekStart = addDays(today, -6);
  const nextWeekEnd = addDays(today, 7);

  const [
    { data: progress, error: progressError },
    { data: rows, error: rowsError },
    { data: schedule, error: scheduleError },
    { data: latestEstimate, error: estimateError },
  ] = await Promise.all([
    admin.from("project_progress").select("pct").eq("project_id", projectId).maybeSingle(),
    admin.from("rows").select("id").eq("project_id", projectId),
    admin
      .from("project_schedule")
      .select("work_date")
      .eq("project_id", projectId)
      .gt("work_date", today)
      .lte("work_date", nextWeekEnd),
    admin
      .from("project_estimates")
      .select("forecast_finish")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (progressError) throw progressError;
  if (rowsError) throw rowsError;
  if (scheduleError) throw scheduleError;
  if (estimateError) throw estimateError;

  const rowIds = rows.map((r) => r.id);
  const { data: installs, error: installsError } =
    rowIds.length > 0
      ? await admin
          .from("installs")
          .select("qty, installed_on")
          .in("row_id", rowIds)
          .gte("installed_on", weekStart)
          .lte("installed_on", today)
      : { data: [] as { qty: number; installed_on: string }[], error: null };
  if (installsError) throw installsError;

  return {
    projectId,
    projectName: project.name,
    customerName: project.customer_contact_name,
    customerEmail,
    pct: progress?.pct ?? 0,
    installsThisWeek: installs.reduce((sum, i) => sum + Math.max(0, i.qty), 0),
    daysWorkedThisWeek: new Set(installs.map((i) => i.installed_on)).size,
    scheduledDaysNextWeek: schedule.length,
    forecastFinish: latestEstimate?.forecast_finish ?? null,
  };
}

export function renderCustomerReportHtml(data: CustomerReportData): string {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
      <h1 style="font-size:20px;margin-bottom:4px;">${escapeHtml(data.projectName)} — weekly update</h1>
      <p style="font-size:15px;">Hi${data.customerName ? ` ${escapeHtml(data.customerName)}` : ""},</p>

      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr>
          <td style="padding:8px;border:1px solid #eee;font-size:13px;color:#666;">Complete</td>
          <td style="padding:8px;border:1px solid #eee;font-size:15px;font-weight:bold;">${Math.round(data.pct * 100)}%</td>
        </tr>
        <tr>
          <td style="padding:8px;border:1px solid #eee;font-size:13px;color:#666;">This week</td>
          <td style="padding:8px;border:1px solid #eee;font-size:15px;font-weight:bold;">${data.installsThisWeek} units installed across ${data.daysWorkedThisWeek} work day${data.daysWorkedThisWeek === 1 ? "" : "s"}</td>
        </tr>
        <tr>
          <td style="padding:8px;border:1px solid #eee;font-size:13px;color:#666;">Next week</td>
          <td style="padding:8px;border:1px solid #eee;font-size:15px;font-weight:bold;">${data.scheduledDaysNextWeek} scheduled work day${data.scheduledDaysNextWeek === 1 ? "" : "s"}</td>
        </tr>
        <tr>
          <td style="padding:8px;border:1px solid #eee;font-size:13px;color:#666;">Expected finish</td>
          <td style="padding:8px;border:1px solid #eee;font-size:15px;font-weight:bold;">${
            data.forecastFinish ? formatDate(data.forecastFinish) : "To be confirmed"
          }</td>
        </tr>
      </table>

      <p style="font-size:14px;">
        Questions? Just reply — your project manager reads these.
      </p>
      <p style="color:#999;font-size:12px;margin-top:24px;">Sent automatically by Handy PM.</p>
    </div>
  `;
}

export interface SendCustomerReportsResult {
  configured: boolean;
  attempted: number;
  sent: number;
  errors: string[];
}

// Weekly customer reports for every opted-in project actively executing
// (Execute or Punch stage) — rides the existing weekly cron alongside
// the internal reports. "Default on while in Execute": the flag defaults
// true at the schema level; the stage filter is what keeps a project
// from mailing its customer before work starts or after closeout.
export async function sendCustomerReports(): Promise<SendCustomerReportsResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { configured: false, attempted: 0, sent: 0, errors: [] };

  const admin = createAdminClient();
  const { data: projects, error } = await admin
    .from("projects")
    .select("id, name")
    .eq("status", "active")
    .eq("comms_weekly_report", true)
    .in("stage_key", ["execute", "punch"])
    .not("customer_contact_email", "is", null);
  if (error) throw error;

  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
  const errors: string[] = [];
  let sent = 0;

  for (const project of projects) {
    try {
      const data = await buildCustomerReportData(project.id);
      if (!data) continue;
      const subject = `${data.projectName} — weekly progress update`;
      const html = renderCustomerReportHtml(data);
      const { error: sendError } = await resend.emails.send({
        from,
        to: [data.customerEmail],
        subject,
        html,
      });
      if (sendError) {
        errors.push(`${project.name}: ${sendError.message}`);
        continue;
      }
      const { error: logError } = await admin.from("project_comms").insert({
        project_id: project.id,
        kind: "weekly_report",
        channel: "email",
        recipient: data.customerEmail,
        subject,
        body_snapshot: html,
      });
      if (logError) {
        errors.push(`${project.name}: log failed — ${logError.message}`);
        continue;
      }
      sent += 1;
    } catch (err) {
      errors.push(
        `${project.name}: ${err instanceof Error ? err.message : "unknown error"}`
      );
    }
  }

  return { configured: true, attempted: projects.length, sent, errors };
}
