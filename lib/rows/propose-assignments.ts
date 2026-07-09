// Batch 5 Sub-phase B(2): row-assignment proposal. Pure, deterministic,
// unit-testable — no AI, no DB. Given a material's total required quantity
// and a set of rows, propose how many go on each row. Default is an even
// split with the remainder distributed to the first rows (so the totals
// always reconcile exactly). Bay counts, when known per row, weight the
// split proportionally instead. A human reviews the diff before it's
// written — this only proposes.

/** Split `total` across `count` rows: even, remainder to the front. */
export function evenSplit(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  let remainder = total - base * count;
  return Array.from({ length: count }, () => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return base + extra;
  });
}

/** Split `total` proportionally to per-row weights (e.g. bay counts),
 * remainder to the highest-weight rows. Falls back to even when weights
 * are all zero/absent. */
export function weightedSplit(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (sum <= 0) return evenSplit(total, weights.length);
  const raw = weights.map((w) => (total * Math.max(0, w)) / sum);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = total - floored.reduce((a, b) => a + b, 0);
  // Hand out the remaining units to the rows with the largest fractional
  // parts (stable, and keeps the proportional intent).
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floored];
  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i] += 1;
    remainder -= 1;
  }
  return result;
}

export interface ProposalRowInput {
  rowId: string;
  label: string;
  /** bays on this row, when detectable; undefined → even weight */
  bays?: number;
}

export interface ProposalMaterialInput {
  materialId: string;
  name: string;
  totalNeeded: number;
}

export interface ProposedEntry {
  rowId: string;
  materialId: string;
  requiredQty: number;
}

export interface MaterialProposal {
  materialId: string;
  name: string;
  totalNeeded: number;
  perRow: { rowId: string; label: string; qty: number }[];
}

/** Build a full proposal: one split per material across all rows. */
export function buildAssignmentProposal(
  materials: ProposalMaterialInput[],
  rows: ProposalRowInput[]
): { proposals: MaterialProposal[]; entries: ProposedEntry[] } {
  const hasBays = rows.some((r) => typeof r.bays === "number" && r.bays > 0);
  const weights = rows.map((r) => (hasBays ? (r.bays ?? 0) : 1));

  const proposals: MaterialProposal[] = [];
  const entries: ProposedEntry[] = [];
  for (const material of materials) {
    const split = hasBays
      ? weightedSplit(material.totalNeeded, weights)
      : evenSplit(material.totalNeeded, rows.length);
    const perRow = rows.map((row, i) => ({
      rowId: row.rowId,
      label: row.label,
      qty: split[i] ?? 0,
    }));
    proposals.push({
      materialId: material.materialId,
      name: material.name,
      totalNeeded: material.totalNeeded,
      perRow,
    });
    for (const cell of perRow) {
      entries.push({
        rowId: cell.rowId,
        materialId: material.materialId,
        requiredQty: cell.qty,
      });
    }
  }
  return { proposals, entries };
}
