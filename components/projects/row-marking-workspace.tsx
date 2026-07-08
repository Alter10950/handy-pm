"use client";

import { useRouter } from "next/navigation";
import { Maximize, Minimize, Redo2, Undo2 } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import {
  AutoRowsDialog,
  type RowOrientation,
} from "@/components/projects/auto-rows-dialog";
import { BulkMaterialsPanel } from "@/components/projects/bulk-materials-panel";
import {
  DrawingVersionPanel,
  type DrawingVersionSummary,
} from "@/components/projects/drawing-version-panel";
import { DuplicateRangeDialog } from "@/components/projects/duplicate-range-dialog";
import { PhaseLegend } from "@/components/projects/phase-legend";
import { PhasePicker } from "@/components/projects/phase-picker";
import { RowCommandPanel } from "@/components/projects/row-command-panel";
import { RowReadinessPanel } from "@/components/projects/row-readiness-panel";
import { RowStage, type GeometryChange } from "@/components/projects/row-stage";
import { Toast } from "@/components/projects/toast";
import { useUndoStack } from "@/components/projects/use-undo-stack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPhase } from "@/lib/phases/actions";
import { setMarkingDrawing } from "@/lib/projects/actions";
import {
  createRow,
  createRowsBatch,
  deleteRowsBatch,
  duplicateRows,
  getRowMaterialQtys,
  getRowPhases,
  getRowSnapshots,
  restoreRows,
  renameRow,
  setRowsPhase,
  updateRowGeometry,
  updateRowReadiness,
  upsertRowMaterialQtyMany,
  type RowReadinessInputs,
  type RowSnapshot,
} from "@/lib/rows/actions";
import { maxRowNumber, nextRowLabel, rowNumber } from "@/lib/rows/naming";
import type {
  DrawingRole,
  RowReadinessStatus,
  Tables,
} from "@/lib/supabase/database.types";
import { cn, isTypingTarget } from "@/lib/utils";

export interface WorkspacePage {
  id: string;
  pageIndex: number;
  url: string;
  width: number;
  height: number;
  role: DrawingRole;
  history: DrawingVersionSummary[];
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
  phaseId: string | null;
  readinessStatus: RowReadinessStatus;
  materialsReady: boolean;
  areaAccessible: boolean;
  drawingApproved: boolean;
}

interface GridPending {
  count: number;
  orientation: RowOrientation;
}

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

type ActiveCommand = "rename" | "materials" | "phase" | "readiness" | null;

