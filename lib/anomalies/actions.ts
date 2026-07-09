"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import {
  type AnomalyCandidate,
  detectAllAnomalies,
  resolveThresholds,
  type IdleCrewInput,
  type ProjectSpiInput,
  type ShortfallInput,
} from "@/lib/anomalies/detect";
import {
  listActiveProjectsForDashboard,
  listShortagesAcrossProjects,
} from "@/lib/dashboard/queries";
import { addDays, todayIso } from "@/lib/dates";
import { getOrgSettings } from "@/lib/org/queries";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

const OFFICE = ["owner", "pm", "scheduler"] as const;

function workingDaysBetween(
  from: string,
  to: string,
  workingWeekdays: Set<number>
): number {
  if (to <= from) return 0;
  let count = 0;
  let cursor = from;
  for (let guard = 0; guard < 400 && cursor < to; guard += 1) {
    cursor = addDays(cursor, 1);
    if (workingWeekdays.has(new Date(`${cursor}T00:00:00`).getDay())) count += 1;
  }
  return count;
}

// Gather every anomaly input from current data and upsert anomaly_flags.
// Guarded: if the Batch-5 table isn't applied yet, this is a clean no-op.
// Open (unacknowledged) flags whose condition no longer holds are cleared,
// so the dashboard strip always reflects reality; acknowledged flags stay
// as history.
export async function recomputeAnomalies(): Promise<{
  available: boolean;
  count: number;
}> {
  const { orgId } = await requireRole(OFFICE);
  const supabase = await createClient();

  const org = await getOrgSettings();
  const thresholds = resolveThresholds(
    (org?.anomaly_settings as Record<string, number> | null) ?? null
  );
  const workingWeekdays = new Set(org?.default_working_days ?? [1, 2, 3, 4, 5]);
  const today = todayIso();

  // ── SPI ──
  const projects = await listActiveProjectsForDashboard();
  const spi: ProjectSpiInput[] = projects.map((p) => ({
    projectId: p.projectId,
    projectName: p.name,
    spi: p.spi,
  }));

  // ── shortfalls (needs lead time = working days to first scheduled day) ──
  const shortages = await listShortagesAcrossProjects();
  const shortfalls: ShortfallInput[] = [];
  if (shortages.length > 0) {
    const projectIds = [...new Set(shortages.map((s) => s.projectId))];
    const { data: schedule } = await supabase
      .from("project_schedule")
      .select("project_id, work_date")
      .in("project_id", projectIds)
      .gte("work_date", today);
    const firstDayByProject = new Map<string, string>();
    for (const row of schedule ?? []) {
      const cur = firstDayByProject.get(row.project_id);
      if (!cur || row.work_date < cur)
        firstDayByProject.set(row.project_id, row.work_date);
    }
    for (const s of shortages) {
      const firstDay = firstDayByProject.get(s.projectId) ?? null;
      shortfalls.push({
        projectId: s.projectId,
        projectName: s.projectName,
        materialId: s.materialId,
        materialName: s.materialName,
        toOrder: s.toOrder,
        leadDays: firstDay
          ? workingDaysBetween(today, firstDay, workingWeekdays)
          : null,
      });
    }
  }

  // ── idle scheduled crew-days (past 14 days) ──
  const windowStart = addDays(today, -14);
  const [{ data: assignments }, { data: installs }, { data: dayLogs }, { data: blockers }, { data: crews }, { data: projRows }] =
    await Promise.all([
      supabase
        .from("assignments")
        .select("crew_id, project_id, work_date")
        .gte("work_date", windowStart)
        .lt("work_date", today)
        .not("crew_id", "is", null),
      supabase
        .from("installs")
        .select("crew_id, installed_on, qty")
        .gte("installed_on", windowStart)
        .lt("installed_on", today),
      supabase
        .from("day_logs")
        .select("crew_id, project_id, work_date")
        .gte("work_date", windowStart)
        .lt("work_date", today),
      supabase
        .from("blockers")
        .select("crew_id, work_date")
        .gte("work_date", windowStart)
        .lt("work_date", today),
      supabase.from("crews").select("id, name"),
      supabase.from("projects").select("id, name"),
    ]);

  const crewName = new Map((crews ?? []).map((c) => [c.id, c.name]));
  const projName = new Map((projRows ?? []).map((p) => [p.id, p.name]));
  const outputByCrewDay = new Map<string, number>();
  for (const i of installs ?? []) {
    if (!i.crew_id) continue;
    const key = `${i.crew_id}:${i.installed_on}`;
    outputByCrewDay.set(key, (outputByCrewDay.get(key) ?? 0) + (i.qty ?? 0));
  }
  const dayLogSet = new Set(
    (dayLogs ?? []).map((d) => `${d.crew_id}:${d.work_date}`)
  );
  const blockerSet = new Set(
    (blockers ?? []).map((b) => `${b.crew_id}:${b.work_date}`)
  );
  const idle: IdleCrewInput[] = [];
  const seenAssignment = new Set<string>();
  for (const a of assignments ?? []) {
    if (!a.crew_id) continue;
    const key = `${a.crew_id}:${a.project_id}:${a.work_date}`;
    if (seenAssignment.has(key)) continue;
    seenAssignment.add(key);
    const wd = new Date(`${a.work_date}T00:00:00`).getDay();
    if (!workingWeekdays.has(wd)) continue;
    idle.push({
      crewId: a.crew_id,
      crewName: crewName.get(a.crew_id) ?? "Crew",
      projectId: a.project_id,
      projectName: projName.get(a.project_id) ?? "Project",
      workDate: a.work_date,
      output: outputByCrewDay.get(`${a.crew_id}:${a.work_date}`) ?? 0,
      hadDayLog: dayLogSet.has(`${a.crew_id}:${a.work_date}`),
      hadBlocker: blockerSet.has(`${a.crew_id}:${a.work_date}`),
    });
  }

  const candidates = detectAllAnomalies(
    { spi, crewDays: [], shortfalls, idle },
    thresholds
  );

  // Upsert current candidates; clear open flags that no longer apply.
  const { error: upsertError } = await supabase.from("anomaly_flags").upsert(
    candidates.map((c: AnomalyCandidate) => ({
      org_id: orgId,
      project_id: c.projectId,
      crew_id: c.crewId,
      kind: c.kind,
      severity: c.severity,
      payload: { ...c.payload, summary: c.summary } as unknown as Json,
      dedupe_key: c.dedupeKey,
    })),
    { onConflict: "org_id,dedupe_key" }
  );
  // Table missing (pre-migration) → clean no-op.
  if (upsertError) return { available: false, count: 0 };

  const liveKeys = new Set(candidates.map((c) => c.dedupeKey));
  const { data: openFlags } = await supabase
    .from("anomaly_flags")
    .select("id, dedupe_key")
    .eq("org_id", orgId)
    .is("acknowledged_at", null);
  const staleIds = (openFlags ?? [])
    .filter((f) => !liveKeys.has(f.dedupe_key))
    .map((f) => f.id);
  if (staleIds.length > 0) {
    await supabase.from("anomaly_flags").delete().in("id", staleIds);
  }

  revalidatePath("/app/dashboard");
  return { available: true, count: candidates.length };
}

