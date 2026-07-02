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
}: {
  projectId: string;
  pages: MaterialsPage[];
  rowProgress: Views<"row_progress">[];
  materials: Tables<"materials">[];
  reconciliation: Views<"material_reconciliation">[];
  rowMaterials: Tables<"row_materials">[];
}) {
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);
  const activePage = pages[activePageIndex];

  const referenceRows: ReferenceRow[] = useMemo(
    () =>
      rowProgress
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
        })),
    [rowProgress, activePage]
  );

  const gridRows: GridRow[] = useMemo(
    () =>
      rowProgress.map((row) => ({
        id: row.row_id,
        label: row.label,
        hasMaterials: row.has_materials,
      })),
    [rowProgress]
  );

  return (
    <div className="flex flex-col gap-6">
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
