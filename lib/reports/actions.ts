"use server";

import { requireRole } from "@/lib/auth/session";
import { sendReports, type SendReportsResult } from "@/lib/reports/send";
import type { ReportPeriod } from "@/lib/reports/data";

const REPORT_SENDERS = ["owner", "pm"] as const;

// The manual "email now" counterpart to the cron-triggered send — same
// underlying sendReports(), same recipients, same content. Gated by
// requireRole rather than RLS, since sendReports itself uses the
// service-role admin client (see its own docstring for why).
export async function sendReportNow(
  period: ReportPeriod,
  projectId?: string
): Promise<SendReportsResult> {
  await requireRole(REPORT_SENDERS);
  return sendReports(period, projectId);
}
