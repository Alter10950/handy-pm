"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  AutoRowsDialog,
  type RowOrientation,
} from "@/components/projects/auto-rows-dialog";
import { RowEditSheet } from "@/components/projects/row-edit-sheet";
import { RowStage, type StageTool } from "@/components/projects/row-stage";
import { Button } from "@/components/ui/button";
import {
  createRow,
  createRowsBatch,
  deleteRow,
  renameRow,
  updateRowGeometry,
} from "@/lib/rows/actions";
import { maxRowNumber, nextRowLabel } from "@/lib/rows/naming";
import { cn } from "@/lib/utils";

export interface WorkspacePage {
  id: string;
  pageIndex: number;
  url: string;
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
};

export function RowMarkingWorkspace({
  projectId,
  pages,
  rows,
}: {
  projectId: string;
  pages: WorkspacePage[];
  rows: ProjectRow[];
}) {
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [tool, setTool] = useState<StageTool>("edit");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [autoRowsDialogOpen, setAutoRowsDialogOpen] = useState(false);
  const [gridPending, setGridPending] = useState<GridPending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const activePage = pages[activePageIndex];
  const allLabels = useMemo(() => rows.map((row) => row.label), [rows]);
  const pageRows = useMemo(
    () => rows.filter((row) => row.drawingId === activePage?.id),
    [rows, activePage]
  );
  const editingRow = pageRows.find((row) => row.id === editingRowId) ?? null;

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

  return (
    <div className="flex flex-col gap-3">
      {pages.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto">
          {pages.map((page, index) => (
            <button
              key={page.id}
              type="button"
              onClick={() => {
                setActivePageIndex(index);
                setSelectedRowId(null);
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
        <span className="ml-auto text-xs text-muted-foreground">
          {pageRows.length} row{pageRows.length === 1 ? "" : "s"} on this page
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {tool === "grid" && gridPending
          ? "Drag a box over the rack area to split it."
          : tool === "draw"
            ? "Drag to draw a single row."
            : "Tap a row to rename it. Drag to move, drag the corner dot to resize."}
      </p>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {activePage ? (
        <div className="overflow-auto rounded-lg border border-border bg-stage p-2">
          <RowStage
            imageUrl={activePage.url}
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
          />
        </div>
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

      {editingRow ? (
        <RowEditSheet
          key={editingRow.id}
          row={editingRow}
          onClose={() => setEditingRowId(null)}
          onRename={(id, label) => renameRow(id, projectId, label)}
          onDelete={(id) => deleteRow(id, projectId)}
        />
      ) : null}
    </div>
  );
}
