"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { importMaterials } from "@/lib/projects/actions";
import {
  cellAt,
  guessColumnIndex,
  parseSpreadsheetFile,
  type SpreadsheetTable,
} from "@/lib/projects/parse-spreadsheet";
import { upsertRowMaterialQtyMany } from "@/lib/rows/actions";
import type { MaterialCondition } from "@/lib/supabase/database.types";

type ImportMode = "materials" | "assignments";
type Status = "idle" | "parsing" | "review" | "error";

interface FieldConfig {
  key: string;
  label: string;
  required: boolean;
  synonyms: string[];
}

const MATERIAL_FIELDS: FieldConfig[] = [
  {
    key: "name",
    label: "Name",
    required: true,
    synonyms: ["name", "part", "material", "description", "item", "product"],
  },
  {
    key: "totalNeeded",
    label: "Total needed",
    required: true,
    synonyms: [
      "qty",
      "quantity",
      "needed",
      "total needed",
      "total_needed",
      "count",
    ],
  },
  {
    key: "unit",
    label: "Unit",
    required: false,
    synonyms: ["unit", "uom", "unit of measure"],
  },
  {
    key: "taskKey",
    label: "Task",
    required: false,
    synonyms: ["task", "task_key", "category", "type"],
  },
  {
    key: "size",
    label: "Size",
    required: false,
    synonyms: ["size", "dimension", "length", "height"],
  },
  { key: "profile", label: "Profile", required: false, synonyms: ["profile"] },
  {
    key: "capacity",
    label: "Capacity",
    required: false,
    synonyms: ["capacity", "rating", "load", "load capacity"],
  },
  {
    key: "condition",
    label: "Condition",
    required: false,
    synonyms: ["condition", "cond"],
  },
  {
    key: "compatibleSystem",
    label: "System",
    required: false,
    synonyms: ["system", "compatible system", "compatible_system", "brand"],
  },
];

const ASSIGNMENT_FIELDS: FieldConfig[] = [
  {
    key: "rowLabel",
    label: "Row",
    required: true,
    synonyms: ["row", "row label", "row name", "location"],
  },
  {
    key: "materialName",
    label: "Material",
    required: true,
    synonyms: ["material", "part", "name", "item"],
  },
  {
    key: "qty",
    label: "Qty",
    required: true,
    synonyms: ["qty", "quantity", "required", "required qty"],
  },
];

function fieldsForMode(mode: ImportMode): FieldConfig[] {
  return mode === "materials" ? MATERIAL_FIELDS : ASSIGNMENT_FIELDS;
}

function guessMapping(
  headers: string[],
  mode: ImportMode
): Record<string, number> {
  const mapping: Record<string, number> = {};
  for (const field of fieldsForMode(mode)) {
    mapping[field.key] = guessColumnIndex(headers, field.synonyms);
  }
  return mapping;
}

interface MaterialPreviewRow {
  index: number;
  error: string | null;
  name: string;
  unit: string;
  totalNeeded: number;
  taskKey: string;
  size: string | null;
  profile: string | null;
  capacity: string | null;
  condition: MaterialCondition;
  compatibleSystem: string | null;
}

interface AssignmentPreviewRow {
  index: number;
  error: string | null;
  rowLabelRaw: string;
  materialNameRaw: string;
  qty: number;
  resolvedRowId: string | null;
  resolvedMaterialId: string | null;
}

const PREVIEW_LIMIT = 50;

