// Parsing free-text material names/sizes into STRUCTURED SKU attributes
// (Phase 13.1). This runs ONCE — at backfill/import time — never at
// calculation time: the engine (lib/estimating/engine.ts) only accepts
// typed attributes, which is what makes the inches-as-feet class of bug
// unrepresentable there.

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

export interface ParsedSkuAttributes {
  category: SkuCategory;
  heightIn: number | null;
  depthIn: number | null;
  lengthIn: number | null;
  widthIn: number | null;
  weightLbs: number | null;
  /** true when the category was matched but dimensions couldn't be read */
  needsReview: boolean;
}

// Category from the material NAME — keyword classification, most-specific
// first. Unrecognized names land in 'other' + needsReview, never a guess.
export function classifyCategory(name: string): SkuCategory {
  const n = name.toLowerCase();
  if (/(wire\s*deck|wiredeck|wire\s*mesh\s*deck|\bdeck(ing)?\b)/.test(n)) return "wire_deck";
  if (/(row\s*spacer|\bspacer\b)/.test(n)) return "row_spacer";
  if (/(post\s*protector|column\s*protector|\bprotector\b)/.test(n)) return "post_protector";
  if (/(end\s*barrier|rack\s*guard|\bbarrier\b|end\s*of\s*aisle)/.test(n)) return "end_barrier";
  if (/(foot\s*plate|footplate|base\s*plate)/.test(n)) return "footplate";
  if (/\bshim\b/.test(n)) return "shim";
  if (/\banchor\b|wedge|\bbolt\b/.test(n)) return "anchor";
  if (/(upright|\bframe\b|column)/.test(n)) return "upright";
  if (/(\bbeam\b|step\s*beam|stepbeam|box\s*beam|load\s*beam)/.test(n)) return "beam";
  if (/(pallet\s*support|crossbar|safety\s*clip|\bclip\b|hardware)/.test(n)) return "accessory";
  return "other";
}

interface Dimension {
  inches: number;
}

// One dimension token → inches, with EXPLICIT unit handling:
//   42"  → 42 in     24'  → 288 in     8ft → 96 in     96in → 96
// A bare number is treated as inches (racking size strings are inch-
// denominated by convention) — the historical bug was treating these as
// FEET at calc time.
function parseDimension(token: string): Dimension | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:("|in(?:ch(?:es)?)?)|('|ft|feet))?\s*$/i.exec(token);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const isFeet = Boolean(m[3]);
  return { inches: isFeet ? value * 12 : value };
}

// Size strings arrive as `42"x24'`, `144"`, `42x46`, `96`, `1/2" x 3-3/4"`…
// We split on x/×, parse each side, and assign by category semantics.
export function parseSizeText(
  category: SkuCategory,
  sizeText: string | null | undefined
): ParsedSkuAttributes {
  const base: ParsedSkuAttributes = {
    category,
    heightIn: null,
    depthIn: null,
    lengthIn: null,
    widthIn: null,
    weightLbs: null,
    needsReview: false,
  };
  const text = (sizeText ?? "").trim();
  if (!text) {
    // Dimensionless categories are fine without a size; dimensioned ones
    // get flagged for manual review rather than silently guessed.
    base.needsReview = ["upright", "beam", "wire_deck"].includes(category);
    return base;
  }

  // Fractions like 1/2 or 3-3/4 (anchors) — not dimensions we model; keep
  // raw text, no review needed for anchors/accessories.
  const parts = text
    .split(/[x×]/i)
    .map((p) => parseDimension(p))
    .filter((d): d is Dimension => d !== null);

  switch (category) {
    case "upright": {
      // Convention: depth" x height (height often in feet: 42"x24').
      if (parts.length >= 2) {
        // The larger figure is the height; racking uprights are taller
        // than deep without exception.
        const [a, b] = [parts[0].inches, parts[1].inches];
        base.depthIn = Math.min(a, b);
        base.heightIn = Math.max(a, b);
      } else if (parts.length === 1) {
        base.heightIn = parts[0].inches;
        base.needsReview = true; // depth unknown
      } else {
        base.needsReview = true;
      }
      break;
    }
    case "beam": {
      if (parts.length >= 1) {
        base.lengthIn = Math.max(...parts.map((p) => p.inches));
        if (parts.length >= 2) {
          base.widthIn = Math.min(...parts.map((p) => p.inches)); // face height
        }
      } else {
        base.needsReview = true;
      }
      break;
    }
    case "wire_deck": {
      if (parts.length >= 2) {
        base.depthIn = Math.min(parts[0].inches, parts[1].inches);
        base.widthIn = Math.max(parts[0].inches, parts[1].inches);
      } else {
        base.needsReview = true;
      }
      break;
    }
    default: {
      // Anchors/spacers/protectors/etc: size is informational only.
      if (parts.length >= 1) base.lengthIn = parts[0].inches;
      break;
    }
  }
  return base;
}

/** Lift needed above 16 ft (192") — editable per SKU after backfill. */
export function requiresLift(heightIn: number | null): boolean {
  return heightIn !== null && heightIn >= 192;
}
