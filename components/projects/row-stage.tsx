"use client";

import { useEffect, useRef, useState } from "react";

import { RowFillMarker } from "@/components/projects/row-fill-marker";
import { ZoomControls } from "@/components/projects/zoom-controls";
import { MAX_ZOOM, MIN_ZOOM, useZoomPan } from "@/components/projects/use-zoom-pan";
import type { RowReadinessStatus, Tables } from "@/lib/supabase/database.types";
import { cn, isTypingTarget } from "@/lib/utils";

export interface StageRow {
  id: string;
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
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GeometryChange {
  rowId: string;
  before: Box;
  after: Box;
}

type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLES: {
  id: HandleId;
  position: string;
  cursor: string;
}[] = [
  { id: "nw", position: "-top-2 -left-2", cursor: "cursor-nwse-resize" },
  {
    id: "n",
    position: "-top-2 left-1/2 -translate-x-1/2",
    cursor: "cursor-ns-resize",
  },
  { id: "ne", position: "-top-2 -right-2", cursor: "cursor-nesw-resize" },
  {
    id: "e",
    position: "top-1/2 -right-2 -translate-y-1/2",
    cursor: "cursor-ew-resize",
  },
  { id: "se", position: "-bottom-2 -right-2", cursor: "cursor-nwse-resize" },
  {
    id: "s",
    position: "-bottom-2 left-1/2 -translate-x-1/2",
    cursor: "cursor-ns-resize",
  },
  { id: "sw", position: "-bottom-2 -left-2", cursor: "cursor-nesw-resize" },
  {
    id: "w",
    position: "top-1/2 -left-2 -translate-y-1/2",
    cursor: "cursor-ew-resize",
  },
];

const MIN_BOX_SIZE = 0.02;
const NUDGE_SCREEN_PIXELS = 3;

interface DragState {
  mode: "draw" | "move" | "resize" | "pan" | "marquee";
  startClientX: number;
  startClientY: number;
  stageWidth: number;
  stageHeight: number;
  currentBox?: Box;
  moveOrigins?: { rowId: string; geometry: Box }[];
  deferredSelectRowId?: string;
  resizeRowId?: string;
  resizeHandle?: HandleId;
  resizeOrigin?: Box;
  startPanX?: number;
  startPanY?: number;
  moved: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function boxesIntersect(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

// Generic resize for any of the 8 handles: each affects the edge(s) it
// sits on, leaving the opposite edge(s) fixed — e.g. dragging "w" changes
// x and w but never y/h; dragging "nw" changes all four.
function applyResize(origin: Box, handle: HandleId, dx: number, dy: number): Box {
  let { x, y, w, h } = origin;
  const right = origin.x + origin.w;
  const bottom = origin.y + origin.h;

  const affectsLeft = handle === "nw" || handle === "w" || handle === "sw";
  const affectsRight = handle === "ne" || handle === "e" || handle === "se";
  const affectsTop = handle === "nw" || handle === "n" || handle === "ne";
  const affectsBottom = handle === "sw" || handle === "s" || handle === "se";

  if (affectsLeft) {
    x = clamp(origin.x + dx, 0, right - MIN_BOX_SIZE);
    w = right - x;
  }
  if (affectsRight) {
    w = clamp(origin.w + dx, MIN_BOX_SIZE, 1 - origin.x);
  }
  if (affectsTop) {
    y = clamp(origin.y + dy, 0, bottom - MIN_BOX_SIZE);
    h = bottom - y;
  }
  if (affectsBottom) {
    h = clamp(origin.h + dy, MIN_BOX_SIZE, 1 - origin.y);
  }

  return { x, y, w, h };
}

/**
 * Zoom/pan is a pure CSS transform on this stage element — row geometry
 * stays normalized 0..1 in the DB and the draw/move/resize math below is
 * unchanged from before zoom/pan existed. That's not an oversight: every
 * formula here reads the stage's CURRENT `getBoundingClientRect()`, and the
 * browser already folds the live transform into that rect (a scaled
 * element reports its scaled on-screen size/position). So
 * `(clientX - rect.left) / rect.width` yields the same 0..1 fraction at
 * any zoom/pan — the transform cancels out of the ratio automatically.
 *
 * Modeless, context-driven pointer model — no draw/edit/select/hand mode
 * buttons anywhere: a plain left-drag on empty space draws a new row; a
 * plain left-click on a row selects it (drag-without-releasing moves the
 * whole current selection together); shift/ctrl-click toggles selection
 * membership; shift-drag on empty space marquee-selects. A single-selected
 * row shows 8 resize handles. Panning is ALWAYS available, at the highest
 * input priority, two ways: holding Space turns a left-drag into a pan
 * instead of draw/select/move (checked via `shouldPan`), and the middle
 * mouse button always pans regardless of what's under the cursor or any
 * modifier (`event.button === 1`, checked before anything else in every
 * pointerdown handler here) — a pan gesture must never move/resize/draw a
 * row, and a row drag must never pan the canvas. Persistence and undo/redo
 * bookkeeping both live one level up, in RowMarkingWorkspace — this
 * component only reports what happened (before/after geometry), never
 * calls a Server Action directly. `onMoveRows`/`onResizeRow` return the
 * underlying persist promise so this component can keep showing the
 * dropped position immediately (local-first) and only revert on failure —
 * see the draftGeometries reconciliation effect below.
 */
export function RowStage({
  imageUrl,
  baseWidth,
  baseHeight,
  rows,
  selectedRowIds,
  phases,
  hiddenPhaseIds,
  readOnly,
  onDrawBox,
  onSelectSingle,
  onToggleRowSelection,
  onMoveRows,
  onResizeRow,
  onMarqueeSelect,
  onClearSelection,
  onNudgeRows,
  onMoveFailed,
}: {
  imageUrl: string;
  baseWidth: number;
  baseHeight: number;
  rows: StageRow[];
  selectedRowIds: Set<string>;
  phases: Tables<"phases">[];
  hiddenPhaseIds: Set<string>;
  // A non-marking reference page (Sub-phase E, multi-page drawings):
  // still fully zoomable/pannable/fullscreen-able, just not markable —
  // no new rows drawn, no moving/resizing/selecting whatever rows
  // happen to already be on it (there normally aren't any: new rows can
  // only be drawn on the marking page going forward).
  readOnly: boolean;
  onDrawBox: (box: Box) => void;
  onSelectSingle: (id: string) => void;
  onToggleRowSelection: (id: string) => void;
  onMoveRows: (changes: GeometryChange[]) => Promise<void>;
  onResizeRow: (change: GeometryChange) => Promise<void>;
  onMarqueeSelect: (ids: string[]) => void;
  onClearSelection: () => void;
  onNudgeRows: (changes: GeometryChange[]) => void;
  onMoveFailed: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draftGeometries, setDraftGeometries] = useState<Map<
    string,
    Box
  > | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);

  // Falls back to the image's own natural size if the drawing row has no
  // stored width/height (older data, or a defensive edge case) — normally
  // this is known up front from `drawings.width/height`.
  const [measuredSize, setMeasuredSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const effectiveWidth = baseWidth || measuredSize?.width || 1000;
  const effectiveHeight = baseHeight || measuredSize?.height || 750;

  const viewportRef = useRef<HTMLDivElement>(null);
  const { zoom, panX, panY, fit, zoomIn, zoomOut, setPanZoom } = useZoomPan(
    viewportRef,
    effectiveWidth,
    effectiveHeight
  );
  const zoomPanRef = useRef({ zoom, panX, panY, setPanZoom });
  useEffect(() => {
    zoomPanRef.current = { zoom, panX, panY, setPanZoom };
  });

  // Space held turns a LEFT-drag into a pan (checked at pointerdown time,
  // alongside the button). The middle mouse button pans unconditionally —
  // that's checked directly via event.button, not folded into this flag.
  const shouldPan = spaceHeld;

  // The row's currently-DISPLAYED geometry (a pending optimistic draft if
  // one exists, else its last server-confirmed value) — starting a new
  // drag/resize/nudge from this rather than straight from `row` keeps a
  // rapid second interaction correct even while the first one's persist
  // is still in flight and hasn't reconciled yet (see the effect below).
  function currentGeometry(row: StageRow): Box {
    const draft = draftGeometries?.get(row.id);
    return draft ?? { x: row.x, y: row.y, w: row.w, h: row.h };
  }

  // Local-first persistence: a move/resize's dropped position is kept in
  // draftGeometries (not cleared on pointerUp), so the row visually STAYS
  // where it was dropped instead of reverting to the stale `rows` prop
  // until the round trip completes. Once the server-confirmed `rows` prop
  // actually matches a pending draft, the draft quietly steps aside (zero
  // visual difference, since they're equal) — this is what "ignores the
  // echo of your own write" means here: there's no separate realtime
  // subscription in this app to race against, only this one-shot
  // router.refresh() re-fetch, so matching by value is exactly as correct
  // as matching by a client mutation id would be, without needing to
  // plumb one through. A FAILED persist clears its own entry immediately
  // (see handlePointerUp) instead of waiting for this reconciliation.
  //
  // Reconciled during render via React's own documented "adjust state
  // when a prop changes" pattern (react.dev/reference/react/useState —
  // "Storing information from previous renders"): a piece of STATE (not a
  // ref — refs can't be read during render under the newer compiler-
  // compatible lint rules) remembers the previous `rows` reference, and a
  // conditional setState call during render corrects draftGeometries
  // before this render ever paints. Not a useEffect: an effect would
  // commit the still-stale draft to the screen first and only correct it
  // a frame later, a real (if brief) flicker.
  const [priorRows, setPriorRows] = useState(rows);
  if (priorRows !== rows) {
    setPriorRows(rows);
    if (draftGeometries && draftGeometries.size > 0) {
      let changed = false;
      const next = new Map(draftGeometries);
      for (const row of rows) {
        const draft = next.get(row.id);
        if (
          draft &&
          draft.x === row.x &&
          draft.y === row.y &&
          draft.w === row.w &&
          draft.h === row.h
        ) {
          next.delete(row.id);
          changed = true;
        }
      }
      if (changed) setDraftGeometries(next);
    }
  }

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (event.code === "Space" && !isTypingTarget(event.target)) {
        setSpaceHeld(true);
      }
    }
    function handleGlobalKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") setSpaceHeld(false);
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    window.addEventListener("keyup", handleGlobalKeyUp);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      window.removeEventListener("keyup", handleGlobalKeyUp);
    };
  }, []);

  // Two-finger pinch-zoom + pan for touchscreens — handled separately from
  // the pointer-event drag machine below (which covers mouse and
  // single-finger touch), via native touch listeners so preventDefault()
  // actually stops the browser's own native pinch/scroll.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let pinchBase: {
      distance: number;
      midX: number;
      midY: number;
      zoom: number;
      panX: number;
      panY: number;
    } | null = null;

    function midpoint(touches: TouchList) {
      return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2,
      };
    }
    function distance(touches: TouchList) {
      return Math.hypot(
        touches[1].clientX - touches[0].clientX,
        touches[1].clientY - touches[0].clientY
      );
    }

    function handleTouchStart(event: TouchEvent) {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      setDrag(null);
      setDraftGeometries(null);
      const mid = midpoint(event.touches);
      pinchBase = {
        distance: distance(event.touches),
        midX: mid.x,
        midY: mid.y,
        zoom: zoomPanRef.current.zoom,
        panX: zoomPanRef.current.panX,
        panY: zoomPanRef.current.panY,
      };
    }

    function handleTouchMove(event: TouchEvent) {
      if (event.touches.length !== 2 || !pinchBase) return;
      event.preventDefault();
      const rect = viewport!.getBoundingClientRect();
      const mid = midpoint(event.touches);
      const scaleRatio = distance(event.touches) / pinchBase.distance;
      const newZoom = clamp(pinchBase.zoom * scaleRatio, MIN_ZOOM, MAX_ZOOM);

      const stagePointX =
        (pinchBase.midX - rect.left - pinchBase.panX) / pinchBase.zoom;
      const stagePointY =
        (pinchBase.midY - rect.top - pinchBase.panY) / pinchBase.zoom;

      zoomPanRef.current.setPanZoom({
        zoom: newZoom,
        panX: mid.x - rect.left - stagePointX * newZoom,
        panY: mid.y - rect.top - stagePointY * newZoom,
      });
    }

    function handleTouchEnd(event: TouchEvent) {
      if (event.touches.length < 2) pinchBase = null;
    }

    viewport.addEventListener("touchstart", handleTouchStart, {
      passive: false,
    });
    viewport.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    viewport.addEventListener("touchend", handleTouchEnd);
    viewport.addEventListener("touchcancel", handleTouchEnd);
    return () => {
      viewport.removeEventListener("touchstart", handleTouchStart);
      viewport.removeEventListener("touchmove", handleTouchMove);
      viewport.removeEventListener("touchend", handleTouchEnd);
      viewport.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

  function stageRect() {
    const el = stageRef.current;
    if (!el) return null;
    return el.getBoundingClientRect();
  }

  function findRow(id: string): StageRow | undefined {
    return rows.find((row) => row.id === id);
  }

  function beginPanDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      mode: "pan",
      startClientX: event.clientX,
      startClientY: event.clientY,
      stageWidth: 0,
      stageHeight: 0,
      startPanX: panX,
      startPanY: panY,
      moved: false,
    });
  }

  function beginDrawOrMarquee(
    event: React.PointerEvent<HTMLDivElement>,
    mode: "draw" | "marquee"
  ) {
    const rect = stageRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      stageWidth: rect.width,
      stageHeight: rect.height,
      moved: false,
      currentBox: { x: 0, y: 0, w: 0, h: 0 },
    });
  }

  function beginRowMove(
    event: React.PointerEvent<HTMLDivElement>,
    row: StageRow
  ) {
    const rect = stageRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    const isPartOfMultiSelection =
      selectedRowIds.has(row.id) && selectedRowIds.size > 1;

    if (!isPartOfMultiSelection) {
      onSelectSingle(row.id);
    }

    const movingIds = isPartOfMultiSelection ? [...selectedRowIds] : [row.id];
    const origins = movingIds
      .map((id) => findRow(id))
      .filter((r): r is StageRow => Boolean(r))
      .map((r) => ({
        rowId: r.id,
        geometry: currentGeometry(r),
      }));

    setDrag({
      mode: "move",
      startClientX: event.clientX,
      startClientY: event.clientY,
      stageWidth: rect.width,
      stageHeight: rect.height,
      moveOrigins: origins,
      deferredSelectRowId: isPartOfMultiSelection ? row.id : undefined,
      moved: false,
    });
  }

  function beginResize(
    event: React.PointerEvent<HTMLDivElement>,
    row: StageRow,
    handle: HandleId
  ) {
    // Highest-priority rule: a pan gesture must never resize a row. Middle
    // button (and anything but plain left) is deliberately NOT stopped
    // here — falling through without stopPropagation lets it bubble to
    // handleStagePointerDown, which pans.
    if (event.button !== 0) return;
    event.stopPropagation();
    const rect = stageRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      mode: "resize",
      startClientX: event.clientX,
      startClientY: event.clientY,
      stageWidth: rect.width,
      stageHeight: rect.height,
      resizeRowId: row.id,
      resizeHandle: handle,
      resizeOrigin: currentGeometry(row),
      moved: false,
    });
  }

  function handleRowPointerDown(
    event: React.PointerEvent<HTMLDivElement>,
    row: StageRow
  ) {
    // Same highest-priority pan rule as beginResize: let a non-left button
    // (middle-mouse pan, in practice) bubble to the stage untouched.
    if (event.button !== 0) return;
    if (shouldPan) return; // let it bubble to the stage-level pan handler
    if (readOnly) return;

    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.stopPropagation();
      onToggleRowSelection(row.id);
      return;
    }

    event.stopPropagation();
    beginRowMove(event, row);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;

    if (drag.mode === "pan") {
      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;
      setPanZoom((prev) => ({
        ...prev,
        panX: (drag.startPanX ?? 0) + dx,
        panY: (drag.startPanY ?? 0) + dy,
      }));
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        setDrag({ ...drag, moved: true });
      }
      return;
    }

    const dx = (event.clientX - drag.startClientX) / drag.stageWidth;
    const dy = (event.clientY - drag.startClientY) / drag.stageHeight;

    if (drag.mode === "draw" || drag.mode === "marquee") {
      const rect = stageRect();
      if (!rect) return;
      const x0 = (drag.startClientX - rect.left) / drag.stageWidth;
      const y0 = (drag.startClientY - rect.top) / drag.stageHeight;
      const x1 = x0 + dx;
      const y1 = y0 + dy;
      setDrag({
        ...drag,
        moved: true,
        currentBox: {
          x: Math.min(x0, x1),
          y: Math.min(y0, y1),
          w: Math.abs(x1 - x0),
          h: Math.abs(y1 - y0),
        },
      });
      return;
    }

    if (drag.mode === "move" && drag.moveOrigins) {
      const next = new Map<string, Box>();
      for (const origin of drag.moveOrigins) {
        next.set(origin.rowId, {
          x: clamp(origin.geometry.x + dx, 0, 1 - origin.geometry.w),
          y: clamp(origin.geometry.y + dy, 0, 1 - origin.geometry.h),
          w: origin.geometry.w,
          h: origin.geometry.h,
        });
      }
      setDrag({ ...drag, moved: true });
      setDraftGeometries(next);
      return;
    }

    if (
      drag.mode === "resize" &&
      drag.resizeRowId &&
      drag.resizeOrigin &&
      drag.resizeHandle
    ) {
      const geometry = applyResize(drag.resizeOrigin, drag.resizeHandle, dx, dy);
      setDrag({ ...drag, moved: true });
      setDraftGeometries(new Map([[drag.resizeRowId, geometry]]));
    }
  }

  // Drops a set of pending rowIds' optimistic draft on a failed persist —
  // the reconciliation effect above only clears a draft on a CONFIRMED
  // matching value, so a failure needs its own explicit revert, plus a
  // toast (the caller, RowMarkingWorkspace, already surfaces the error
  // banner from the same rejected promise).
  function revertDraft(rowIds: string[]) {
    setDraftGeometries((prev) => {
      if (!prev) return prev;
      const next = new Map(prev);
      for (const id of rowIds) next.delete(id);
      return next;
    });
    onMoveFailed();
  }

  function handlePointerUp() {
    if (!drag) return;

    if (drag.mode === "draw") {
      const box = drag.currentBox;
      if (drag.moved && box && box.w > 0.01 && box.h > 0.01) {
        onDrawBox(box);
      } else if (!drag.moved) {
        // A plain click (no drag at all) on empty space deselects —
        // mirrors the marquee branch's own no-op-click behavior below.
        onClearSelection();
      }
    } else if (drag.mode === "marquee") {
      const box = drag.currentBox;
      if (drag.moved && box && box.w > 0.005 && box.h > 0.005) {
        const hitIds = rows
          .filter((row) => boxesIntersect(row, box))
          .map((row) => row.id);
        if (hitIds.length > 0) onMarqueeSelect(hitIds);
      } else {
        onClearSelection();
      }
    } else if (drag.mode === "move" && drag.moveOrigins) {
      if (drag.moved && draftGeometries) {
        const changes: GeometryChange[] = drag.moveOrigins.map((origin) => ({
          rowId: origin.rowId,
          before: origin.geometry,
          after: draftGeometries.get(origin.rowId) ?? origin.geometry,
        }));
        // Local-first: draftGeometries is NOT cleared below for this case
        // (see the early return), so the row(s) stay showing the dropped
        // position immediately. Only a failed persist reverts it.
        const movedIds = changes.map((c) => c.rowId);
        onMoveRows(changes).catch(() => revertDraft(movedIds));
        setDrag(null);
        return;
      } else if (drag.deferredSelectRowId) {
        onSelectSingle(drag.deferredSelectRowId);
      }
    } else if (drag.mode === "resize" && drag.resizeRowId && drag.resizeOrigin) {
      const after = draftGeometries?.get(drag.resizeRowId);
      if (after) {
        const resizeRowId = drag.resizeRowId;
        onResizeRow({ rowId: resizeRowId, before: drag.resizeOrigin, after }).catch(
          () => revertDraft([resizeRowId])
        );
        setDrag(null);
        return;
      }
    }

    setDrag(null);
    setDraftGeometries(null);
  }

  function handleStagePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Highest priority, unconditionally: the middle mouse button always
    // pans, regardless of readOnly/shouldPan/anything under the cursor.
    if (event.button === 1) {
      event.preventDefault(); // stop the browser's own middle-click autoscroll
      beginPanDrag(event);
      return;
    }
    if (event.button !== 0) return; // ignore right-click etc.
    if (shouldPan) {
      beginPanDrag(event);
      return;
    }
    if (readOnly) return;
    beginDrawOrMarquee(event, event.shiftKey ? "marquee" : "draw");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (isTypingTarget(event.target) || selectedRowIds.size === 0 || readOnly)
      return;

    const rect = stageRect();
    if (!rect) return;
    const stepX = NUDGE_SCREEN_PIXELS / (effectiveWidth * zoom);
    const stepY = NUDGE_SCREEN_PIXELS / (effectiveHeight * zoom);
    const multiplier = event.shiftKey ? 8 : 1;

    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowLeft") dx = -stepX * multiplier;
    else if (event.key === "ArrowRight") dx = stepX * multiplier;
    else if (event.key === "ArrowUp") dy = -stepY * multiplier;
    else if (event.key === "ArrowDown") dy = stepY * multiplier;
    else return;

    event.preventDefault();
    const changes: GeometryChange[] = [...selectedRowIds]
      .map((id) => findRow(id))
      .filter((row): row is StageRow => Boolean(row))
      .map((row) => {
        const before = { x: row.x, y: row.y, w: row.w, h: row.h };
        const after = {
          x: clamp(before.x + dx, 0, 1 - before.w),
          y: clamp(before.y + dy, 0, 1 - before.h),
          w: before.w,
          h: before.h,
        };
        return { rowId: row.id, before, after };
      });
    onNudgeRows(changes);
  }

  return (
    <div
      ref={viewportRef}
      data-testid="stage-viewport"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative h-full w-full touch-none touch-manipulation select-none overflow-hidden outline-none",
        shouldPan && (drag?.mode === "pan" ? "cursor-grabbing" : "cursor-grab")
      )}
    >
      <div
        ref={stageRef}
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: effectiveWidth,
          height: effectiveHeight,
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
        }}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, drives pointer-math sizing directly */}
        <img
          src={imageUrl}
          alt="Layout drawing"
          className="block h-full w-full select-none"
          draggable={false}
          onLoad={(event) => {
            if (!baseWidth || !baseHeight) {
              setMeasuredSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              });
            }
          }}
        />

        {rows
          .filter((row) => !row.phaseId || !hiddenPhaseIds.has(row.phaseId))
          .map((row) => {
          const draft = draftGeometries?.get(row.id);
          const geometry = draft ?? row;
          const isSelected = selectedRowIds.has(row.id);
          const isSingleSelected = isSelected && selectedRowIds.size === 1;
          const isVertical =
            geometry.h * effectiveHeight >= geometry.w * effectiveWidth;
          const phase = row.phaseId
            ? phases.find((p) => p.id === row.phaseId)
            : undefined;

          return (
            <div
              key={row.id}
              data-testid={`row-box-${row.label}`}
              onPointerDown={(event) => handleRowPointerDown(event, row)}
              className={cn(
                "absolute rounded border-2 border-white/50 bg-[#5b6675]/30",
                !row.hasMaterials &&
                  "border-dashed border-destructive bg-destructive/15",
                isSelected &&
                  "outline outline-2 outline-primary outline-offset-1"
              )}
              style={{
                left: `${geometry.x * 100}%`,
                top: `${geometry.y * 100}%`,
                width: `${geometry.w * 100}%`,
                height: `${geometry.h * 100}%`,
                ...(phase && { borderColor: phase.color }),
              }}
            >
              {/* Own overflow-hidden wrapper, separate from the row box
                  itself: the resize handles below are deliberately
                  positioned outside the row's box (centered on its corners
                  and edges), and clipping them along with the fill bar
                  would leave a handle's own geometric center sitting right
                  on the clip boundary — an unreliably-hittable target. */}
              <div className="absolute inset-0 overflow-hidden rounded">
                <RowFillMarker
                  label={row.label}
                  pct={row.pct}
                  hasMaterials={row.hasMaterials}
                  isComplete={row.isComplete}
                  isVertical={isVertical}
                  readinessStatus={row.readinessStatus}
                />
              </div>
              {isSingleSelected && !readOnly
                ? HANDLES.map((handle) => (
                    <div
                      key={handle.id}
                      data-testid={`resize-handle-${handle.id}`}
                      onPointerDown={(event) =>
                        beginResize(event, row, handle.id)
                      }
                      className={cn(
                        "absolute size-4 rounded-full border-2 border-primary bg-white",
                        handle.position,
                        handle.cursor
                      )}
                    />
                  ))
                : null}
            </div>
          );
        })}

        {(drag?.mode === "draw" || drag?.mode === "marquee") &&
        drag.currentBox ? (
          <div
            className={cn(
              "pointer-events-none absolute z-10 border-2 border-dashed",
              drag.mode === "marquee"
                ? "border-primary bg-primary/20"
                : "border-white bg-blue-500/25"
            )}
            style={{
              left: `${drag.currentBox.x * 100}%`,
              top: `${drag.currentBox.y * 100}%`,
              width: `${drag.currentBox.w * 100}%`,
              height: `${drag.currentBox.h * 100}%`,
            }}
          />
        ) : null}
      </div>

      <ZoomControls zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={fit} />
    </div>
  );
}
