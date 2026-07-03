"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
import { confirmExtractedMaterials } from "@/lib/projects/actions";

interface ExtractedRow {
  code: string;
  description: string;
  size: string;
  qty: number;
}

type Status = "idle" | "extracting" | "review" | "error";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asQty(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function PackingSlipExtractDialog({
  projectId,
  storagePath,
  slipName,
}: {
  projectId: string;
  storagePath: string;
  slipName: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [rows, setRows] = useState<ExtractedRow[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function startExtraction() {
    setOpen(true);
    setStatus("extracting");
    setError(null);
    try {
      const response = await fetch("/api/packing-slips/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storagePath }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Extraction failed.");
      }
      const items = Array.isArray(data.items) ? data.items : [];
      setRows(
        items.map((item: Record<string, unknown>) => ({
          code: asString(item.code),
          description: asString(item.description),
          size: asString(item.size),
          qty: asQty(item.qty),
        }))
      );
      setStatus("review");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Could not read that file."
      );
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
      { code: "", description: "", size: "", qty: 0 },
    ]);
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        await confirmExtractedMaterials(projectId, rows, replaceExisting);
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
        disabled={status === "extracting"}
        onClick={() => void startExtraction()}
      >
        {status === "extracting" ? "Reading..." : "✨ Extract with AI"}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next: boolean) => {
          setOpen(next);
          if (!next) setStatus("idle");
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Extract materials from {slipName}</DialogTitle>
            <DialogDescription>
              Review what the AI found before adding it — fix any misread
              code, description, size, or quantity, or remove lines that
              aren&apos;t materials (freight, permits, discounts, etc.).
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
            <div className="flex flex-col gap-3">
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No material lines found. Add one manually below or close
                  this and use &ldquo;Paste from packing slip&rdquo; instead.
                </p>
              ) : (
                <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
                  <table
                    data-testid="extract-review-table"
                    className="w-full border-separate border-spacing-0 text-xs"
                  >
                    <thead>
                      <tr>
                        <th className="sticky top-0 border-b border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                          Code
                        </th>
                        <th className="sticky top-0 border-b border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                          Description
                        </th>
                        <th className="sticky top-0 border-b border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                          Size
                        </th>
                        <th className="sticky top-0 border-b border-border bg-muted p-2 text-right font-semibold text-muted-foreground">
                          Qty
                        </th>
                        <th className="sticky top-0 border-b border-border bg-muted p-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={index}>
                          <td className="border-b border-border p-1.5">
                            <Input
                              value={row.code}
                              onChange={(event) =>
                                updateRow(index, { code: event.target.value })
                              }
                              className="h-8 w-20 text-xs"
                            />
                          </td>
                          <td className="border-b border-border p-1.5">
                            <Input
                              value={row.description}
                              onChange={(event) =>
                                updateRow(index, {
                                  description: event.target.value,
                                })
                              }
                              className="h-8 min-w-32 text-xs"
                            />
                          </td>
                          <td className="border-b border-border p-1.5">
                            <Input
                              value={row.size}
                              onChange={(event) =>
                                updateRow(index, { size: event.target.value })
                              }
                              className="h-8 w-24 text-xs"
                            />
                          </td>
                          <td className="border-b border-border p-1.5">
                            <Input
                              type="number"
                              min={0}
                              value={row.qty}
                              onChange={(event) =>
                                updateRow(index, {
                                  qty: Number(event.target.value) || 0,
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
                              className="text-destructive"
                              onClick={() => removeRow(index)}
                            >
                              ✕
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addRow}
                >
                  + Add line
                </Button>
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
              </div>

              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              size="lg"
              onClick={confirm}
              disabled={isPending || status !== "review" || rows.length === 0}
            >
              {isPending
                ? "Adding..."
                : `Add ${rows.length} material${rows.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
