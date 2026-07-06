"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImportMaterialsDialog } from "@/components/projects/import-materials-dialog";
import { PasteMaterialsDialog } from "@/components/projects/paste-materials-dialog";
import {
  addMaterial,
  bulkSetMaterialCondition,
  deleteMaterial,
  deleteMaterialsBatch,
  updateMaterial,
} from "@/lib/projects/actions";
import { upsertRowMaterialQty } from "@/lib/rows/actions";
import { cn } from "@/lib/utils";
import type { MaterialCondition, Tables, Views } from "@/lib/supabase/database.types";

const CONDITIONS: MaterialCondition[] = ["new", "used"];

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
  laborStandards,
}: {
  projectId: string;
  materials: Tables<"materials">[];
  reconciliation: Views<"material_reconciliation">[];
  rows: GridRow[];
  rowMaterials: Tables<"row_materials">[];
  highlightedRowId: string | null;
  laborStandards: Tables<"labor_standards">[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

  function toggleSelection(materialId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(materialId)) next.delete(materialId);
      else next.add(materialId);
      return next;
    });
  }

  function handleBulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Delete ${ids.length} material${ids.length === 1 ? "" : "s"}? This can't be undone.`
      )
    ) {
      return;
    }
    run(() => deleteMaterialsBatch(projectId, ids));
    setSelectedIds(new Set());
  }

  function handleBulkCondition(condition: MaterialCondition) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    run(() => bulkSetMaterialCondition(projectId, ids, condition));
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
          No rows yet — add materials below now; assigning quantities to
          specific rows becomes available once rows exist (Layout tab, for
          projects that have one).
        </div>
      ) : null}
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky top-0 z-20 border-b border-border bg-muted p-2" />
              <th className="sticky left-0 top-0 z-30 min-w-40 border-b border-r border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                Part
              </th>
              <th className="sticky top-0 z-20 min-w-28 border-b border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                Task
              </th>
              <th className="sticky top-0 z-20 min-w-20 border-b border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                Size
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
              <th
                title="Standard hours to install one unit, from labor standards × size — feeds the Estimate tab"
                className="sticky top-0 z-20 border-b border-border bg-muted p-2 text-right font-semibold text-muted-foreground"
              >
                Labor
              </th>
              <th className="sticky top-0 z-20 min-w-24 border-b border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                Profile
              </th>
              <th className="sticky top-0 z-20 min-w-24 border-b border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                Capacity
              </th>
              <th className="sticky top-0 z-20 min-w-20 border-b border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                Cond.
              </th>
              <th className="sticky top-0 z-20 min-w-28 border-b border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                System
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
                <tr key={material.id} data-testid={`material-row-${material.id}`}>
                  <td className="border-b border-border p-1.5">
                    <input
                      type="checkbox"
                      data-testid={`material-select-${material.id}`}
                      aria-label={`Select ${material.name}`}
                      checked={selectedIds.has(material.id)}
                      onChange={() => toggleSelection(material.id)}
                      className="size-4 rounded border-border"
                    />
                  </td>
                  <td className="sticky left-0 z-10 border-b border-r border-border bg-card p-1.5">
                    <Input
                      data-testid={`material-name-${material.id}`}
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
                    <select
                      data-testid={`material-task-${material.id}`}
                      aria-label={`Task for ${material.name}`}
                      defaultValue={material.task_key}
                      onChange={(event) => {
                        run(() =>
                          updateMaterial(material.id, projectId, {
                            task_key: event.target.value,
                          })
                        );
                      }}
                      disabled={isPending}
                      className="h-8 w-full rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
                    >
                      {laborStandards.map((standard) => (
                        <option key={standard.task_key} value={standard.task_key}>
                          {standard.task_key}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="border-b border-border p-1.5">
                    <Input
                      data-testid={`material-size-${material.id}`}
                      defaultValue={material.size ?? ""}
                      placeholder="e.g. 96in"
                      onBlur={(event) => {
                        const value = event.target.value.trim() || null;
                        if (value !== material.size) {
                          run(() =>
                            updateMaterial(material.id, projectId, {
                              size: value,
                            })
                          );
                        }
                      }}
                      disabled={isPending}
                      className="h-8 w-20 text-left text-xs"
                    />
                  </td>
                  <td className="border-b border-border p-1.5">
                    <Input
                      data-testid={`material-needed-${material.id}`}
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
                      data-testid={`material-received-${material.id}`}
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
                  <td
                    data-testid={`material-assigned-${material.id}`}
                    className="border-b border-border p-1.5 text-right tabular-nums text-muted-foreground"
                  >
                    {assigned}
                  </td>
                  <td
                    data-testid={`material-left-${material.id}`}
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
                    data-testid={`material-to-order-${material.id}`}
                    className={cn(
                      "border-b border-border p-1.5 text-right tabular-nums",
                      toOrder > 0 ? "text-destructive" : "text-success"
                    )}
                  >
                    {toOrder}
                  </td>
                  <td
                    data-testid={`material-labor-${material.id}`}
                    className="border-b border-border p-1.5 text-right tabular-nums text-muted-foreground"
                  >
                    {material.labor_units.toFixed(2)}
                  </td>
                  <td className="border-b border-border p-1.5">
                    <Input
                      data-testid={`material-profile-${material.id}`}
                      defaultValue={material.profile ?? ""}
                      onBlur={(event) => {
                        const value = event.target.value.trim() || null;
                        if (value !== material.profile) {
                          run(() =>
                            updateMaterial(material.id, projectId, { profile: value })
                          );
                        }
                      }}
                      disabled={isPending}
                      className="h-8 w-full text-left text-xs"
                    />
                  </td>
                  <td className="border-b border-border p-1.5">
                    <Input
                      data-testid={`material-capacity-${material.id}`}
                      defaultValue={material.capacity ?? ""}
                      onBlur={(event) => {
                        const value = event.target.value.trim() || null;
                        if (value !== material.capacity) {
                          run(() =>
                            updateMaterial(material.id, projectId, { capacity: value })
                          );
                        }
                      }}
                      disabled={isPending}
                      className="h-8 w-full text-left text-xs"
                    />
                  </td>
                  <td className="border-b border-border p-1.5">
                    <select
                      data-testid={`material-condition-${material.id}`}
                      aria-label={`Condition for ${material.name}`}
                      defaultValue={material.condition}
                      onChange={(event) => {
                        run(() =>
                          updateMaterial(material.id, projectId, {
                            condition: event.target.value as MaterialCondition,
                          })
                        );
                      }}
                      disabled={isPending}
                      className="h-8 w-full rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
                    >
                      {CONDITIONS.map((condition) => (
                        <option key={condition} value={condition}>
                          {condition}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="border-b border-border p-1.5">
                    <Input
                      data-testid={`material-system-${material.id}`}
                      defaultValue={material.compatible_system ?? ""}
                      onBlur={(event) => {
                        const value = event.target.value.trim() || null;
                        if (value !== material.compatible_system) {
                          run(() =>
                            updateMaterial(material.id, projectId, {
                              compatible_system: value,
                            })
                          );
                        }
                      }}
                      disabled={isPending}
                      className="h-8 w-full text-left text-xs"
                    />
                  </td>
                  {rows.map((row) => {
                    const key = `${row.id}:${material.id}`;
                    const value = qtyByCell.get(key) ?? 0;
                    const isFirstRow = materials[0]?.id === material.id;
                    return (
                      <td
                        key={row.id}
                        data-testid={`material-qty-${material.id}-${row.id}`}
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

      {selectedIds.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
          <span className="px-1 text-sm font-medium text-foreground">
            {selectedIds.size} selected
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Set condition
              <select
                aria-label="Set condition for selected"
                defaultValue=""
                disabled={isPending}
                onChange={(event) => {
                  if (event.target.value) {
                    handleBulkCondition(event.target.value as MaterialCondition);
                    event.target.value = "";
                  }
                }}
                className="h-8 rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
              >
                <option value="" disabled>
                  —
                </option>
                {CONDITIONS.map((condition) => (
                  <option key={condition} value={condition}>
                    {condition}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={handleBulkDelete}
              className="text-destructive"
            >
              Delete {selectedIds.size}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      ) : null}

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
        <ImportMaterialsDialog projectId={projectId} materials={materials} rows={rows} />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