export function RowMarkingWorkspace({
  projectId,
  pages,
  rows,
  materials,
  phases,
  markDrawingId,
}: {
  projectId: string;
  pages: WorkspacePage[];
  rows: ProjectRow[];
  materials: Tables<"materials">[];
  phases: Tables<"phases">[];
  markDrawingId: string | null;
}) {
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [hiddenPhaseIds, setHiddenPhaseIds] = useState<Set<string>>(new Set());
  const [autoRowsDialogOpen, setAutoRowsDialogOpen] = useState(false);
  const [duplicateRangeDialogOpen, setDuplicateRangeDialogOpen] =
    useState(false);
  const [gridPending, setGridPending] = useState<GridPending | null>(null);
  const [activeCommand, setActiveCommand] = useState<ActiveCommand>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const undoStack = useUndoStack();
  const router = useRouter();
  const fullscreenRef = useRef<HTMLDivElement>(null);

  const activePage = pages[activePageIndex];
  const isMarkingPage = activePage?.id === markDrawingId;
  const allLabels = useMemo(() => rows.map((row) => row.label), [rows]);
  const pageRows = useMemo(
    () => rows.filter((row) => row.drawingId === activePage?.id),
    [rows, activePage]
  );
  const selectedCount = selectedRowIds.size;
  const isSingleSelection = selectedCount === 1;

  // The selection's own bounding box, used by "Duplicate range" to shift
  // the whole block as one rigid unit per repeat (not each row placed
  // adjacent to itself independently, the way single-row Copy works —
  // that would overlap neighbors once more than one row is involved).
  // Also caps how many repeats actually fit before the drawing's 0..1
  // edge, so the dialog can warn instead of silently clamping into an
  // overlapping stack.
  const selectionBounds = useMemo(() => {
    if (selectedCount < 2) return null;
    const sources = [...selectedRowIds]
      .map((id) => pageRows.find((row) => row.id === id))
      .filter((row): row is ProjectRow => Boolean(row));
    if (sources.length < 2) return null;

    const minX = Math.min(...sources.map((r) => r.x));
    const minY = Math.min(...sources.map((r) => r.y));
    const maxX = Math.max(...sources.map((r) => r.x + r.w));
    const maxY = Math.max(...sources.map((r) => r.y + r.h));
    const blockW = maxX - minX;
    const blockH = maxY - minY;
    return {
      blockW,
      blockH,
      maxRepeatsRight:
        blockW > 0 ? Math.max(0, Math.floor((1 - maxX) / blockW)) : 0,
      maxRepeatsBelow:
        blockH > 0 ? Math.max(0, Math.floor((1 - maxY) / blockH)) : 0,
    };
  }, [selectedCount, selectedRowIds, pageRows]);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

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

  // Returns the underlying persist promise (not just fire-and-forget) so a
  // caller that needs to react to success/failure itself can — e.g.
  // RowStage reverting an optimistic move/resize on failure. The
  // transition still owns router.refresh()/setError() exactly as before;
  // a second .catch() on the same promise elsewhere doesn't interfere
  // with (or suppress) this one.
  function runAction(fn: () => Promise<void>): Promise<void> {
    setError(null);
    const promise = fn();
    startTransition(async () => {
      try {
        await promise;
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
    return promise;
  }

  // The error banner (setError, inside runAction above) already carries
  // the actual message — this is just the quick, ephemeral "something
  // reverted" pulse RowStage triggers right where the user was looking.
  function handleMoveFailed() {
    setToastMessage("Couldn't save — move reverted.");
  }

  function handleSetMarkingPage() {
    if (!activePage || isMarkingPage) return;
    runAction(() => setMarkingDrawing(projectId, activePage.id));
  }

  function handleUndo() {
    if (!undoStack.canUndo) return;
    runAction(async () => {
      const label = await undoStack.undo();
      if (label) setToastMessage("Undone");
    });
  }

  function handleRedo() {
    if (!undoStack.canRedo) return;
    runAction(async () => {
      const label = await undoStack.redo();
      if (label) setToastMessage("Redone");
    });
  }

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / Delete / Backspace, never while typing
  // in a field. Attached to `window` (via the ref + effect below) rather
  // than as an onKeyDown on the root div: a command-panel action like
  // Delete clears the selection as part of handling its own click, which
  // unmounts the (until-then-focused) button — the browser then moves
  // focus to <body>, outside this subtree, so a div-scoped listener would
  // silently stop receiving the very next Ctrl+Z.
  function handleWorkspaceKeyDown(event: KeyboardEvent) {
    if (isTypingTarget(event.target)) return;
    const isMod = event.ctrlKey || event.metaKey;

    if (isMod && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      handleUndo();
      return;
    }
    if (
      (isMod && event.key.toLowerCase() === "z" && event.shiftKey) ||
      (isMod && event.key.toLowerCase() === "y")
    ) {
      event.preventDefault();
      handleRedo();
      return;
    }
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      selectedRowIds.size > 0
    ) {
      event.preventDefault();
      handleDeleteSelection();
      return;
    }
    if (event.key === "Escape" && selectedRowIds.size > 0) {
      event.preventDefault();
      handleClearSelection();
    }
  }

  const handleWorkspaceKeyDownRef = useRef(handleWorkspaceKeyDown);
  useEffect(() => {
    handleWorkspaceKeyDownRef.current = handleWorkspaceKeyDown;
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      handleWorkspaceKeyDownRef.current(event);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleDrawBox(box: { x: number; y: number; w: number; h: number }) {
    if (!activePage) return;

    if (gridPending) {
      const { count, orientation } = gridPending;
      setGridPending(null);
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
      runAction(async () => {
        const created = await createRowsBatch(
          projectId,
          activePage.id,
          newRows
        );
        undoStack.push({
          label: "Auto rows",
          undo: async () => {
            await deleteRowsBatch(
              created.map((r) => r.id),
              projectId
            );
          },
          redo: async () => {
            await createRowsBatch(
              projectId,
              activePage.id,
              created.map((r) => ({
                id: r.id,
                label: r.label,
                geometry: r.geometry,
              }))
            );
          },
        });
      });
      return;
    }

    const label = nextRowLabel(allLabels);
    runAction(async () => {
      const { id } = await createRow(projectId, activePage.id, label, box);
      undoStack.push({
        label: "Draw row",
        undo: async () => {
          await deleteRowsBatch([id], projectId);
        },
        redo: async () => {
          await createRow(projectId, activePage.id, label, box, id);
        },
      });
    });
  }

  // Returns the persist promise — RowStage awaits it to know when to
  // revert its local-first optimistic position on failure (see its own
  // docstring). Success needs no signal back: the row is already showing
  // the right position, and router.refresh() (inside runAction) will
  // confirm it via fresh props shortly after.
  function handleMoveRows(changes: GeometryChange[]): Promise<void> {
    if (changes.length === 0) return Promise.resolve();
    return runAction(async () => {
      await Promise.all(
        changes.map((c) => updateRowGeometry(c.rowId, projectId, c.after))
      );
      undoStack.push({
        label: "Move",
        undo: async () => {
          await Promise.all(
            changes.map((c) => updateRowGeometry(c.rowId, projectId, c.before))
          );
        },
        redo: async () => {
          await Promise.all(
            changes.map((c) => updateRowGeometry(c.rowId, projectId, c.after))
          );
        },
      });
    });
  }

  function handleResizeRow(change: GeometryChange): Promise<void> {
    return runAction(async () => {
      await updateRowGeometry(change.rowId, projectId, change.after);
      undoStack.push({
        label: "Resize",
        undo: async () => {
          await updateRowGeometry(change.rowId, projectId, change.before);
        },
        redo: async () => {
          await updateRowGeometry(change.rowId, projectId, change.after);
        },
      });
    });
  }

  function handleNudgeRows(changes: GeometryChange[]) {
    handleMoveRows(changes);
  }

  function handleToggleRowSelection(id: string) {
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
    setActiveCommand(null);
  }

  function handleCopy() {
    if (!activePage || selectedRowIds.size === 0) return;
    const sources = [...selectedRowIds]
      .map((id) => pageRows.find((row) => row.id === id))
      .filter((row): row is ProjectRow => Boolean(row));
    if (sources.length === 0) return;

    runAction(async () => {
      let nextNumber = maxRowNumber(allLabels) + 1;
      const allCreated: RowSnapshot[] = [];
      for (const source of sources) {
        const placeBesideX = source.w < source.h;
        const geometry = clampGeometry(
          placeBesideX
            ? { x: source.x + source.w, y: source.y, w: source.w, h: source.h }
            : { x: source.x, y: source.y + source.h, w: source.w, h: source.h }
        );
        const label = `Row ${nextNumber}`;
        nextNumber += 1;
        const created = await duplicateRows(
          projectId,
          activePage.id,
          source.id,
          [{ label, geometry }],
          true
        );
        allCreated.push(...created);
      }
      undoStack.push({
        label: "Copy",
        undo: async () => {
          await deleteRowsBatch(
            allCreated.map((r) => r.id),
            projectId
          );
        },
        redo: async () => {
          await restoreRows(projectId, allCreated);
        },
      });
    });
  }

  // Repeats the CURRENT multi-selection as one rigid block, `repeatCount`
  // times, offset by the block's own bounding-box width (direction
  // "right") or height ("below") each time — a generalization of
  // single-row Copy for "duplicate rows 1-10 as rows 11-20," not a loop
  // that calls Copy N times (which would place each row adjacent to
  // itself independently and overlap its own neighbors).
  function handleDuplicateRange(
    repeatCount: number,
    direction: "right" | "below",
    copyMaterials: boolean
  ) {
    if (!activePage || !selectionBounds || selectedRowIds.size < 2) return;
    const sources = [...selectedRowIds]
      .map((id) => pageRows.find((row) => row.id === id))
      .filter((row): row is ProjectRow => Boolean(row))
      .sort((a, b) => (rowNumber(a.label) ?? 0) - (rowNumber(b.label) ?? 0));
    if (sources.length < 2) return;

    const dx = direction === "right" ? selectionBounds.blockW : 0;
    const dy = direction === "below" ? selectionBounds.blockH : 0;

    runAction(async () => {
      let nextNumber = maxRowNumber(allLabels) + 1;
      const allCreated: RowSnapshot[] = [];
      for (const source of sources) {
        const newRows = Array.from({ length: repeatCount }, (_, i) => {
          const n = i + 1;
          const geometry = clampGeometry({
            x: source.x + dx * n,
            y: source.y + dy * n,
            w: source.w,
            h: source.h,
          });
          const label = `Row ${nextNumber}`;
          nextNumber += 1;
          return { label, geometry };
        });
        const created = await duplicateRows(
          projectId,
          activePage.id,
          source.id,
          newRows,
          copyMaterials
        );
        allCreated.push(...created);
      }
      undoStack.push({
        label: "Duplicate range",
        undo: async () => {
          await deleteRowsBatch(
            allCreated.map((r) => r.id),
            projectId
          );
        },
        redo: async () => {
          await restoreRows(projectId, allCreated);
        },
      });
    });
  }

  function handleDeleteSelection() {
    if (selectedRowIds.size === 0) return;
    const idsToDelete = [...selectedRowIds];
    runAction(async () => {
      const snapshots = await getRowSnapshots(idsToDelete);
      await deleteRowsBatch(idsToDelete, projectId);
      undoStack.push({
        label: "Delete",
        undo: async () => {
          await restoreRows(projectId, snapshots);
        },
        redo: async () => {
          await deleteRowsBatch(idsToDelete, projectId);
        },
      });
    });
    setSelectedRowIds(new Set());
    setActiveCommand(null);
  }

  function handleRenameToggle() {
    if (!isSingleSelection) return;
    const row = pageRows.find((r) => r.id === [...selectedRowIds][0]);
    setRenameValue(row?.label ?? "");
    setActiveCommand(activeCommand === "rename" ? null : "rename");
  }

  function handleRenameSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSingleSelection) return;
    const id = [...selectedRowIds][0];
    const row = pageRows.find((r) => r.id === id);
    if (!row) return;
    const before = row.label;
    const after = renameValue.trim();
    setActiveCommand(null);
    if (!after || after === before) return;

    runAction(async () => {
      await renameRow(id, projectId, after);
      undoStack.push({
        label: "Rename",
        undo: async () => {
          await renameRow(id, projectId, before);
        },
        redo: async () => {
          await renameRow(id, projectId, after);
        },
      });
    });
  }

  function handleApplyMaterials(
    materialQtys: { materialId: string; requiredQty: number }[]
  ): Promise<void> {
    const rowIds = [...selectedRowIds];
    const pairs = rowIds.flatMap((rowId) =>
      materialQtys.map((m) => ({ rowId, materialId: m.materialId }))
    );

    return new Promise((resolve, reject) => {
      runAction(async () => {
        try {
          const before = await getRowMaterialQtys(pairs);
          const after = before.map((entry) => ({
            ...entry,
            requiredQty:
              materialQtys.find((m) => m.materialId === entry.materialId)
                ?.requiredQty ?? entry.requiredQty,
          }));
          await upsertRowMaterialQtyMany(projectId, after);
          undoStack.push({
            label: "Set materials",
            undo: async () => {
              await upsertRowMaterialQtyMany(projectId, before);
            },
            redo: async () => {
              await upsertRowMaterialQtyMany(projectId, after);
            },
          });
          resolve();
        } catch (err) {
          reject(err);
          throw err;
        }
      });
    });
  }

  function handleApplyPhase(phaseId: string | null) {
    const rowIds = [...selectedRowIds];
    if (rowIds.length === 0) return;
    setActiveCommand(null);

    runAction(async () => {
      const before = await getRowPhases(rowIds);
      await setRowsPhase(projectId, rowIds, phaseId);
      undoStack.push({
        label: "Set phase",
        undo: async () => {
          await Promise.all(
            before.map((b) => setRowsPhase(projectId, [b.rowId], b.phaseId))
          );
        },
        redo: async () => {
          await setRowsPhase(projectId, rowIds, phaseId);
        },
      });
    });
  }

  function handleCreatePhaseAndApply(name: string, color: string) {
    const rowIds = [...selectedRowIds];
    if (rowIds.length === 0) return;
    setActiveCommand(null);

    runAction(async () => {
      const { id: phaseId } = await createPhase(projectId, name, color);
      const before = await getRowPhases(rowIds);
      await setRowsPhase(projectId, rowIds, phaseId);
      undoStack.push({
        label: "Set phase",
        undo: async () => {
          await Promise.all(
            before.map((b) => setRowsPhase(projectId, [b.rowId], b.phaseId))
          );
        },
        redo: async () => {
          await setRowsPhase(projectId, rowIds, phaseId);
        },
      });
    });
  }

  function handleReadinessChange(patch: RowReadinessInputs) {
    const rowId = [...selectedRowIds][0];
    if (!rowId) return;
    const row = pageRows.find((r) => r.id === rowId);
    if (!row) return;

    const before: RowReadinessInputs = {};
    const after: RowReadinessInputs = {};
    if (patch.materialsReady !== undefined) {
      before.materialsReady = row.materialsReady;
      after.materialsReady = patch.materialsReady;
    }
    if (patch.areaAccessible !== undefined) {
      before.areaAccessible = row.areaAccessible;
      after.areaAccessible = patch.areaAccessible;
    }
    if (patch.drawingApproved !== undefined) {
      before.drawingApproved = row.drawingApproved;
      after.drawingApproved = patch.drawingApproved;
    }

    runAction(async () => {
      await updateRowReadiness(rowId, projectId, after);
      undoStack.push({
        label: "Readiness",
        undo: async () => {
          await updateRowReadiness(rowId, projectId, before);
        },
        redo: async () => {
          await updateRowReadiness(rowId, projectId, after);
        },
      });
    });
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
                handleClearSelection();
              }}
              className={cn(
                "shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium",
                index === activePageIndex
                  ? "border-brand bg-brand-subtle text-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              Page {page.pageIndex + 1}
              {page.id === markDrawingId ? " ★" : ""}
            </button>
          ))}
        </div>
      ) : null}

      {pages.length > 1 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isMarkingPage ? (
            <span>★ This is the marking page — rows can be drawn here.</span>
          ) : (
            <>
              <span>
                View-only reference page — rows can&apos;t be drawn or edited
                here.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={handleSetMarkingPage}
              >
                Set as marking page
              </Button>
            </>
          )}
        </div>
      ) : null}

      {activePage ? (
        <DrawingVersionPanel
          projectId={projectId}
          drawingId={activePage.id}
          pageIndex={activePage.pageIndex}
          history={activePage.history}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card shadow-e1 p-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!isMarkingPage}
          title={
            isMarkingPage
              ? undefined
              : "Switch to the marking page to draw rows"
          }
          onClick={() => setAutoRowsDialogOpen(true)}
        >
          ▦ Auto rows
        </Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          disabled={!undoStack.canUndo}
          onClick={handleUndo}
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          disabled={!undoStack.canRedo}
          onClick={handleRedo}
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 />
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
        {gridPending
          ? "Drag a box over the rack area to split it."
          : "Drag empty space to draw, click a row to select and drag its handles to resize · shift-click/shift-drag for multiple · middle-click or hold Space to pan, scroll/pinch to zoom · arrow keys nudge, Esc deselects."}
      </p>

      {phases.length > 0 ? (
        <PhaseLegend
          phases={phases}
          hiddenPhaseIds={hiddenPhaseIds}
          onToggle={(phaseId) =>
            setHiddenPhaseIds((prev) => {
              const next = new Set(prev);
              if (next.has(phaseId)) next.delete(phaseId);
              else next.add(phaseId);
              return next;
            })
          }
        />
      ) : null}

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
            selectedRowIds={selectedRowIds}
            phases={phases}
            hiddenPhaseIds={hiddenPhaseIds}
            readOnly={!isMarkingPage}
            onDrawBox={handleDrawBox}
            onSelectSingle={(id) => {
              setSelectedRowIds(new Set([id]));
              setActiveCommand(null);
            }}
            onToggleRowSelection={handleToggleRowSelection}
            onMoveRows={handleMoveRows}
            onResizeRow={handleResizeRow}
            onMarqueeSelect={handleMarqueeSelect}
            onClearSelection={handleClearSelection}
            onNudgeRows={handleNudgeRows}
            onMoveFailed={handleMoveFailed}
          />
        </div>
      ) : null}

      {selectedCount > 0 ? (
        <RowCommandPanel
          selectedCount={selectedCount}
          isSingleSelection={isSingleSelection}
          canDuplicateRange={selectionBounds !== null}
          isPending={isPending}
          onCopy={handleCopy}
          onDuplicateRangeToggle={() => setDuplicateRangeDialogOpen(true)}
          onDelete={handleDeleteSelection}
          onRenameToggle={handleRenameToggle}
          onMaterialsToggle={() =>
            setActiveCommand(activeCommand === "materials" ? null : "materials")
          }
          onPhaseToggle={() =>
            setActiveCommand(activeCommand === "phase" ? null : "phase")
          }
          onReadinessToggle={() =>
            setActiveCommand(activeCommand === "readiness" ? null : "readiness")
          }
          onClearSelection={handleClearSelection}
        />
      ) : null}

      {activeCommand === "rename" && isSingleSelection ? (
        <form
          onSubmit={handleRenameSave}
          className="flex items-end gap-2 rounded-lg border border-border bg-card shadow-e1 p-3"
        >
          <div className="flex flex-1 flex-col gap-1">
            <label
              htmlFor="rename-input"
              className="text-xs font-medium text-foreground"
            >
              Row name
            </label>
            <Input
              id="rename-input"
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
            />
          </div>
          <Button type="submit" size="default">
            Save
          </Button>
          <Button
            type="button"
            variant="outline"
            size="default"
            onClick={() => setActiveCommand(null)}
          >
            Cancel
          </Button>
        </form>
      ) : null}

      {activeCommand === "materials" ? (
        <BulkMaterialsPanel
          selectedCount={selectedCount}
          materials={materials}
          onClearSelection={handleClearSelection}
          onApply={handleApplyMaterials}
        />
      ) : null}

      {activeCommand === "phase" ? (
        <PhasePicker
          phases={phases}
          onApply={handleApplyPhase}
          onCreateAndApply={handleCreatePhaseAndApply}
          onCancel={() => setActiveCommand(null)}
        />
      ) : null}

      {activeCommand === "readiness" && isSingleSelection
        ? (() => {
            const rowId = [...selectedRowIds][0];
            const row = pageRows.find((r) => r.id === rowId);
            if (!row) return null;
            return (
              <RowReadinessPanel
                materialsReady={row.materialsReady}
                areaAccessible={row.areaAccessible}
                drawingApproved={row.drawingApproved}
                readinessStatus={row.readinessStatus}
                isPending={isPending}
                onChange={handleReadinessChange}
                onCancel={() => setActiveCommand(null)}
              />
            );
          })()
        : null}

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
        }}
      />

      <DuplicateRangeDialog
        open={duplicateRangeDialogOpen}
        onOpenChange={setDuplicateRangeDialogOpen}
        maxRepeatsRight={selectionBounds?.maxRepeatsRight ?? 0}
        maxRepeatsBelow={selectionBounds?.maxRepeatsBelow ?? 0}
        onConfirm={handleDuplicateRange}
      />

      <Toast message={toastMessage} />
    </div>
  );
}
