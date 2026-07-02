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
