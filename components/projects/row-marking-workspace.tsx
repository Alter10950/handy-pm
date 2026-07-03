"use client";

import { useRouter } from "next/navigation";
import { Maximize, Minimize } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  AutoRowsDialog,
  type RowOrientation,
} from "@/components/projects/auto-rows-dialog";
import { BulkMaterialsPanel } from "@/components/projects/bulk-materials-panel";
import { DuplicateRowDialog } from "@/components/projects/duplicate-row-dialog";
import { RowEditSheet } from "@/components/projects/row-edit-sheet";
import { RowStage, type StageTool } from "@/components/projects/row-stage";
import { Button } from "@/components/ui/button";
import {
  createRow,
  createRowsBatch,
  deleteRow,
  duplicateRows,
  renameRow,
  updateRowGeometry,
  upsertRowMaterialQtyBulk,
} from "@/lib/rows/actions";
import { maxRowNumber, nextRowLabel, rowNumber } from "@/lib/rows/naming";
import type { Tables } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export interface WorkspacePage {
  id: string;
  pageIndex: number;
  url: string;
  width: number;
  height: number;
}

export interface ProjectRow {
  id: string;
  drawingId: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pct: number;
  hasMaterials: boolean;
  isComplete: boolean;
}

interface GridPending {
  count: number;
  orientation: RowOrientation;
}