// Fire-and-forget trigger for close-of-day: an office user closing a day
// refreshes the anomaly set; a crew close (no office role) is caught and
// skipped silently. Never throws — the day close is the source of truth.
export async function recomputeAnomaliesBestEffort(): Promise<void> {
  try {
    await recomputeAnomalies();
  } catch {
    // Not office, table absent, or transient — the manual "Check now" and
    // the daily job remain the guaranteed paths.
  }
}

export async function acknowledgeAnomaly(
  id: string,
  note?: string
): Promise<void> {
  const { userId } = await requireRole(OFFICE);
  const supabase = await createClient();
  const patch: { acknowledged_by: string; acknowledged_at: string; payload?: Json } =
    {
      acknowledged_by: userId,
      acknowledged_at: new Date().toISOString(),
    };
  if (note?.trim()) {
    // Fold the note into payload without clobbering the summary.
    const { data: existing } = await supabase
      .from("anomaly_flags")
      .select("payload")
      .eq("id", id)
      .maybeSingle();
    const base =
      existing?.payload && typeof existing.payload === "object"
        ? (existing.payload as Record<string, unknown>)
        : {};
    patch.payload = { ...base, ack_note: note.trim() } as unknown as Json;
  }
  const { error } = await supabase
    .from("anomaly_flags")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/app/dashboard");
}
