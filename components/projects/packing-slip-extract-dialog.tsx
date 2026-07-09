"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusPill, type PillTone } from "@/components/ui/status-pill";
import { confirmExtractedMaterials } from "@/lib/projects/actions";
import { markExtractionRunResolved } from "@/lib/extraction/actions";
import { cn } from "@/lib/utils";

interface ExtractedRow {
  code: string;
  description: string;
  size: string;
  qty: number;
  isMaterial: boolean;
  confidence: number | null;
  // Included in the commit? Defaults to isMaterial, user-overridable.
  include: boolean;
}

type Status = "idle" | "extracting" | "review" | "error";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function asQty(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function confidenceTone(c: number | null): PillTone {
  if (c === null) return "neutral";
  if (c >= 0.85) return "success";
  if (c >= 0.6) return "warning";
  return "danger";
}
function confidenceLabel(c: number | null): string {
  if (c === null) return "—";
  return `${Math.round(c * 100)}%`;
}

const ACCEPT_THRESHOLD = 0.85;

export function PackingSlipExtractDialog({
  projectId,
  storagePath,
  slipName,
  previewUrl,
  testId,
}: {
  projectId: string;
  storagePath: string;
  slipName: string;
  /** signed URL for the side-by-side source preview, when available */
  previewUrl?: string | null;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [rows, setRows] = useState<ExtractedRow[]>([]);
  const [duplicateKeys, setDuplicateKeys] = useState<Set<string>>(new Set());
  const [runId, setRunId] = useState<string | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function keyOf(row: ExtractedRow): string {
    return `${row.code.trim().toLowerCase()}|${row.size.trim().toLowerCase()}|${row.description.trim().toLowerCase()}`;
  }

  async function startExtraction() {
    setOpen(true);
    setStatus("extracting");
    setError(null);
    try {
      const response = await fetch("/api/packing-slips/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storagePath, projectId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Extraction failed.");
      const items = Array.isArray(data.items) ? data.items : [];
      setRows(
        items.map((item: Record<string, unknown>) => {
          const isMaterial = item.is_material !== false;
          return {
            code: asString(item.code),
            description: asString(item.description),
            size: asString(item.size),
            qty: asQty(item.qty),
            isMaterial,
            confidence:
              typeof item.confidence === "number" ? item.confidence : null,
            include: isMaterial,
          };
        })
      );
      setDuplicateKeys(
        new Set(Array.isArray(data.duplicateKeys) ? data.duplicateKeys : [])
      );
      setRunId(typeof data.runId === "string" ? data.runId : null);
      setStatus("review");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not read that file.");
    }
  }

  function updateRow(index: number, patch: Partial<ExtractedRow>) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }
  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
  }
  function addRow() {
    setRows((current) => [
      ...current,
      {
        code: "",
        description: "",
        size: "",
        qty: 0,
        isMaterial: true,
        confidence: null,
        include: true,
      },
    ]);
  }

  function acceptAboveThreshold() {
    setRows((current) =>
      current.map((row) => ({
        ...row,
        include:
          row.isMaterial && (row.confidence ?? 1) >= ACCEPT_THRESHOLD
            ? true
            : row.include,
      }))
    );
  }

  const includedRows = useMemo(
    () => rows.filter((r) => r.include),
    [rows]
  );
  const lowConfidenceIncluded = includedRows.filter(
    (r) => r.confidence !== null && r.confidence < 0.6
  ).length;

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        await confirmExtractedMaterials(
          projectId,
          includedRows.map((r) => ({
            code: r.code,
            description: r.description,
            size: r.size,
            qty: r.qty,
          })),
          replaceExisting
        );
        if (runId) await markExtractionRunResolved(runId, true);
        setOpen(false);
        setStatus("idle");
        setRows([]);
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not save materials."
        );
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={testId}
        disabled={status === "extracting"}
        onClick={() => void startExtraction()}
      >
        {status === "extracting" ? "Reading..." : "✨ Extract with AI"}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next: boolean) => {
          setOpen(next);
          if (!next) {
            setStatus("idle");
            // A dismissed review is a rejected run — the paper trail should
            // say the human declined, not leave it dangling "extracted".
            if (status === "review" && runId) void markExtractionRunResolved(runId, false);
          }
        }}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Extract materials from {slipName}</DialogTitle>
            <DialogDescription>
              Review what the AI found before adding it. Non-material lines
              (freight, permits, fees) are flagged and unchecked by default;
              low-confidence lines are highlighted for a closer look.
            </DialogDescription>
          </DialogHeader>

          {status === "extracting" ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Reading the packing slip...
            </p>
          ) : null}

          {status === "error" ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}

          {status === "review" ? (
            <div className="flex flex-col gap-3 lg:flex-row">
              {previewUrl ? (
                <div className="hidden w-2/5 shrink-0 lg:block">
                  <div className="sticky top-0 max-h-[60vh] overflow-auto rounded-md border border-border bg-surface-sunken">
                    <object
                      data={previewUrl}
                      type="application/pdf"
                      className="h-[60vh] w-full"
                      aria-label={`Source: ${slipName}`}
                    >
                      {/* Fallback for image slips (photos) where <object>
                          can't render a PDF; next/image can't take an
                          arbitrary signed URL host, so a plain img is
                          correct here. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewUrl}
                        alt={`Source: ${slipName}`}
                        className="w-full"
                      />
                    </object>
                  </div>
                </div>
              ) : null}

              <div className="flex min-w-0 flex-1 flex-col gap-3">
                {duplicateKeys.size > 0 ? (
                  <p
                    data-testid="extract-dupe-warning"
                    className="rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-xs text-foreground"
                  >
                    Some lines share a code + size — kept separate in case they
                    are two real shipments. Merge them by hand if they are
                    duplicates.
                  </p>
                ) : null}

                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No material lines found. Add one manually, or close and use
                    &ldquo;Paste from packing slip&rdquo; instead.
                  </p>
                ) : (
                  <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
                    <table
                      data-testid="extract-review-table"
                      className="w-full border-separate border-spacing-0 text-xs"
                    >
                      <thead>
                        <tr>
                          {["", "Conf.", "Code", "Description", "Size", "Qty", ""].map(
                            (h, i) => (
                              <th
                                key={i}
                                className="sticky top-0 border-b border-border bg-muted p-2 text-left font-semibold text-muted-foreground"
                              >
                                {h}
                              </th>
                            )
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, index) => {
                          const isDupe = duplicateKeys.has(keyOf(row));
                          return (
                            <tr
                              key={index}
                              data-testid={`extract-row-${index}`}
                              className={cn(
                                !row.isMaterial && "bg-surface-sunken/60",
                                row.confidence !== null &&
                                  row.confidence < 0.6 &&
                                  "bg-destructive/5"
                              )}
                            >
                              <td className="border-b border-border p-1.5 align-middle">
                                <input
                                  type="checkbox"
                                  aria-label={`Include ${row.description || row.code || index + 1}`}
                                  data-testid={`extract-include-${index}`}
                                  checked={row.include}
                                  onChange={(e) =>
                                    updateRow(index, {
                                      include: e.target.checked,
                                    })
                                  }
                                  className="size-4 rounded border-border"
                                />
                              </td>
                              <td className="border-b border-border p-1.5 align-middle">
                                <span className="flex items-center gap-1">
                                  <StatusPill tone={confidenceTone(row.confidence)}>
                                    {confidenceLabel(row.confidence)}
                                  </StatusPill>
                                  {!row.isMaterial ? (
                                    <span
                                      title="Flagged as not a material (freight/fee/etc.)"
                                      className="text-[10px] font-medium text-muted-foreground"
                                    >
                                      non-mat
                                    </span>
                                  ) : null}
                                  {isDupe ? (
                                    <span
                                      title="Duplicate code + size"
                                      className="text-[10px] font-medium text-warning-fg"
                                    >
                                      dup
                                    </span>
                                  ) : null}
                                </span>
                              </td>
                              <td className="border-b border-border p-1.5">
                                <Input
                                  value={row.code}
                                  onChange={(e) =>
                                    updateRow(index, { code: e.target.value })
                                  }
                                  className="h-8 w-20 text-xs"
                                />
                              </td>
                              <td className="border-b border-border p-1.5">
                                <Input
                                  value={row.description}
                                  onChange={(e) =>
                                    updateRow(index, {
                                      description: e.target.value,
                                    })
                                  }
                                  className="h-8 min-w-32 text-xs"
                                />
                              </td>
                              <td className="border-b border-border p-1.5">
                                <Input
                                  value={row.size}
                                  onChange={(e) =>
                                    updateRow(index, { size: e.target.value })
                                  }
                                  className="h-8 w-24 text-xs"
                                />
                              </td>
                              <td className="border-b border-border p-1.5">
                                <Input
                                  type="number"
                                  min={0}
                                  value={row.qty}
                                  onChange={(e) =>
                                    updateRow(index, {
                                      qty: Number(e.target.value) || 0,
                                    })
                                  }
                                  className="h-8 w-16 text-right text-xs"
                                />
                              </td>
                              <td className="border-b border-border p-1.5">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  aria-label={`Remove line ${row.description || row.code || index + 1}`}
                                  className="text-destructive"
                                  onClick={() => removeRow(index)}
                                >
                                  ✕
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addRow}
                    >
                      + Add line
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="extract-accept-threshold"
                      onClick={acceptAboveThreshold}
                    >
                      Accept ≥ {Math.round(ACCEPT_THRESHOLD * 100)}%
                    </Button>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={replaceExisting}
                      onChange={(e) => setReplaceExisting(e.target.checked)}
                      className="size-4 rounded border-border"
                    />
                    Replace the current list
                  </label>
                </div>

                {lowConfidenceIncluded > 0 ? (
                  <p className="text-xs text-warning-fg">
                    {lowConfidenceIncluded} included line
                    {lowConfidenceIncluded === 1 ? " is" : "s are"} low
                    confidence — double-check before adding.
                  </p>
                ) : null}
                {error ? (
                  <p className="text-sm text-destructive">{error}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              size="lg"
              onClick={confirm}
              disabled={
                isPending || status !== "review" || includedRows.length === 0
              }
            >
              {isPending
                ? "Adding..."
                : `Add ${includedRows.length} material${includedRows.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
