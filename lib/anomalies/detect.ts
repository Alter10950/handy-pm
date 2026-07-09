// Batch 5 Sub-phase D: rules-based anomaly detection. PURE — no AI, no DB.
// Callers gather the inputs; this returns anomaly candidates with a stable
// dedupe_key so a nightly/close-of-day recompute upserts (a still-true
// anomaly is refreshed, not duplicated). Every rule is explainable and its
// thresholds are configurable; blocked days and tiny samples are excluded
// so a crew is never flagged for a day it was legitimately stuck.

export type AnomalyKind =
  | "spi_slipping"
  | "low_output"
  | "material_shortfall"
  | "idle_crew"
  | "estimate_drift";

export type Severity = "info" | "warn" | "critical";

export interface AnomalyCandidate {
  kind: AnomalyKind;
  severity: Severity;
  projectId: string | null;
  crewId: string | null;
  dedupeKey: string;
  summary: string;
  payload: Record<string, unknown>;
}

export interface AnomalyThresholds {
  /** SPI at/below this is 'risk' → flag (default 0.8) */
  spiRisk: number;
  /** SPI at/below this is critical (default 0.6) */
  spiCritical: number;
  /** a day's output below this fraction of the crew norm flags (default 0.5) */
  lowOutputFraction: number;
  /** ignore output rules on samples smaller than this many units (default 4) */
  minSampleUnits: number;
  /** flag a shortfall when working days until first need ≤ this (default 5) */
  shortfallLeadDays: number;
}

export const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  spiRisk: 0.8,
  spiCritical: 0.6,
  lowOutputFraction: 0.5,
  minSampleUnits: 4,
  shortfallLeadDays: 5,
};

export function resolveThresholds(
  overrides: Partial<AnomalyThresholds> | null | undefined
): AnomalyThresholds {
  return { ...DEFAULT_THRESHOLDS, ...(overrides ?? {}) };
}

// ── project schedule performance ──
export interface ProjectSpiInput {
  projectId: string;
  projectName: string;
  spi: number | null;
}

export function detectSpiAnomalies(
  projects: ProjectSpiInput[],
  t: AnomalyThresholds
): AnomalyCandidate[] {
  const out: AnomalyCandidate[] = [];
  for (const p of projects) {
    if (p.spi === null || p.spi > t.spiRisk) continue;
    const critical = p.spi <= t.spiCritical;
    out.push({
      kind: "spi_slipping",
      severity: critical ? "critical" : "warn",
      projectId: p.projectId,
      crewId: null,
      dedupeKey: `spi_slipping:${p.projectId}`,
      summary: `${p.projectName} is behind schedule (SPI ${p.spi.toFixed(2)}).`,
      payload: { spi: p.spi },
    });
  }
  return out;
}

// ── per-crew close-of-day output ──
export interface CrewDayInput {
  crewId: string;
  crewName: string;
  projectId: string | null;
  workDate: string;
  /** units installed that day */
  output: number;
  /** the crew's own norm (units/day) from learned rates, if known */
  norm: number | null;
  /** was a blocker logged that day? (excuses low output) */
  hadBlocker: boolean;
}

export function detectLowOutput(
  days: CrewDayInput[],
  t: AnomalyThresholds
): AnomalyCandidate[] {
  const out: AnomalyCandidate[] = [];
  for (const d of days) {
    if (d.norm === null || d.norm < t.minSampleUnits) continue;
    if (d.hadBlocker) continue; // legitimately stuck — never flag
    if (d.output >= d.norm * t.lowOutputFraction) continue;
    out.push({
      kind: "low_output",
      severity: "warn",
      projectId: d.projectId,
      crewId: d.crewId,
      dedupeKey: `low_output:${d.crewId}:${d.workDate}`,
      summary: `${d.crewName} installed ${d.output} on ${d.workDate}, well under their ~${Math.round(d.norm)}/day norm, with no blocker logged.`,
      payload: { output: d.output, norm: d.norm, workDate: d.workDate },
    });
  }
  return out;
}

// ── projected material shortfall ──
export interface ShortfallInput {
  projectId: string;
  projectName: string;
  materialId: string;
  materialName: string;
  toOrder: number; // still needs ordering
  /** working days until this project's first scheduled install, or null */
  leadDays: number | null;
}

export function detectShortfalls(
  items: ShortfallInput[],
  t: AnomalyThresholds
): AnomalyCandidate[] {
  const out: AnomalyCandidate[] = [];
  for (const s of items) {
    if (s.toOrder <= 0) continue;
    if (s.leadDays === null || s.leadDays > t.shortfallLeadDays) continue;
    out.push({
      kind: "material_shortfall",
      severity: s.leadDays <= 1 ? "critical" : "warn",
      projectId: s.projectId,
      crewId: null,
      dedupeKey: `material_shortfall:${s.projectId}:${s.materialId}`,
      summary: `${s.projectName} is short ${s.toOrder} × ${s.materialName} with install ${s.leadDays <= 0 ? "already due" : `in ${s.leadDays} working day${s.leadDays === 1 ? "" : "s"}`}.`,
      payload: { toOrder: s.toOrder, leadDays: s.leadDays, materialId: s.materialId },
    });
  }
  return out;
}

// ── idle scheduled crew-day ──
export interface IdleCrewInput {
  crewId: string;
  crewName: string;
  projectId: string;
  projectName: string;
  workDate: string; // a PAST working day the crew was assigned
  output: number; // units installed that day
  hadDayLog: boolean;
  hadBlocker: boolean;
}

export function detectIdleCrew(days: IdleCrewInput[]): AnomalyCandidate[] {
  const out: AnomalyCandidate[] = [];
  for (const d of days) {
    // Assigned + zero output + no day log + no blocker = an unexplained idle
    // crew-day (a day that was paid for but produced nothing on record).
    if (d.output > 0 || d.hadDayLog || d.hadBlocker) continue;
    out.push({
      kind: "idle_crew",
      severity: "warn",
      projectId: d.projectId,
      crewId: d.crewId,
      dedupeKey: `idle_crew:${d.crewId}:${d.workDate}`,
      summary: `${d.crewName} was scheduled on ${d.projectName} for ${d.workDate} but logged no work and no blocker.`,
      payload: { workDate: d.workDate },
    });
  }
  return out;
}

/** All rules over the gathered inputs, deduped by key. */
export function detectAllAnomalies(
  inputs: {
    spi: ProjectSpiInput[];
    crewDays: CrewDayInput[];
    shortfalls: ShortfallInput[];
    idle: IdleCrewInput[];
  },
  thresholds: AnomalyThresholds
): AnomalyCandidate[] {
  const all = [
    ...detectSpiAnomalies(inputs.spi, thresholds),
    ...detectLowOutput(inputs.crewDays, thresholds),
    ...detectShortfalls(inputs.shortfalls, thresholds),
    ...detectIdleCrew(inputs.idle),
  ];
  const seen = new Set<string>();
  return all.filter((a) =>
    seen.has(a.dedupeKey) ? false : (seen.add(a.dedupeKey), true)
  );
}
