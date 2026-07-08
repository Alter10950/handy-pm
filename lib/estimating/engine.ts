// ── The estimate engine (Phase 13.3) ──
//
// Pure, unit-typed, dependency-free — no Supabase, no parsing, no Date.
// Callers load data; this module does math. The three bugs it exists to
// make unrepresentable (ADR-049):
//   (1) UNIT BUG — inches fed into a per-linear-FOOT rate (12× inflation).
//       Here every dimension is a typed `inches` number and conversion to
//       feet happens in exactly one visible place.
//   (2) MODEL BUG — beam install labor is per-PIECE handling (two-person
//       set + lock-in), with length/weight as secondary MODIFIERS — never
//       length × rate as the driver.
//   (3) LUMPING BUG — standards resolve per SKU with structured
//       attributes; category defaults are only the fallback tier.
//
// Resolution precedence: learned crew×SKU rate → per-SKU standard →
// category default (with attribute modifiers). Every line carries its
// SOURCE and a CONFIDENCE, and guardrails flag implausible outputs.

export type SkuCategory =
  | "upright"
  | "beam"
  | "wire_deck"
  | "row_spacer"
  | "anchor"
  | "end_barrier"
  | "post_protector"
  | "footplate"
  | "shim"
  | "accessory"
  | "other";

export interface SkuAttributes {
  category: SkuCategory;
  heightIn?: number | null;
  lengthIn?: number | null;
  weightLbs?: number | null;
  requiresLift?: boolean | null;
}

export interface LearnedRate {
  /** hours per unit, already SKU-specific (embeds size reality) */
  hoursPerUnit: number;
  samples: number;
}

export type StandardSource = "learned" | "sku" | "category" | "none";
export type Confidence = "high" | "medium" | "low";

export interface ResolvedStandard {
  hoursPerUnit: number;
  source: StandardSource;
  confidence: Confidence;
  samples: number;
  /** human-readable modifier trail, e.g. ["length >144in ×1.3"] */
  modifiers: string[];
}

/** Explicit, single-place unit conversion — the only feet in the module. */
export function inchesToFeet(inches: number): number {
  return inches / 12;
}

// ── Attribute modifiers (13.2): size/weight bands scale the CATEGORY
// default only — per-SKU standards and learned rates already embody the
// SKU's reality and are used as-is. ──
function categoryModifiers(attrs: SkuAttributes): { factor: number; trail: string[] } {
  const trail: string[] = [];
  let factor = 1;
  if (attrs.category === "beam") {
    const length = attrs.lengthIn ?? null;
    if (length !== null && length > 144) {
      factor *= 1.3;
      trail.push(`length >144in ×1.3`);
    } else if (length !== null && length > 96) {
      factor *= 1.15;
      trail.push(`length 97–144in ×1.15`);
    }
    if ((attrs.weightLbs ?? 0) > 100) {
      factor *= 1.2;
      trail.push(`weight >100lbs ×1.2`);
    }
  } else if (attrs.category === "upright") {
    const height = attrs.heightIn ?? null;
    if (height !== null && height > 192) {
      factor *= 1.4;
      trail.push(`height >192in ×1.4`);
    } else if (height !== null && height > 144) {
      factor *= 1.2;
      trail.push(`height 145–192in ×1.2`);
    }
    if (attrs.requiresLift) {
      factor *= 1.25;
      trail.push(`lift required ×1.25`);
    }
  } else if (attrs.category === "wire_deck") {
    if ((attrs.weightLbs ?? 0) > 60) {
      factor *= 1.2;
      trail.push(`weight >60lbs ×1.2`);
    }
  }
  return { factor, trail };
}

export function resolveStandard(input: {
  attrs: SkuAttributes;
  learned?: LearnedRate | null;
  /** per-SKU standard override, hours per unit */
  skuStandard?: number | null;
  /** category default, hours per unit at standard pace */
  categoryDefault?: number | null;
  /** samples needed before a learned rate outranks the standards */
  minLearnedSamples?: number;
}): ResolvedStandard {
  const minSamples = input.minLearnedSamples ?? 3;

  if (input.learned && input.learned.samples >= minSamples && input.learned.hoursPerUnit > 0) {
    return {
      hoursPerUnit: input.learned.hoursPerUnit,
      source: "learned",
      confidence: input.learned.samples >= 8 ? "high" : "medium",
      samples: input.learned.samples,
      modifiers: [],
    };
  }
  if (input.skuStandard !== null && input.skuStandard !== undefined && input.skuStandard > 0) {
    return {
      hoursPerUnit: input.skuStandard,
      source: "sku",
      confidence: "medium",
      samples: 0,
      modifiers: [],
    };
  }
  if (
    input.categoryDefault !== null &&
    input.categoryDefault !== undefined &&
    input.categoryDefault > 0
  ) {
    const { factor, trail } = categoryModifiers(input.attrs);
    return {
      hoursPerUnit: round4(input.categoryDefault * factor),
      source: "category",
      confidence: "low",
      samples: 0,
      modifiers: trail,
    };
  }
  return { hoursPerUnit: 0, source: "none", confidence: "low", samples: 0, modifiers: [] };
}

