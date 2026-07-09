import { addDays, todayIso } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

// Batch 5 Sub-phase D: per-crew scorecard. A coaching tool, not
// surveillance — every metric carries context (blocked days are excluded
// from the "under target" count, and a small sample is flagged rather than
// judged). All reads are RLS-scoped; QC is guarded (pre-migration → the
// panel just omits it).

export interface DayPoint {
  date: string;
  output: number; // units installed
  target: number; // target units
  blocked: boolean;
}

export interface CrewScorecard {
  crewId: string;
  crewName: string;
  totalUnits: number;
  activeDays: number;
  avgPerDay: number;
  targetsHitPct: number | null; // over non-blocked days with a target
  nonBlockedTargetDays: number;
  blockerCountsByCode: { code: string; count: number }[];
  qcAvailable: boolean;
  qcPassPct: number | null;
  trend: DayPoint[];
  smallSample: boolean;
}

const BLOCKER_LABEL: Record<string, string> = {
  MISSING_MATERIAL: "Missing material",
  WRONG_MATERIAL: "Wrong material",
  CUSTOMER_DELAY: "Customer delay",
  AREA_BLOCKED: "Area blocked",
  FLOOR_ISSUE: "Floor issue",
  DRAWING_ISSUE: "Drawing issue",
  CREW_SHORT: "Crew short",
  EQUIPMENT_ISSUE: "Equipment issue",
  WEATHER_TRUCK: "Weather / truck",
  OTHER: "Other",
};

export function blockerLabel(code: string): string {
  return BLOCKER_LABEL[code] ?? code;
}

export async function getCrewScorecard(
  crewId: string,
  windowDays = 60
): Promise<CrewScorecard | null> {
  const supabase = await createClient();
  const { data: crew } = await supabase
    .from("crews")
    .select("id, name")
    .eq("id", crewId)
    .maybeSingle();
  if (!crew) return null;

  const today = todayIso();
  const start = addDays(today, -windowDays);

  const [
    { data: installs },
    { data: targets },
    { data: blockers },
    { data: dayLogs },
  ] = await Promise.all([
    supabase
      .from("installs")
      .select("installed_on, qty")
      .eq("crew_id", crewId)
      .gte("installed_on", start),
    supabase
      .from("targets")
      .select("work_date, target_qty")
      .eq("crew_id", crewId)
      .gte("work_date", start),
    supabase
      .from("blockers")
      .select("code, work_date")
      .eq("crew_id", crewId)
      .gte("work_date", start),
    supabase
      .from("day_logs")
      .select("work_date")
      .eq("crew_id", crewId)
      .gte("work_date", start),
  ]);

  const outputByDate = new Map<string, number>();
  for (const i of installs ?? [])
    outputByDate.set(
      i.installed_on,
      (outputByDate.get(i.installed_on) ?? 0) + (i.qty ?? 0)
    );
  const targetByDate = new Map<string, number>();
  for (const t of targets ?? [])
    targetByDate.set(
      t.work_date,
      (targetByDate.get(t.work_date) ?? 0) + (t.target_qty ?? 0)
    );
  const blockedDates = new Set((blockers ?? []).map((b) => b.work_date));

  const allDates = [
    ...new Set([
      ...outputByDate.keys(),
      ...targetByDate.keys(),
      ...(dayLogs ?? []).map((d) => d.work_date),
    ]),
  ].sort();

  const trend: DayPoint[] = allDates.map((date) => ({
    date,
    output: outputByDate.get(date) ?? 0,
    target: targetByDate.get(date) ?? 0,
    blocked: blockedDates.has(date),
  }));

  const totalUnits = [...outputByDate.values()].reduce((a, b) => a + b, 0);
  const activeDays = [...outputByDate.entries()].filter(
    ([, v]) => v > 0
  ).length;
  const avgPerDay = activeDays > 0 ? totalUnits / activeDays : 0;

  // Targets-hit only over days that HAD a target and were NOT blocked —
  // a blocked day isn't the crew's miss.
  const judgedDays = trend.filter((d) => d.target > 0 && !d.blocked);
  const hits = judgedDays.filter((d) => d.output >= d.target).length;
  const targetsHitPct =
    judgedDays.length > 0 ? (hits / judgedDays.length) * 100 : null;

  const blockerCounts = new Map<string, number>();
  for (const b of blockers ?? [])
    blockerCounts.set(b.code, (blockerCounts.get(b.code) ?? 0) + 1);
  const blockerCountsByCode = [...blockerCounts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  // QC pass rate on rows this crew installed (guarded).
  let qcAvailable = false;
  let qcPassPct: number | null = null;
  const { data: crewRowIds, error: rowsError } = await supabase
    .from("installs")
    .select("row_id")
    .eq("crew_id", crewId)
    .gte("installed_on", start);
  if (!rowsError && crewRowIds && crewRowIds.length > 0) {
    const rowIds = [...new Set(crewRowIds.map((r) => r.row_id))];
    const { data: qc, error: qcError } = await supabase
      .from("row_qc_checks")
      .select("passed")
      .in("row_id", rowIds);
    if (!qcError && qc) {
      qcAvailable = true;
      if (qc.length > 0) {
        qcPassPct =
          (qc.filter((c) => c.passed).length / qc.length) * 100;
      }
    }
  }

  return {
    crewId: crew.id,
    crewName: crew.name,
    totalUnits,
    activeDays,
    avgPerDay: avgPerDay,
    targetsHitPct,
    nonBlockedTargetDays: judgedDays.length,
    blockerCountsByCode,
    qcAvailable,
    qcPassPct,
    trend,
    smallSample: activeDays < 3,
  };
}
