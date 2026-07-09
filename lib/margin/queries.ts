import { getProjectRemainingLaborUnits } from "@/lib/scheduler/queries";
import { createClient } from "@/lib/supabase/server";

// Batch 5 Sub-phase F: per-project job cost + margin. Quote (manual, or
// from QuickBooks when connected) + approved change orders, vs actual
// labor cost to date, vs forecast-at-completion (adds the estimator's
// remaining hours at the crews' blended rate). Owner-only in the UI —
// costs never surface to crew. Guarded: quoted_amount is read via
// select("*") so the panel still works before the quote migration (it
// just shows "set a quote"); crews without cost_per_hour are excluded
// from the cost side with a note.

export interface ProjectMargin {
  quotedAmount: number | null;
  approvedChangeOrders: number;
  quote: number | null; // quotedAmount + approved COs
  laborHoursToDate: number;
  laborCostToDate: number | null;
  blendedRate: number | null; // $/hr across crews that have a rate
  remainingHours: number;
  forecastCost: number | null; // laborCost + remainingHours × blendedRate
  marginToDate: number | null; // quote − laborCostToDate
  forecastMargin: number | null; // quote − forecastCost
  crewsMissingRate: number;
  quoteColumnAvailable: boolean;
}

function shiftHours(
  start: string | null,
  end: string | null
): number {
  if (start && end) {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (Number.isFinite(ms) && ms > 0) return ms / 3_600_000;
  }
  // A logged day with no precise times counts as one 8-hour shift.
  return 8;
}

export async function getProjectMargin(
  projectId: string
): Promise<ProjectMargin> {
  const supabase = await createClient();

  const [
    { data: project },
    { data: cos },
    { data: dayLogs },
    { data: crews },
    remainingHours,
  ] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
    supabase
      .from("change_orders")
      .select("price, status")
      .eq("project_id", projectId)
      .eq("status", "approved"),
    supabase
      .from("day_logs")
      .select("crew_id, install_start, install_end")
      .eq("project_id", projectId),
    supabase.from("crews").select("id, cost_per_hour"),
    getProjectRemainingLaborUnits(projectId),
  ]);

  const quoteColumnAvailable =
    project !== null && "quoted_amount" in project;
  const quotedAmount =
    project && "quoted_amount" in project
      ? ((project as { quoted_amount: number | null }).quoted_amount ?? null)
      : null;

  const approvedChangeOrders = (cos ?? []).reduce(
    (sum, c) => sum + (c.price ?? 0),
    0
  );
  const quote =
    quotedAmount === null && approvedChangeOrders === 0
      ? null
      : (quotedAmount ?? 0) + approvedChangeOrders;

  const rateByCrew = new Map(
    (crews ?? []).map((c) => [c.id, c.cost_per_hour])
  );

  let laborHoursToDate = 0;
  let laborCostToDate = 0;
  let costableHours = 0;
  let ratedHourWeight = 0;
  let ratedHours = 0;
  const crewsWithLogs = new Set<string>();
  const crewsMissingRate = new Set<string>();
  for (const log of dayLogs ?? []) {
    const hours = shiftHours(log.install_start, log.install_end);
    laborHoursToDate += hours;
    if (log.crew_id) {
      crewsWithLogs.add(log.crew_id);
      const rate = rateByCrew.get(log.crew_id);
      if (rate != null) {
        laborCostToDate += hours * rate;
        costableHours += hours;
        ratedHourWeight += rate * hours;
        ratedHours += hours;
      } else {
        crewsMissingRate.add(log.crew_id);
      }
    }
  }

  const anyRate = (crews ?? []).some((c) => c.cost_per_hour != null);
  const blendedRate =
    ratedHours > 0
      ? ratedHourWeight / ratedHours
      : anyRate
        ? avgRate(crews ?? [])
        : null;

  const haveCost = costableHours > 0 || (anyRate && laborHoursToDate === 0);
  const laborCostToDateOut = haveCost ? laborCostToDate : anyRate ? 0 : null;
  const forecastCost =
    blendedRate === null
      ? null
      : (laborCostToDateOut ?? 0) + remainingHours * blendedRate;

  return {
    quotedAmount,
    approvedChangeOrders,
    quote,
    laborHoursToDate,
    laborCostToDate: laborCostToDateOut,
    blendedRate,
    remainingHours,
    forecastCost,
    marginToDate:
      quote !== null && laborCostToDateOut !== null
        ? quote - laborCostToDateOut
        : null,
    forecastMargin:
      quote !== null && forecastCost !== null ? quote - forecastCost : null,
    crewsMissingRate: crewsMissingRate.size,
    quoteColumnAvailable,
  };
}

function avgRate(crews: { cost_per_hour: number | null }[]): number | null {
  const rates = crews
    .map((c) => c.cost_per_hour)
    .filter((r): r is number => r != null);
  if (rates.length === 0) return null;
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

export interface CompanyMarginRow {
  projectId: string;
  name: string;
  quote: number | null;
  forecastCost: number | null;
  forecastMargin: number | null;
}

// Owner-only company roll-up — one line per active project.
export async function getCompanyMargin(): Promise<CompanyMarginRow[]> {
  const supabase = await createClient();
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, name")
    .eq("status", "active")
    .order("name");
  if (error) return [];
  const rows = await Promise.all(
    (projects ?? []).map(async (p) => {
      const m = await getProjectMargin(p.id);
      return {
        projectId: p.id,
        name: p.name,
        quote: m.quote,
        forecastCost: m.forecastCost,
        forecastMargin: m.forecastMargin,
      };
    })
  );
  return rows;
}