export function ImportMaterialsDialog({
  projectId,
  materials,
  rows,
}: {
  projectId: string;
  materials: { id: string; name: string }[];
  rows: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>("materials");
  const [status, setStatus] = useState<Status>("idle");
  const [table, setTable] = useState<SpreadsheetTable | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set());
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function resetState() {
    setStatus("idle");
    setTable(null);
    setMapping({});
    setExcludedRows(new Set());
    setError(null);
  }

  async function handleFile(file: File) {
    setError(null);
    setStatus("parsing");
    try {
      const parsed = await parseSpreadsheetFile(file);
      if (parsed.headers.length === 0) {
        throw new Error("Could not find any columns in that file.");
      }
      setTable(parsed);
      setMapping(guessMapping(parsed.headers, mode));
      setExcludedRows(new Set());
      setStatus("review");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Could not read that file."
      );
    }
  }

  function handleModeChange(nextMode: ImportMode) {
    setMode(nextMode);
    setExcludedRows(new Set());
    if (table) setMapping(guessMapping(table.headers, nextMode));
  }

  const preview = useMemo((): (MaterialPreviewRow | AssignmentPreviewRow)[] => {
    if (!table) return [];
    if (mode === "materials") {
      return table.rows.map((row, index): MaterialPreviewRow => {
        const name = cellAt(row, mapping.name);
        const totalNeededRaw = cellAt(row, mapping.totalNeeded);
        const totalNeeded = totalNeededRaw ? Number(totalNeededRaw) : NaN;
        const conditionRaw = cellAt(row, mapping.condition).toLowerCase();
        let rowError: string | null = null;
        if (!name) rowError = "Missing name";
        else if (!Number.isFinite(totalNeeded) || totalNeeded < 0) {
          rowError = "Missing/invalid quantity";
        }
        return {
          index,
          error: rowError,
          name,
          unit: cellAt(row, mapping.unit),
          totalNeeded: Number.isFinite(totalNeeded) ? totalNeeded : 0,
          taskKey: cellAt(row, mapping.taskKey),
          size: cellAt(row, mapping.size) || null,
          profile: cellAt(row, mapping.profile) || null,
          capacity: cellAt(row, mapping.capacity) || null,
          condition: conditionRaw === "used" ? "used" : "new",
          compatibleSystem: cellAt(row, mapping.compatibleSystem) || null,
        };
      });
    }

    const rowByLabel = new Map(
      rows.map((r) => [r.label.trim().toLowerCase(), r.id])
    );
    const materialByName = new Map(
      materials.map((m) => [m.name.trim().toLowerCase(), m.id])
    );
    return table.rows.map((row, index): AssignmentPreviewRow => {
      const rowLabelRaw = cellAt(row, mapping.rowLabel);
      const materialNameRaw = cellAt(row, mapping.materialName);
      const qtyRaw = cellAt(row, mapping.qty);
      const qty = qtyRaw ? Number(qtyRaw) : NaN;
      const resolvedRowId =
        rowByLabel.get(rowLabelRaw.trim().toLowerCase()) ?? null;
      const resolvedMaterialId =
        materialByName.get(materialNameRaw.trim().toLowerCase()) ?? null;

      let rowError: string | null = null;
      if (!rowLabelRaw) rowError = "Missing row";
      else if (!resolvedRowId) rowError = `No row named "${rowLabelRaw}"`;
      else if (!materialNameRaw) rowError = "Missing material";
      else if (!resolvedMaterialId) {
        rowError = `No material named "${materialNameRaw}"`;
      } else if (!Number.isFinite(qty) || qty < 0) {
        rowError = "Missing/invalid quantity";
      }

      return {
        index,
        error: rowError,
        rowLabelRaw,
        materialNameRaw,
        qty: Number.isFinite(qty) ? qty : 0,
        resolvedRowId,
        resolvedMaterialId,
      };
    });
  }, [table, mapping, mode, rows, materials]);

  const includedCount = preview.filter(
    (r) => !r.error && !excludedRows.has(r.index)
  ).length;
  const errorCount = preview.filter((r) => r.error).length;

  function toggleRow(index: number) {
    setExcludedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        const included = preview.filter(
          (r) => !r.error && !excludedRows.has(r.index)
        );
        if (included.length === 0) {
          throw new Error("Nothing to import — fix the mapping above.");
        }
        if (mode === "materials") {
          await importMaterials(
            projectId,
            (included as MaterialPreviewRow[]).map((r) => ({
              name: r.name,
              unit: r.unit || undefined,
              totalNeeded: r.totalNeeded,
              taskKey: r.taskKey || undefined,
              size: r.size,
              profile: r.profile,
              capacity: r.capacity,
              condition: r.condition,
              compatibleSystem: r.compatibleSystem,
            })),
            replaceExisting
          );
        } else {
          await upsertRowMaterialQtyMany(
            projectId,
            (included as AssignmentPreviewRow[]).map((r) => ({
              rowId: r.resolvedRowId!,
              materialId: r.resolvedMaterialId!,
              requiredQty: r.qty,
            }))
          );
        }
        setOpen(false);
        resetState();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not import.");
      }
    });
  }

  const fields = fieldsForMode(mode);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetState();
      }}
    >
      <DialogTrigger render={<Button type="button" variant="outline" />}>
        ⬆ Import from file
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import from CSV/XLSX</DialogTitle>
          <DialogDescription>
            Import a materials list, or set required quantities per row from a
            spreadsheet — map your columns, review the preview, then confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-md border border-border bg-muted p-1">
          <button
            type="button"
            data-testid="import-mode-materials"
            onClick={() => handleModeChange("materials")}
            className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${
              mode === "materials"
                ? "bg-surface text-foreground shadow-e1"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Materials list
          </button>
          <button
            type="button"
            data-testid="import-mode-assignments"
            onClick={() => handleModeChange("assignments")}
            className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${
              mode === "assignments"
                ? "bg-surface text-foreground shadow-e1"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Row assignments
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          data-testid="import-file-input"
          accept=".csv,.xlsx,.xls,text/csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleFile(file);
          }}
        />

        {status === "idle" || status === "error" ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8">
            <p className="text-sm text-muted-foreground">
              {mode === "materials"
                ? "One material per row — name and total needed at minimum."
                : "One (row, material, quantity) triple per line."}
            </p>
            <Button type="button" onClick={() => inputRef.current?.click()}>
              Choose file
            </Button>
            {status === "error" && error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
          </div>
        ) : null}

        {status === "parsing" ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Reading the file...
          </p>
        ) : null}

        {status === "review" && table ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {table.rows.length} row{table.rows.length === 1 ? "" : "s"}{" "}
                found in the file.
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => inputRef.current?.click()}
              >
                Choose a different file
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {fields.map((field) => (
                <div key={field.key} className="flex flex-col gap-1">
                  <Label
                    htmlFor={`import-map-${field.key}`}
                    className="text-xs"
                  >
                    {field.label}
                    {field.required ? " *" : ""}
                  </Label>
                  <select
                    id={`import-map-${field.key}`}
                    data-testid={`import-map-${field.key}`}
                    value={mapping[field.key] ?? -1}
                    onChange={(event) =>
                      setMapping((prev) => ({
                        ...prev,
                        [field.key]: Number(event.target.value),
                      }))
                    }
                    className="h-8 rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
                  >
                    <option value={-1}>— not mapped —</option>
                    {table.headers.map((header, index) => (
                      <option key={index} value={index}>
                        {header || `Column ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div
              className="max-h-[40vh] overflow-auto rounded-md border border-border"
              data-testid="import-preview-table"
            >
              <table className="w-full border-separate border-spacing-0 text-xs">
                <thead>
                  <tr>
                    <th className="sticky top-0 border-b border-border bg-muted p-2" />
                    {mode === "materials" ? (
                      <>
                        <th className="sticky top-0 border-b border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                          Name
                        </th>
                        <th className="sticky top-0 border-b border-border bg-muted p-2 text-right font-semibold text-muted-foreground">
                          Qty
                        </th>
                      </>
                    ) : (
                      <>
                        <th className="sticky top-0 border-b border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                          Row
                        </th>
                        <th className="sticky top-0 border-b border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                          Material
                        </th>
                        <th className="sticky top-0 border-b border-border bg-muted p-2 text-right font-semibold text-muted-foreground">
                          Qty
                        </th>
                      </>
                    )}
                    <th className="sticky top-0 border-b border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, PREVIEW_LIMIT).map((row) => (
                    <tr key={row.index}>
                      <td className="border-b border-border p-1.5">
                        <input
                          type="checkbox"
                          data-testid={`import-row-include-${row.index}`}
                          checked={!row.error && !excludedRows.has(row.index)}
                          disabled={Boolean(row.error)}
                          onChange={() => toggleRow(row.index)}
                          className="size-4 rounded border-border"
                        />
                      </td>
                      {mode === "materials" ? (
                        <>
                          <td className="border-b border-border p-1.5 text-foreground">
                            {(row as MaterialPreviewRow).name || "—"}
                          </td>
                          <td className="border-b border-border p-1.5 text-right tabular-nums text-foreground">
                            {(row as MaterialPreviewRow).totalNeeded}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="border-b border-border p-1.5 text-foreground">
                            {(row as AssignmentPreviewRow).rowLabelRaw || "—"}
                          </td>
                          <td className="border-b border-border p-1.5 text-foreground">
                            {(row as AssignmentPreviewRow).materialNameRaw ||
                              "—"}
                          </td>
                          <td className="border-b border-border p-1.5 text-right tabular-nums text-foreground">
                            {(row as AssignmentPreviewRow).qty}
                          </td>
                        </>
                      )}
                      <td className="border-b border-border p-1.5">
                        {row.error ? (
                          <span className="text-destructive">{row.error}</span>
                        ) : (
                          <span className="text-success-fg">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.length > PREVIEW_LIMIT ? (
                <p className="border-t border-border p-2 text-xs text-muted-foreground">
                  +{preview.length - PREVIEW_LIMIT} more row
                  {preview.length - PREVIEW_LIMIT === 1 ? "" : "s"} not shown,
                  but will be imported too.
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {includedCount} of {table.rows.length} will be imported
                {errorCount > 0 ? ` · ${errorCount} skipped (see Status)` : ""}.
              </p>
              {mode === "materials" ? (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={replaceExisting}
                    onChange={(event) =>
                      setReplaceExisting(event.target.checked)
                    }
                    className="size-4 rounded border-border"
                  />
                  Replace the current list
                </label>
              ) : null}
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            onClick={confirm}
            disabled={isPending || status !== "review" || includedCount === 0}
          >
            {isPending
              ? "Importing..."
              : mode === "materials"
                ? `Import ${includedCount} material${includedCount === 1 ? "" : "s"}`
                : `Import ${includedCount} assignment${includedCount === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