// ── Guardrails (13.3): a bad standard must never silently ship. ──
const MAX_HOURS_PER_UNIT: Record<SkuCategory, number> = {
  upright: 2,
  beam: 0.5,
  wire_deck: 0.3,
  row_spacer: 0.2,
  anchor: 0.25,
  end_barrier: 1.5,
  post_protector: 0.75,
  footplate: 0.2,
  shim: 0.1,
  accessory: 1,
  other: 2,
};

/** Sanity ceiling for a whole-project forecast, in crew-days. */
export const MAX_SANE_CREW_DAYS = 400;

export function standardWarnings(
  category: SkuCategory,
  hoursPerUnit: number
): string[] {
  const max = MAX_HOURS_PER_UNIT[category];
  if (hoursPerUnit > max) {
    return [
      `Implausible standard: ${hoursPerUnit} h/unit for a ${category} (sanity ceiling ${max} h). Check the SKU's labor standard.`,
    ];
  }
  return [];
}

export interface EstimateLineInput {
  skuId: string | null;
  name: string;
  attrs: SkuAttributes;
  quantity: number;
  installedQuantity: number;
  learned?: LearnedRate | null;
  skuStandard?: number | null;
  categoryDefault?: number | null;
}

export interface EstimateLine {
  skuId: string | null;
  name: string;
  category: SkuCategory;
  quantity: number;
  remainingQuantity: number;
  hoursPerUnit: number;
  source: StandardSource;
  confidence: Confidence;
  samples: number;
  modifiers: string[];
  totalHours: number;
  remainingHours: number;
  warnings: string[];
}

/** Canonical rule: line_hours = quantity × standard_hours_per_unit(SKU). */
export function computeLine(input: EstimateLineInput): EstimateLine {
  const resolved = resolveStandard(input);
  const quantity = Math.max(0, input.quantity);
  const remainingQuantity = Math.max(0, quantity - Math.max(0, input.installedQuantity));
  return {
    skuId: input.skuId,
    name: input.name,
    category: input.attrs.category,
    quantity,
    remainingQuantity,
    hoursPerUnit: resolved.hoursPerUnit,
    source: resolved.source,
    confidence: resolved.confidence,
    samples: resolved.samples,
    modifiers: resolved.modifiers,
    totalHours: round2(quantity * resolved.hoursPerUnit),
    remainingHours: round2(remainingQuantity * resolved.hoursPerUnit),
    warnings: standardWarnings(input.attrs.category, resolved.hoursPerUnit),
  };
}

export interface ProjectEstimate {
  lines: EstimateLine[];
  totalHours: number;
  remainingHours: number;
  warnings: string[];
}

export function computeProjectLines(inputs: EstimateLineInput[]): ProjectEstimate {
  const lines = inputs.map(computeLine);
  const totalHours = round2(lines.reduce((sum, line) => sum + line.totalHours, 0));
  const remainingHours = round2(
    lines.reduce((sum, line) => sum + line.remainingHours, 0)
  );
  return {
    lines,
    totalHours,
    remainingHours,
    warnings: lines.flatMap((line) => line.warnings),
  };
}

export interface CrewDayInput {
  remainingHours: number;
  crewSize: number;
  shiftHours?: number;
  /** 0–1; real crews don't install 100% of a shift */
  efficiency?: number;
}

export function computeCrewDays(input: CrewDayInput): {
  crewDays: number;
  warnings: string[];
} {
  const shiftHours = input.shiftHours ?? 8;
  const efficiency = Math.min(1, Math.max(0.1, input.efficiency ?? 0.85));
  const capacityPerDay = Math.max(1, input.crewSize) * shiftHours * efficiency;
  const crewDays = input.remainingHours / capacityPerDay;
  const warnings =
    crewDays > MAX_SANE_CREW_DAYS
      ? [
          `Forecast of ${Math.round(crewDays)} crew-days exceeds the sanity horizon (${MAX_SANE_CREW_DAYS}) — a labor standard is almost certainly wrong.`,
        ]
      : [];
  return { crewDays: round2(crewDays), warnings };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
