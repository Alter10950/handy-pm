import { addDays } from "@/lib/dates";

// Labor units are defined so that 1 labor unit = 1 hour of work at a
// "standard" pace (labor_standards.base_labor_units IS that standard
// hours-per-unit figure). A crew_rates.units_per_hour of 1.0 therefore
// means "installs at exactly standard pace"; 1.2 means 20% faster than
// standard. This is what makes the standard-pace fallback a clean,
// explainable 1.0 rather than an arbitrary number (see ADR-030).
export const HOURS_PER_CREW_DAY = 8;
export const ROLLING_WINDOW_DAYS = 90;
export const MIN_SAMPLES_FOR_CREW_RATE = 3;

// unit_basis values that scale with a material's physical size (height,
// length) vs. ones that are already "per each"/"per piece" regardless of
// size. Anything else (a company adds its own unit_basis later) is treated
// as size-independent — the conservative choice, since guessing wrong the
// other way (treating a per-each material as size-scaled) would silently
// multiply its labor units by an unrelated number.
const SIZE_SCALED_BASES = new Set(["per_ft_height", "per_linear_ft"]);

// Pulls the first number out of a free-text size field ("8 ft", "10' 6\"",
// "96in" → 8, 10, 96). Deliberately simple: a full dimensional-string
// parser (feet+inches, multiple dimensions) is real scope this sub-phase
// doesn't need — a leading number covers every size the codebase's own
// seeded task_keys actually call for (a single height or length), and a
// size that doesn't start with a number safely falls back to a factor of
// 1 (treated like a per-each material) rather than throwing or silently
// producing NaN.
export function parseLeadingNumber(size: string | null): number | null {
  if (!size) return null;
  const match = size.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function computeLaborUnits(
  baseLaborUnits: number,
  unitBasis: string,
  size: string | null
): number {
  if (!SIZE_SCALED_BASES.has(unitBasis)) return baseLaborUnits;
  const sizeNumber = parseLeadingNumber(size);
  return sizeNumber ? baseLaborUnits * sizeNumber : baseLaborUnits;
}

export interface LaborStandard {
  baseLaborUnits: number;
  unitBasis: string;
}

export function laborUnitsFor(
  standards: Map<string, LaborStandard>,
  taskKey: string,
  size: string | null
): number {
  const standard = standards.get(taskKey) ?? standards.get("general");
  if (!standard) return 1;
  return computeLaborUnits(standard.baseLaborUnits, standard.unitBasis, size);
}

export type RateSource = "crew" | "company" | "standard";

export interface ResolvedRate {
  unitsPerHour: number;
  source: RateSource;
}

export interface CrewRateLookup {
  unitsPerHour: number;
  samples: number;
}

// Three-tier fallback: this specific crew's own learned rate (once it has
// enough samples to trust) → the company-wide, samples-weighted blend
// across every crew → the standard pace of 1.0 if nobody has installed
// this task_key yet at all. See ADR-030 for why this order, not e.g.
// defaulting straight to 1.0 for an unrated crew.
export function resolveRate(
  taskKey: string,
  crewId: string | null,
  crewRates: Map<string, Map<string, CrewRateLookup>>,
  companyRates: Map<string, number>
): ResolvedRate {
  if (crewId) {
    const crewRate = crewRates.get(crewId)?.get(taskKey);
    if (
      crewRate &&
      crewRate.samples >= MIN_SAMPLES_FOR_CREW_RATE &&
      crewRate.unitsPerHour > 0
    ) {
      return { unitsPerHour: crewRate.unitsPerHour, source: "crew" };
    }
  }
  const companyRate = companyRates.get(taskKey);
  if (companyRate && companyRate > 0) {
    return { unitsPerHour: companyRate, source: "company" };
  }
  return { unitsPerHour: 1, source: "standard" };
}

// Walks forward day-by-day from `startDate`, crediting `crewCount` crew-days
// of progress on each of the org's working days-of-week, until it's
// accumulated enough crew-days to cover `remainingHours`. Deliberately
// doesn't consult the project's *existing* schedule/assignments (which
// might already vary crew count day to day) — the what-if tool models "N
// crews, steadily, from here" as an honest, simple approximation of a
// fundamentally speculative question, not a full simulation of a schedule
// that may not exist yet (see ADR-030).
export function forecastFinishDate(
  remainingHours: number,
  crewCount: number,
  workingDaysOfWeek: readonly number[],
  startDate: string
): { finishDate: string; crewDaysNeeded: number } {
  return forecastFinishFromCrewDays(
    remainingHours / HOURS_PER_CREW_DAY,
    crewCount,
    workingDaysOfWeek,
    startDate
  );
}

// Same walk, but fed crew-days directly — the Phase 13 engine computes
// crew-days itself (shift × efficiency, lib/estimating/engine.ts) so the
// date walker must not re-derive them from a bare hours/8.
export function forecastFinishFromCrewDays(
  crewDaysNeeded: number,
  crewCount: number,
  workingDaysOfWeek: readonly number[],
  startDate: string
): { finishDate: string; crewDaysNeeded: number } {
  const effectiveCrewCount = Math.max(1, crewCount);
  if (crewDaysNeeded <= 0) {
    return { finishDate: startDate, crewDaysNeeded: 0 };
  }

  const workingDays =
    workingDaysOfWeek.length > 0 ? workingDaysOfWeek : [1, 2, 3, 4, 5];
  let accumulated = 0;
  let cursor = startDate;
  const MAX_ITERATIONS = 3650;
  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const dayOfWeek = new Date(`${cursor}T00:00:00`).getDay();
    if (workingDays.includes(dayOfWeek)) {
      accumulated += effectiveCrewCount;
      if (accumulated >= crewDaysNeeded) {
        return { finishDate: cursor, crewDaysNeeded };
      }
    }
    cursor = addDays(cursor, 1);
  }
  return { finishDate: cursor, crewDaysNeeded };
}

export type EstimateConfidence = "high" | "medium" | "low";

// A coverage heuristic, not a statistical confidence interval: how much of
// the remaining labor is backed by a real, sufficiently-sampled rate
// (crew-specific counts fully, company-wide counts as partial evidence)
// vs. resting on the un-sampled standard-pace guess. Same "reasonable,
// documented heuristic, not a measured figure" posture as the SPI
// thresholds (ADR-022) and the seeded labor_standards values themselves.
export function computeConfidence(
  remainingByTaskKey: Map<string, number>,
  crewIds: readonly string[],
  crewRates: Map<string, Map<string, CrewRateLookup>>,
  companyRates: Map<string, number>
): EstimateConfidence {
  let totalUnits = 0;
  let coveredUnits = 0;
  for (const [taskKey, units] of remainingByTaskKey) {
    totalUnits += units;
    const hasCrewRate = crewIds.some((crewId) => {
      const rate = crewRates.get(crewId)?.get(taskKey);
      return rate && rate.samples >= MIN_SAMPLES_FOR_CREW_RATE;
    });
    if (hasCrewRate) {
      coveredUnits += units;
    } else if (companyRates.has(taskKey)) {
      coveredUnits += units * 0.5;
    }
  }
  if (totalUnits <= 0) return "low";
  const coverage = coveredUnits / totalUnits;
  if (coverage >= 0.7) return "high";
  if (coverage >= 0.3) return "medium";
  return "low";
}
