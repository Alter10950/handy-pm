import { addDays, todayIso } from "@/lib/dates";
import {
  classifySpi,
  computeProjectSpi,
  RISK_TIER_LABEL,
} from "@/lib/scheduler/spi";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BlockerCode } from "@/lib/supabase/database.types";

export type ReportPeriod = "daily" | "weekly";

export interface ReportBlocker {
  code: BlockerCode;
  note: string | null;
  workDate: string;
  resolved: boolean;
}

export interface ReportChangeOrder {
  number: number;
  title: string;
  status: string;
  addedDays: number | null;
  price: number | null;
}

export interface ProjectReportData {
  projectId: string;
  projectName: string;
  pct: number;
  riskLabel: string;
  spi: number | null;
  installsInPeriod: number;
  blockersInPeriod: ReportBlocker[];
  changeOrdersInPeriod: ReportChangeOrder[];
  forecastFinish: string | null;
  markingDrawingUrl: string | null;
  periodLabel: string;
}

function periodStartDate(period: ReportPeriod): string {
  const today = todayIso();
  return period === "daily" ? today : addDays(today, -6);
}

// Uses the service-role admin client throughout, not the per-request
// cookie-scoped one — this module is called from two places with very
// different auth contexts: a Vercel Cron request (no user session, no
// auth.uid() at all — RLS would return nothing, not an error) and the
// dashboard's manual "email now" button (a real session, but already
// gated by requireRole(["owner","pm"]) before this ever runs). Using
// admin uniformly means one code path works correctly in both, rather
// than a client-scoping branch that only gets exercised by one of them
// in practice. SPI/targets math is computed directly here (not via
// lib/scheduler/queries.ts's cookie-scoped helpers) for the same reason.
export async function buildProjectReportData(
  projectId: string,
  period: ReportPeriod
): Promise<ProjectReportData | null> {
  const admin = createAdminClient();
  const { data: project, error: projectError } = await admin
    .from("project_progress")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (projectError) throw projectError;
  if (!project) return null;

  const today = todayIso();
  const startDate = periodStartDate(period);

  const [
    { data: targets, error: targetsError },
    { data: rows, error: rowsError },
    { data: blockers, error: blockersError },
    { data: markingDrawing, error: drawingError },
    { data: latestEstimate, error: estimateError },
    { data: changeOrders, error: changeOrdersError },
  ] = await Promise.all([
    admin.from("targets").select("*").eq("project_id", projectId),
    admin.from("rows").select("id").eq("project_id", projectId),
    admin
      .from("blockers")
      .select("code, note, work_date, resolved_at")
      .eq("project_id", projectId)
      .gte("work_date", startDate)
      .lte("work_date", today),
    admin
      .from("drawings")
      .select("storage_path")
      .eq("project_id", projectId)
      .eq("role", "marking")
      .maybeSingle(),
    admin
      .from("project_estimates")
      .select("forecast_finish")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Any CO created OR decided in the window — a week-old CO that got
    // approved yesterday is this week's news too.
    admin
      .from("change_orders")
      .select(
        "number, title, status, added_days, price, created_at, customer_approved_at"
      )
      .eq("project_id", projectId)
      .or(
        `created_at.gte.${startDate}T00:00:00,customer_approved_at.gte.${startDate}T00:00:00`
      )
      .order("number"),
  ]);
  if (targetsError) throw targetsError;
  if (rowsError) throw rowsError;
  if (blockersError) throw blockersError;
  if (drawingError) throw drawingError;
  if (estimateError) throw estimateError;
  if (changeOrdersError) throw changeOrdersError;

  const rowIds = rows.map((r) => r.id);
  const [
    { data: installsInPeriodRaw, error: installsError },
    { data: installsAllTime, error: allTimeError },
  ] = await Promise.all([
    rowIds.length > 0
      ? admin
          .from("installs")
          .select("qty")
          .in("row_id", rowIds)
          .gte("installed_on", startDate)
          .lte("installed_on", today)
      : Promise.resolve({ data: [] as { qty: number }[], error: null }),
    rowIds.length > 0
      ? admin.from("installs").select("installed_on, qty").in("row_id", rowIds)
      : Promise.resolve({
          data: [] as { installed_on: string; qty: number }[],
          error: null,
        }),
  ]);
  if (installsError) throw installsError;
  if (allTimeError) throw allTimeError;

  const dailyActuals = new Map<string, number>();
  for (const install of installsAllTime) {
    dailyActuals.set(
      install.installed_on,
      (dailyActuals.get(install.installed_on) ?? 0) + install.qty
    );
  }

  const spi = computeProjectSpi(targets, dailyActuals);
  const markingDrawingUrl = markingDrawing
    ? ((
        await admin.storage
          .from("drawings")
          .createSignedUrl(markingDrawing.storage_path, 48 * 3600)
      ).data?.signedUrl ?? null)
    : null;

  return {
    projectId,
    projectName: project.name,
    pct: project.pct,
    riskLabel: RISK_TIER_LABEL[classifySpi(spi)],
    spi,
    installsInPeriod: installsInPeriodRaw.reduce((sum, i) => sum + i.qty, 0),
    blockersInPeriod: blockers.map((b) => ({
      code: b.code,
      note: b.note,
      workDate: b.work_date,
      resolved: b.resolved_at !== null,
    })),
    changeOrdersInPeriod: changeOrders.map((co) => ({
      number: co.number,
      title: co.title,
      status: co.status,
      addedDays: co.added_days,
      price: co.price,
    })),
    forecastFinish: latestEstimate?.forecast_finish ?? null,
    markingDrawingUrl,
    periodLabel: period === "daily" ? "today" : "this week",
  };
}