const TOOL_LABELS: Record<StageTool, string> = {
  grid: "▦ Auto rows",
  draw: "✏️ Draw one",
  edit: "↔ Edit",
  select: "☑ Select",
  pan: "✋ Hand",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampGeometry(box: { x: number; y: number; w: number; h: number }) {
  return {
    x: clamp(box.x, 0, 1 - box.w),
    y: clamp(box.y, 0, 1 - box.h),
    w: box.w,
    h: box.h,
  };
}

export function RowMarkingWorkspace({
  projectId,
  pages,
  rows,
  materials,
}: {
  projectId: string;
  pages: WorkspacePage[];
  rows: ProjectRow[];
  materials: Tables<"materials">[];
}) {
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [tool, setTool] = useState<StageTool>("edit");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [autoRowsDialogOpen, setAutoRowsDialogOpen] = useState(false);
  const [gridPending, setGridPending] = useState<GridPending | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [selectAnchorId, setSelectAnchorId] = useState<string | null>(null);
  const [duplicateRowId, setDuplicateRowId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const fullscreenRef = useRef<HTMLDivElement>(null);

  const activePage = pages[activePageIndex];
  const allLabels = useMemo(() => rows.map((row) => row.label), [rows]);
  const pageRows = useMemo(
    () => rows.filter((row) => row.drawingId === activePage?.id),
    [rows, activePage]
  );
  const editingRow = pageRows.find((row) => row.id === editingRowId) ?? null;
  const duplicateSourceRow =
    pageRows.find((row) => row.id === duplicateRowId) ?? null;

  const sortedPageRowIds = useMemo(() => {
    return [...pageRows]
      .sort((a, b) => {
        const na = rowNumber(a.label);
        const nb = rowNumber(b.label);
        if (na !== null && nb !== null) return na - nb;
        if (na !== null) return -1;
        if (nb !== null) return 1;
        return a.label.localeCompare(b.label);
      })
      .map((row) => row.id);
  }, [pageRows]);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === fullscreenRef.current);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      fullscreenRef.current?.requestFullscreen();
    }
  }

  function runAction(fn: () => Promise<void>) {
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

  function handleDrawBox(box: { x: number; y: number; w: number; h: number }) {
    if (!activePage) return;

    if (tool === "draw") {
      const label = nextRowLabel(allLabels);
      runAction(async () => {
        await createRow(projectId, activePage.id, label, box);
      });
      return;
    }

    if (tool === "grid" && gridPending) {
      const { count, orientation } = gridPending;
      setGridPending(null);
      setTool("edit");
      const base = maxRowNumber(allLabels);
      const newRows = Array.from({ length: count }, (_, i) => ({
        label: `Row ${base + i + 1}`,
        geometry:
          orientation === "vertical"
            ? {
                x: box.x + (box.w / count) * i,
                y: box.y,
                w: box.w / count,
                h: box.h,
              }
            : {
                x: box.x,
                y: box.y + (box.h / count) * i,
                w: box.w,
                h: box.h / count,
              },
      }));
      runAction(() => createRowsBatch(projectId, activePage.id, newRows));
    }
  }

  function handleToggleRowSelection(id: string, shift: boolean) {
    if (shift && selectAnchorId) {
      const anchorIndex = sortedPageRowIds.indexOf(selectAnchorId);
      const targetIndex = sortedPageRowIds.indexOf(id);
      if (anchorIndex !== -1 && targetIndex !== -1) {
        const [start, end] =
          anchorIndex <= targetIndex
            ? [anchorIndex, targetIndex]
            : [targetIndex, anchorIndex];
        const rangeIds = sortedPageRowIds.slice(start, end + 1);
        setSelectedRowIds((prev) => new Set([...prev, ...rangeIds]));
        return;
      }
    }
    setSelectAnchorId(id);
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleMarqueeSelect(ids: string[]) {
    setSelectedRowIds((prev) => new Set([...prev, ...ids]));
  }

  function handleClearSelection() {
    setSelectedRowIds(new Set());
    setSelectAnchorId(null);
  }

  function handleDuplicateConfirm(count: number, copyMaterials: boolean) {
    if (!activePage || !duplicateSourceRow) return;
    const source = duplicateSourceRow;
    const placeBesideX = source.w < source.h;
    const base = maxRowNumber(allLabels);

    const newRows = Array.from({ length: count }, (_, i) => {
      const offset = i + 1;
      const geometry = clampGeometry(
        placeBesideX
          ? {
              x: source.x + source.w * offset,
              y: source.y,
              w: source.w,
              h: source.h,
            }
          : {
              x: source.x,
              y: source.y + source.h * offset,
              w: source.w,
              h: source.h,
            }
      );
      return { label: `Row ${base + i + 1}`, geometry };
    });

    runAction(() =>
      duplicateRows(projectId, activePage.id, source.id, newRows, copyMaterials)
    );
  }

  return (
    <div
      ref={fullscreenRef}
      className={cn(
        "flex flex-col gap-3",
        isFullscreen && "h-screen overflow-y-auto bg-background p-4"
      )}
    >
      {pages.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto">
          {pages.map((page, index) => (
            <button
              key={page.id}
              type="button"
              onClick={() => {
                setActivePageIndex(index);
                setSelectedRowId(null);
                handleClearSelection();
              }}
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

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
        <Button
          type="button"
          size="sm"
          variant={tool === "grid" ? "default" : "outline"}
          onClick={() => setAutoRowsDialogOpen(true)}
        >
          {TOOL_LABELS.grid}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tool === "draw" ? "default" : "outline"}
          onClick={() => {
            setGridPending(null);
            setTool("draw");
          }}
        >
          {TOOL_LABELS.draw}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tool === "edit" ? "default" : "outline"}
          onClick={() => {
            setGridPending(null);
            setTool("edit");
          }}
        >
          {TOOL_LABELS.edit}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tool === "select" ? "default" : "outline"}
          onClick={() => {
            setGridPending(null);
            setTool("select");
          }}
        >
          {TOOL_LABELS.select}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tool === "pan" ? "default" : "outline"}
          onClick={() => {
            setGridPending(null);
            setTool("pan");
          }}
        >
          {TOOL_LABELS.pan}
        </Button>

        <span className="ml-auto text-xs text-muted-foreground">
          {pageRows.length} row{pageRows.length === 1 ? "" : "s"} on this page
        </span>

        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize /> : <Maximize />}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {tool === "grid" && gridPending
          ? "Drag a box over the rack area to split it."
          : tool === "draw"
            ? "Drag to draw a single row."
            : tool === "select"
              ? "Tap rows to select (shift-click for a range, or drag an empty area to marquee-select)."
              : tool === "pan"
                ? "Drag to pan the view."
                : "Tap a row to rename, duplicate, or delete it. Drag to move, drag the corner dot to resize."}
        {" · "}Scroll/pinch to zoom, hold Space to pan.
      </p>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {activePage ? (
        <div
          className={cn(
            "min-h-[400px] overflow-hidden rounded-lg border border-border bg-stage",
            isFullscreen ? "flex-1" : "h-[65vh]"
          )}
        >
          <RowStage
            imageUrl={activePage.url}
            baseWidth={activePage.width}
            baseHeight={activePage.height}
            rows={pageRows}
            tool={tool}
            selectedRowId={selectedRowId}
            onSelectRow={setSelectedRowId}
            onDrawBox={handleDrawBox}
            onMoveRow={(id, geometry) =>
              runAction(() => updateRowGeometry(id, projectId, geometry))
            }
            onResizeRow={(id, geometry) =>
              runAction(() => updateRowGeometry(id, projectId, geometry))
            }
            onTapRow={(id) => {
              setSelectedRowId(id);
              setEditingRowId(id);
            }}
            selectedRowIds={selectedRowIds}
            onToggleRowSelection={handleToggleRowSelection}
            onMarqueeSelect={handleMarqueeSelect}
            onClearSelection={handleClearSelection}
          />
        </div>
      ) : null}

      {tool === "select" && selectedRowIds.size > 0 ? (
        <BulkMaterialsPanel
          selectedCount={selectedRowIds.size}
          materials={materials}
          onClearSelection={handleClearSelection}
          onApply={(materialQtys) =>
            upsertRowMaterialQtyBulk(
              projectId,
              Array.from(selectedRowIds),
              materialQtys
            ).then(() => router.refresh())
          }
        />
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>⚠️ Not set up (no material assigned)</span>
        <span>In progress (fill = % installed)</span>
        <span>Row complete = green</span>
      </div>

      <AutoRowsDialog
        open={autoRowsDialogOpen}
        onOpenChange={setAutoRowsDialogOpen}
        onConfirm={(count, orientation) => {
          setGridPending({ count, orientation });
          setTool("grid");
        }}
      />

      <DuplicateRowDialog
        open={duplicateRowId !== null}
        onOpenChange={(open) => {
          if (!open) setDuplicateRowId(null);
        }}
        onConfirm={handleDuplicateConfirm}
      />

      {editingRow ? (
        <RowEditSheet
          key={editingRow.id}
          row={editingRow}
          onClose={() => setEditingRowId(null)}
          onRename={(id, label) => renameRow(id, projectId, label)}
          onDelete={(id) => deleteRow(id, projectId)}
          onDuplicate={(id) => {
            setEditingRowId(null);
            setDuplicateRowId(id);
          }}
        />
      ) : null}
    </div>
  );
}
