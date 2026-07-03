"use client";

import { useMemo, useState } from "react";

import {
  type GridRow,
  MaterialsGrid,
} from "@/components/projects/materials-grid";
import {
  MaterialsReferenceStage,
  type ReferenceRow,
} from "@/components/projects/materials-reference-stage";
import type { Tables, Views } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export interface MaterialsPage {
  id: string;
  pageIndex: number;
  url: string;
}

export function MaterialsWorkspace({
  projectId,
  pages,
  rowProgress,
  materials,
  reconciliation,
  rowMaterials,
  phases,
}: {
  projectId: string;
  pages: MaterialsPage[];
  rowProgress: Views<"row_progress">[];
  materials: Tables<"materials">[];
  reconciliation: Views<"material_reconciliation">[];
  rowMaterials: Tables<"row_materials">[];
  phases: Tables<"phases">[];
}) {
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const [phaseFilter, setPhaseFilter] = useState<string>("");
  const activePage = pages[activePageIndex];

  const filteredRowProgress = useMemo(
    () =>
      phaseFilter
        ? rowProgress.filter((row) => row.phase_id === phaseFilter)
        : rowProgress,
    [rowProgress, phaseFilter]
  );

  const referenceRows: ReferenceRow[] = useMemo(
    () =>
      filteredRowProgress
        .filter((row) => row.drawing_id === activePage?.id)
        .map((row) => ({
          id: row.row_id,
          label: row.label,
          x: row.x,
          y: row.y,
          w: row.w,
          h: row.h,
          pct: row.pct,
          hasMaterials: row.has_materials,
          isComplete: row.is_complete,
          phaseId: row.phase_id,
        })),
    [filteredRowProgress, activePage]
  );

  const gridRows: GridRow[] = useMemo(
    () =>
      filteredRowProgress.map((row) => ({
        id: row.row_id,
        label: row.label,
        hasMaterials: row.has_materials,
      })),
    [filteredRowProgress]
  );

  // A phase-scoped reconciliation, computed here rather than via a new
  // query: rowMaterials (required qty per row) is already fetched for the
  // whole-project grid, and filtering it to the phase's row ids is enough
  // to show "assigned" per material for just this phase. Installed-per-row
  // isn't fetched here (only the project-wide aggregate is), so this
  // summary shows assigned only, not installed — a coarser view than the
  // full reconciliation card, not a replacement for it.
  const phaseAssignedByMaterial = useMemo(() => {
    if (!phaseFilter) return null;
    const rowIds = new Set(filteredRowProgress.map((row) => row.row_id));
    const totals = new Map<string, number>();
    for (const rm of rowMaterials) {
      if (!rowIds.has(rm.row_id)) continue;
      totals.set(
        rm.material_id,
        (totals.get(rm.material_id) ?? 0) + rm.required_qty
      );
    }
    return totals;
  }, [phaseFilter, filteredRowProgress, rowMaterials]);

  return (
    <div className="flex flex-col gap-6">
      {phases.length > 0 ? (
        <div className="flex items-center gap-2">
          <label htmlFor="phase-filter" className="text-sm text-foreground">
            Filter by phase
          </label>
          <select
            id="phase-filter"
            value={phaseFilter}
            onChange={(event) => setPhaseFilter(event.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          >
            <option value="">All phases</option>
            {phases.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-card p-3">
        {pages.length > 1 ? (
          <div className="mb-2 flex gap-2 overflow-x-auto">
            {pages.map((page, index) => (
              <button
                key={page.id}
                type="button"
                onClick={() => setActivePageIndex(index)}
                className={cn(
                  "shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium",
                  index === activePageIndex
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                Page {page.pageIndex + 1}
              </button>
            ))}
          </div>
        ) : null}

        {activePage ? (
          <div
            className="overflow-auto rounded-md bg-stage p-2"
            style={{ maxHeight: "46vh" }}
          >
            <MaterialsReferenceStage
              imageUrl={activePage.url}
              rows={referenceRows}
              phases={phases}
              highlightedRowId={highlightedRowId}
              onRowClick={setHighlightedRowId}
            />
          </div>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            Upload a drawing on the Layout tab to see it here.
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Tap a row on the drawing to jump to its column in the grid below. ⚠️ =
          no material assigned yet.
        </p>
      </div>

      {phaseAssignedByMaterial ? (
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="mb-2 text-sm font-medium text-foreground">
            Assigned to this phase
          </p>
          <div className="flex flex-wrap gap-3">
            {materials.map((material) => {
              const qty = phaseAssignedByMaterial.get(material.id) ?? 0;
              if (qty === 0) return null;
              return (
                <span key={material.id} className="text-sm text-muted-foreground">
                  {material.name}:{" "}
                  <span className="font-medium text-foreground">
                    {qty} {material.unit}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      ) : null}

      <MaterialsGrid
        projectId={projectId}
        materials={materials}
        reconciliation={reconciliation}
        rows={gridRows}
        rowMaterials={rowMaterials}
        highlightedRowId={highlightedRowId}
      />
    </div>
  );
}
