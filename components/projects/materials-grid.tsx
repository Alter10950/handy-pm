"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasteMaterialsDialog } from "@/components/projects/paste-materials-dialog";
import {
  addMaterial,
  deleteMaterial,
  updateMaterial,
} from "@/lib/projects/actions";
import { upsertRowMaterialQty } from "@/lib/rows/actions";
import { cn } from "@/lib/utils";
import type { Tables, Views } from "@/lib/supabase/database.types";

export interface GridRow {
  id: string;
  label: string;
  hasMaterials: boolean;
}

export function MaterialsGrid({
  projectId,
  materials,
  reconciliation,
  rows,
  rowMaterials,
  highlightedRowId,
}: {
  projectId: string;
  materials: Tables<"materials">[];
  reconciliation: Views<"material_reconciliation">[];
  rows: GridRow[];
  rowMaterials: Tables<"row_materials">[];
  highlightedRowId: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const headerRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());
  const firstInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  useEffect(() => {
    if (!highlightedRowId) return;
    headerRefs.current
      .get(highlightedRowId)
      ?.scrollIntoView({ inline: "center", block: "nearest" });
    firstInputRefs.current.get(highlightedRowId)?.focus();
  }, [highlightedRowId]);

  const reconciliationByMaterial = new Map(
    reconciliation.map((entry) => [entry.material_id, entry])
  );
  const qtyByCell = new Map(
    rowMaterials.map((rm) => [
      `${rm.row_id}:${rm.material_id}`,
      rm.required_qty,
    ])
  );

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-muted-foreground">
        Add rows on the Layout tab first — then each row shows up here as a
        column to assign material into.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 min-w-40 border-b border-r border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                Part
              </th>
              <th className="sticky top-0 z-20 border-b border-border bg-muted p-2 text-right font-semibold text-muted-foreground">
                Needed
              </th>
              <th className="sticky top-0 z-20 border-b border-border bg-muted p-2 text-right font-semibold text-muted-foreground">
                Recv
              </th>
              <th className="sticky top-0 z-20 border-b border-border bg-muted p-2 text-right font-semibold text-muted-foreground">
                Assigned
              </th>
              <th className="sticky top-0 z-20 border-b border-border bg-muted p-2 text-right font-semibold text-muted-foreground">
                Left
              </th>
              <th className="sticky top-0 z-20 border-b border-border bg-muted p-2 text-right font-semibold text-muted-foreground">
                To order
              </th>
              {rows.map((row) => (
                <th
                  key={row.id}
                  ref={(el) => {
                    if (el) headerRefs.current.set(row.id, el);
                    else headerRefs.current.delete(row.id);
                  }}
                  title={row.label}
                  className={cn(
                    "sticky top-0 z-20 whitespace-nowrap border-b border-border bg-muted p-2 text-right font-semibold text-muted-foreground",
                    highlightedRowId === row.id && "bg-blue-500/30"
                  )}
                >
                  {!row.hasMaterials ? "⚠️ " : ""}
                  {row.label}
                </th>
              ))}
              <th className="sticky top-0 z-20 border-b border-border bg-muted p-2" />
            </tr>
          </thead>
          <tbody>
            {materials.map((material) => {
              const recon = reconciliationByMaterial.get(material.id);
              const left = recon?.left_qty ?? material.total_needed;
              const toOrder =
                recon?.to_order ??
                Math.max(0, material.total_needed - material.received);
              const assigned = recon?.assigned ?? 0;

              return (
                <tr key={material.id}>
                  <td className="sticky left-0 z-10 border-b border-r border-border bg-card p-1.5">
                    <Input
                      defaultValue={material.name}
                      onBlur={(event) => {
                        if (event.target.value !== material.name) {
                          run(() =>
                            updateMaterial(material.id, projectId, {
                              name: event.target.value,
                            })
                          );
                        }
                      }}
                      disabled={isPending}
                      className="h-8 min-w-36 text-left text-xs"
                    />
                  </td>
                  <td className="border-b border-border p-1.5">
                    <Input
                      type="number"
                      min={0}
                      defaultValue={material.total_needed}
                      onBlur={(event) => {
                        const value = Math.max(
                          0,
                          Number(event.target.value) || 0
                        );
                        if (value !== material.total_needed) {
                          run(() =>
                            updateMaterial(material.id, projectId, {
                              total_needed: value,
                            })
                          );
                        }
                      }}
                      disabled={isPending}
                      className="h-8 w-20 text-right text-xs"
                    />
                  </td>
                  <td className="border-b border-border p-1.5">
                    <Input
                      type="number"
                      min={0}
                      defaultValue={material.received}
                      onBlur={(event) => {
                        const value = Math.max(
                          0,
                          Number(event.target.value) || 0
                        );
                        if (value !== material.received) {
                          run(() =>
                            updateMaterial(material.id, projectId, {
                              received: value,
                            })
                          );
                        }
                      }}
                      disabled={isPending}
                      className="h-8 w-20 text-right text-xs"
                    />
                  </td>
                  <td className="border-b border-border p-1.5 text-right tabular-nums text-muted-foreground">
                    {assigned}
                  </td>
                  <td
                    className={cn(
                      "border-b border-border p-1.5 text-right tabular-nums",
                      left < 0
                        ? "text-destructive"
                        : left === 0
                          ? "text-success"
                          : "text-foreground"
                    )}
                  >
                    {left}
                  </td>
                  <td
                    className={cn(
                      "border-b border-border p-1.5 text-right tabular-nums",
                      toOrder > 0 ? "text-destructive" : "text-success"
                    )}
                  >
                    {toOrder}
                  </td>
                  {rows.map((row) => {
                    const key = `${row.id}:${material.id}`;
                    const value = qtyByCell.get(key) ?? 0;
                    const isFirstRow = materials[0]?.id === material.id;
                    return (
                      <td
                        key={row.id}
                        className={cn(
                          "border-b border-border bg-blue-500/5 p-1.5",
                          highlightedRowId === row.id && "bg-blue-500/20"
                        )}
                      >
                        <Input
                          ref={(el) => {
                            if (isFirstRow && el)
                              firstInputRefs.current.set(row.id, el);
                          }}
                          type="number"
                          min={0}
                          defaultValue={value}
                          onBlur={(event) => {
                            const next = Math.max(
                              0,
                              Number(event.target.value) || 0
                            );
                            if (next !== value) {
                              run(() =>
                                upsertRowMaterialQty(
                                  row.id,
                                  material.id,
                                  projectId,
                                  next
                                )
                              );
                            }
                          }}
                          disabled={isPending}
                          className="h-8 w-14 text-right text-xs"
                        />
                      </td>
                    );
                  })}
                  <td className="border-b border-border p-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() =>
                        run(() => deleteMaterial(material.id, projectId))
                      }
                      className="text-destructive"
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

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => run(() => addMaterial(projectId, "New part"))}
        >
          + Add material
        </Button>
        <PasteMaterialsDialog projectId={projectId} />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
