// The bridge between free-text materials and the typed engine (Phase 13
// wiring, ADR-051). Attributes are parsed at read time from (name, size)
// until the material_skus catalog is populated; once materials carry
// sku_id + catalog rows exist, the persisted attributes win (they're
// office-editable, the parse is only a first guess).

import type {
  EstimateLineInput,
  LearnedRate,
  SkuCategory,
} from "@/lib/estimating/engine";
import {
  CATEGORY_DEFAULT_HOURS,
  resolveStandard,
} from "@/lib/estimating/engine";
import {
  classifyCategory,
  extractSizeFromName,
  parseSizeText,
  requiresLift,
} from "@/lib/skus/parse";

export interface MaterialForEstimate {
  id: string;
  name: string;
  size: string | null;
  totalNeeded: number;
  installed: number;
  skuId?: string | null;
}

export interface SkuCatalogEntry {
  category: SkuCategory;
  heightIn: number | null;
  lengthIn: number | null;
  weightLbs: number | null;
  requiresLift: boolean;
}

export interface StandardTiers {
  /** corrected per-each category rows from labor_standards (see below) */
  categoryHours: Partial<Record<SkuCategory, number>>;
  /** per-SKU overrides from sku_labor_standards, keyed by sku_id */
  skuHours: Map<string, number>;
  /** learned crew×SKU rates (samples-gated in the engine), keyed by sku_id */
  learned: Map<string, LearnedRate>;
}

// The material WRITE path stores labor_units (hours/unit at standard
// pace) on each row — scheduler remaining-labor math reads it. This is
// the corrected computation for that stored figure: parse once, resolve
// through the engine. (The Estimate tab itself recomputes live and never
// trusts the stored value.) An explicit task_key that names a known
// category (user reclassified in the grid) outranks name classification.
export function hoursPerUnitForMaterial(
  name: string,
  size: string | null,
  tiers: StandardTiers,
  taskKeyHint?: string | null
): number {
  const category: SkuCategory =
    taskKeyHint && taskKeyHint in CATEGORY_DEFAULT_HOURS
      ? (taskKeyHint as SkuCategory)
      : classifyCategory(name);
  const parsed = parseSizeText(
    category,
    size?.trim() ? size : extractSizeFromName(name)
  );
  const resolved = resolveStandard({
    attrs: {
      category,
      heightIn: parsed.heightIn,
      lengthIn: parsed.lengthIn,
      weightLbs: parsed.weightLbs,
      requiresLift: requiresLift(parsed.heightIn),
    },
    categoryDefault: resolveCategoryDefault(category, tiers),
  });
  return resolved.hoursPerUnit;
}

// A labor_standards row only participates if its semantics are per-piece.
// The pre-Phase-13 seeds ('per_linear_ft' beam, 'per_ft_height' upright)
// are the poisoned rows the engine exists to neutralize — they're ignored
// here and the in-code CATEGORY_DEFAULT_HOURS takes over, so the fix
// holds even before the corrective migration runs.
export function categoryHoursFromDb(
  rows: { task_key: string; base_labor_units: number; unit_basis: string }[]
): Partial<Record<SkuCategory, number>> {
  const out: Partial<Record<SkuCategory, number>> = {};
  for (const row of rows) {
    if (row.unit_basis !== "per_each" && row.unit_basis !== "per_piece")
      continue;
    if (!(row.task_key in CATEGORY_DEFAULT_HOURS)) continue;
    const category = row.task_key as SkuCategory;
    if (row.base_labor_units > 0) out[category] = row.base_labor_units;
  }
  return out;
}

export function resolveCategoryDefault(
  category: SkuCategory,
  tiers: StandardTiers
): number {
  return tiers.categoryHours[category] ?? CATEGORY_DEFAULT_HOURS[category];
}

/** One material row → one typed engine line. */
export function materialToLineInput(
  material: MaterialForEstimate,
  tiers: StandardTiers,
  catalog?: SkuCatalogEntry | null
): EstimateLineInput {
  const category = catalog?.category ?? classifyCategory(material.name);
  const parsed = catalog
    ? null
    : parseSizeText(
        category,
        material.size?.trim()
          ? material.size
          : extractSizeFromName(material.name)
      );
  const heightIn = catalog ? catalog.heightIn : (parsed?.heightIn ?? null);
  const skuId = material.skuId ?? null;
  return {
    skuId,
    name: material.size ? `${material.name} — ${material.size}` : material.name,
    attrs: {
      category,
      heightIn,
      lengthIn: catalog ? catalog.lengthIn : (parsed?.lengthIn ?? null),
      weightLbs: catalog ? catalog.weightLbs : (parsed?.weightLbs ?? null),
      requiresLift: catalog ? catalog.requiresLift : requiresLift(heightIn),
    },
    quantity: material.totalNeeded,
    installedQuantity: material.installed,
    learned: skuId ? (tiers.learned.get(skuId) ?? null) : null,
    skuStandard: skuId ? (tiers.skuHours.get(skuId) ?? null) : null,
    categoryDefault: resolveCategoryDefault(category, tiers),
  };
}
