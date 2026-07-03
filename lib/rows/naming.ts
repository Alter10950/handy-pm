// Sequential "Row N" auto-naming, matching the reference marking-tool
// prototype: scans ALL existing labels (across every drawing page in the
// project, not just the current one) for the highest N matching the
// prefix, and the next row continues from there — no user prompt.

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rowNumberPattern(prefix: string): RegExp {
  return new RegExp(`^${escapeRegExp(prefix.trim())}\\s*(\\d+)$`, "i");
}

export function maxRowNumber(labels: string[], prefix = "Row"): number {
  const pattern = rowNumberPattern(prefix);
  return labels.reduce((max, label) => {
    const match = pattern.exec(label.trim());
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);
}

export function nextRowLabel(labels: string[], prefix = "Row"): string {
  return `${prefix} ${maxRowNumber(labels, prefix) + 1}`;
}

// Extracts the N from a "Row N"-shaped label, or null for anything that
// doesn't match (e.g. a row a user renamed to something custom) — used to
// put rows in a stable, human-meaningful order for shift-click range
// selection ("select rows 2-11"), which raw DB/array order can't guarantee.
export function rowNumber(label: string, prefix = "Row"): number | null {
  const match = rowNumberPattern(prefix).exec(label.trim());
  return match ? Number(match[1]) : null;
}
