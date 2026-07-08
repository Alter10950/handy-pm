"use client";

import ExcelJS from "exceljs";
import Papa from "papaparse";

// Browser-only: reads whatever file the user picked (CSV via Papa, XLSX/XLS
// via ExcelJS — only the first worksheet, a documented simplification) into
// a plain headers+rows shape the import dialog's column-mapping step
// operates on. No upload/round trip needed before the user sees a preview,
// same "process locally, confirm with a Server Action" shape as the
// packing-slip AI extraction and paste-materials flows.
export interface SpreadsheetTable {
  headers: string[];
  rows: string[][];
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value && value.result !== undefined) {
      return cellToString(value.result as ExcelJS.CellValue);
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((run) => run.text).join("");
    }
    return "";
  }
  return String(value);
}

function parseCsv(text: string): SpreadsheetTable {
  const result = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
  const [headerRow, ...dataRows] = result.data;
  if (!headerRow) return { headers: [], rows: [] };
  return { headers: headerRow.map((h) => h.trim()), rows: dataRows };
}

async function parseExcel(buffer: ArrayBuffer): Promise<SpreadsheetTable> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const allRows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    // row.values is 1-indexed with index 0 always empty.
    const values = (row.values as ExcelJS.CellValue[]).slice(1);
    allRows.push(values.map(cellToString));
  });
  const [headerRow, ...dataRows] = allRows;
  if (!headerRow) return { headers: [], rows: [] };
  return { headers: headerRow.map((h) => h.trim()), rows: dataRows };
}

export async function parseSpreadsheetFile(
  file: File
): Promise<SpreadsheetTable> {
  const isCsv =
    file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
  if (isCsv) return parseCsv(await file.text());
  return parseExcel(await file.arrayBuffer());
}

// First exact case-insensitive header match against the synonym list, then
// a substring fallback — lets "Qty", "quantity", and "Total Needed (ea)" all
// resolve to the same target field without a full fuzzy-matching library.
export function guessColumnIndex(
  headers: string[],
  synonyms: string[]
): number {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  for (const synonym of synonyms) {
    const exact = normalized.indexOf(synonym);
    if (exact !== -1) return exact;
  }
  for (const synonym of synonyms) {
    const partial = normalized.findIndex((h) => h.includes(synonym));
    if (partial !== -1) return partial;
  }
  return -1;
}

export function cellAt(row: string[], columnIndex: number): string {
  if (columnIndex < 0) return "";
  return (row[columnIndex] ?? "").trim();
}
