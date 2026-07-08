import { ROLLING_WINDOW_DAYS } from "@/lib/estimating/labor";
import { loadCategoryTiers } from "@/lib/estimating/queries";
import { hoursPerUnitForMaterial } from "@/lib/estimating/standards";
import { createClient } from "@/lib/supabase/server";

// The per-SKU productivity flywheel (Phase 15, ADR-052): learns each
// crew's actual hours-per-unit PER SKU from the same rolling window of
// day_logs + installs the task-key learner uses — same blocker-day
// exclusion, same proportional attribution (no per-task time tracking
// exists, so a day's hours split across what was installed, weighted by
// each material's STANDARD hours). Output feeds resolveStandard()'s top
// tier, which is what makes estimates sharpen with every job.
//
// Only materials linked to a SKU (sku_id, set by the backfill or new
// writes) can teach — pre-catalog installs simply don't contribute, and
// the whole recompute no-ops gracefully until the Phase 13/14 migrations
// are approved.

export interface FlywheelResult {
  available: boolean;
  crewsUpdated: number;
  skusUpdated: number;
}

export async function recomputeCrewSkuRates(): Promise<FlywheelResult> {
  const supabase = await createClient();

  // Table-existence probe first — cheaper than doing all the work and
  // failing at the final upsert.
  const probe = await supabase.from("crew_sku_rates").select("id").limit(1);
  if (probe.error) {
    return { available: false, crewsUpdated: 0, skusUpdated: 0 };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };
  if (!profile?.org_id)
    return { available: false, crewsUpdated: 0, skusUpdated: 0 };

  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - ROLLING_WINDOW_DAYS);
  const windowStartStr = windowStart.toISOString().slice(0, 10);

  const [
    { data: dayLogs, error: dayLogsError },
    { data: blockers, error: blockersError },
    tiers,
  ] = await Promise.all([
    supabase
      .from("day_logs")
      .select("crew_id, project_id, work_date, install_start, install_end")
      .gte("work_date", windowStartStr)
      .not("crew_id", "is", null)
      .not("install_start", "is", null)
      .not("install_end", "is", null),
    supabase
      .from("blockers")
      .select("project_id, crew_id, work_date")
      .gte("work_date", windowStartStr)
      .not("crew_id", "is", null),
    loadCategoryTiers(),
  ]);
  if (dayLogsError) throw dayLogsError;
  if (blockersError) throw blockersError;

  const blockedKeys = new Set(
    blockers.map((b) => `${b.crew_id}|${b.project_id}|${b.work_date}`)
  );
  const qualifyingLogs = dayLogs.filter(
    (log) =>
      !blockedKeys.has(`${log.crew_id}|${log.project_id}|${log.work_date}`)
  );
  if (qualifyingLogs.length === 0) {
    return { available: true, crewsUpdated: 0, skusUpdated: 0 };
  }

  const projectIds = [...new Set(qualifyingLogs.map((l) => l.project_id))];
  const workDates = [...new Set(qualifyingLogs.map((l) => l.work_date))];

  const [
    { data: rows, error: rowsError },
    { data: installs, error: installsError },
  ] = await Promise.all([
    supabase.from("rows").select("id, project_id").in("project_id", projectIds),
    supabase
      .from("installs")
      .select("row_id, material_id, qty, crew_id, installed_on")
      .in("installed_on", workDates)
      .not("crew_id", "is", null),
  ]);
  if (rowsError) throw rowsError;
  if (installsError) throw installsError;

  const projectIdByRow = new Map(rows.map((r) => [r.id, r.project_id]));
  const materialIds = [...new Set(installs.map((i) => i.material_id))];
  const { data: materials, error: materialsError } =
    materialIds.length > 0
      ? await supabase
          .from("materials")
          .select("id, name, size, task_key, sku_id")
          .in("id", materialIds)
      : { data: [], error: null };
  if (materialsError) throw materialsError;
  const materialById = new Map(materials.map((m) => [m.id, m]));

  // Per (crew, project, day): standard hours + qty per SKU.
  interface DaySku {
    stdHours: number;
    qty: number;
  }
  const byDayKey = new Map<string, Map<string, DaySku>>();
  for (const install of installs) {
    if (install.qty <= 0) continue; // corrections don't teach
    const projectId = projectIdByRow.get(install.row_id);
    if (!projectId) continue;
    const material = materialById.get(install.material_id);
    if (!material?.sku_id) continue; // uncataloged — can't learn per-SKU
    const stdPerUnit = hoursPerUnitForMaterial(
      material.name,
      material.size,
      tiers,
      material.task_key
    );
    if (stdPerUnit <= 0) continue;
    const dayKey = `${install.crew_id}|${projectId}|${install.installed_on}`;
    const perSku = byDayKey.get(dayKey) ?? new Map<string, DaySku>();
    const entry = perSku.get(material.sku_id) ?? { stdHours: 0, qty: 0 };
    entry.stdHours += install.qty * stdPerUnit;
    entry.qty += install.qty;
    perSku.set(material.sku_id, entry);
    byDayKey.set(dayKey, perSku);
  }

  // Accumulate attributed hours + qty per (crew, sku).
  const perCrewSku = new Map<
    string,
    { hours: number; qty: number; days: number }
  >();
  for (const log of qualifyingLogs) {
    const dayKey = `${log.crew_id}|${log.project_id}|${log.work_date}`;
    const perSku = byDayKey.get(dayKey);
    if (!perSku) continue;
    const dayStdHours = [...perSku.values()].reduce(
      (sum, e) => sum + e.stdHours,
      0
    );
    if (dayStdHours <= 0) continue;
    const hoursThatDay =
      (new Date(log.install_end!).getTime() -
        new Date(log.install_start!).getTime()) /
      3_600_000;
    if (hoursThatDay <= 0) continue;

    for (const [skuId, entry] of perSku) {
      const attributed = hoursThatDay * (entry.stdHours / dayStdHours);
      const key = `${log.crew_id}|${skuId}`;
      const acc = perCrewSku.get(key) ?? { hours: 0, qty: 0, days: 0 };
      acc.hours += attributed;
      acc.qty += entry.qty;
      acc.days += 1;
      perCrewSku.set(key, acc);
    }
  }

  const upserts = [...perCrewSku.entries()]
    .filter(([, acc]) => acc.qty > 0 && acc.hours > 0)
    .map(([key, acc]) => {
      const [crewId, skuId] = key.split("|");
      return {
        org_id: profile.org_id!,
        crew_id: crewId,
        sku_id: skuId,
        hours_per_unit: Math.round((acc.hours / acc.qty) * 10000) / 10000,
        samples: acc.days,
        updated_at: new Date().toISOString(),
      };
    });

  if (upserts.length > 0) {
    const { error: upsertError } = await supabase
      .from("crew_sku_rates")
      .upsert(upserts, { onConflict: "crew_id,sku_id" });
    if (upsertError) throw upsertError;
  }

  const crews = new Set(upserts.map((u) => u.crew_id));
  const skus = new Set(upserts.map((u) => u.sku_id));
  return { available: true, crewsUpdated: crews.size, skusUpdated: skus.size };
}
