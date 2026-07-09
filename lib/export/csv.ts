"use client";

// Client-side CSV download (design pass v3 F2) — UTF-8 with BOM so Excel
// opens it with correct encoding and column splits. Every grid's "Export
// CSV" goes through here. (XLSX was deliberately skipped: the only
// maintained npm build of SheetJS ships with an open ReDoS advisory, and
// BOM'd CSV opens natively in Excel — see docs/DECISIONS.md.)

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
): void {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
