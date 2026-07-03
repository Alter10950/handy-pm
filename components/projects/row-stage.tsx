"use client";

import { useEffect, useRef, useState } from "react";

import { RowFillMarker } from "@/components/projects/row-fill-marker";
import { ZoomControls } from "@/components/projects/zoom-controls";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  useZoomPan,
} from "@/components/projects/use-zoom-pan";
import { cn } from "@/lib/utils";

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
}

export type StageTool = "grid" | "draw" | "edit" | "select" | "pan";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DragState {
  mode: "draw" | "move" | "resize" | "pan" | "marquee";
  rowId?: string;
  startClientX: number;
  startClientY: number;
  stageWidth: number;
  stageHeight: number;
  originGeometry?: Box;
  startPanX?: number;
  startPanY?: number;
  moved: boolean;
  currentBox?: Box;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function boxesIntersect(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
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
 */
export function RowStage({
  imageUrl,
  baseWidth,
  baseHeight,
  rows,
  tool,
  selectedRowId,
  onSelectRow,
  onDrawBox,
  onMoveRow,
  onResizeRow,
  onTapRow,
  selectedRowIds,
  onToggleRowSelection,
  onMarqueeSelect,
  onClearSelection,
}: {
  imageUrl: string;
  baseWidth: number;
  baseHeight: number;
  rows: StageRow[];
  tool: StageTool;
  selectedRowId: string | null;
  onSelectRow: (id: string | null) => void;
  onDrawBox: (box: Box) => void;
  onMoveRow: (id: string, geometry: Box) => void;
  onResizeRow: (id: string, geometry: Box) => void;
  onTapRow: (id: string) => void;
  selectedRowIds: Set<string>;
  onToggleRowSelection: (id: string, shift: boolean) => void;
  onMarqueeSelect: (ids: string[]) => void;
  onClearSelection: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draftGeometry, setDraftGeometry] = useState<{
    rowId: string;
    geometry: Box;
  } | null>(null);
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

  const shouldPan = tool === "pan" || spaceHeld;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code === "Space" && !isTypingTarget(event.target)) {
        setSpaceHeld(true);
      }
    }
    function handleKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") setSpaceHeld(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
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
      setDraftGeometry(null);
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

      // Anchor the point that was under the pinch's original midpoint to
      // wherever that midpoint has moved to (pan + zoom together).
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
    // Mount once; zoomPanRef always reads the latest zoom/pan values.
  }, []);

  function stageRect() {
    const el = stageRef.current;
    if (!el) return null;
    return el.getBoundingClientRect();
  }

  function beginDrawDrag(event: React.PointerEvent<HTMLDivElement>) {
    const rect = stageRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      mode: "draw",
      startClientX: event.clientX,
      startClientY: event.clientY,
      stageWidth: rect.width,
      stageHeight: rect.height,
      moved: false,
      currentBox: { x: 0, y: 0, w: 0, h: 0 },
    });
  }

  function beginMarqueeDrag(event: React.PointerEvent<HTMLDivElement>) {
    const rect = stageRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      mode: "marquee",
      startClientX: event.clientX,
      startClientY: event.clientY,
      stageWidth: rect.width,
      stageHeight: rect.height,
      moved: false,
      currentBox: { x: 0, y: 0, w: 0, h: 0 },
    });
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

  function beginRowDrag(
    event: React.PointerEvent<HTMLDivElement>,
    row: StageRow,
    mode: "move" | "resize"
  ) {
    if (tool !== "edit") return;
    event.stopPropagation();
    const rect = stageRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectRow(row.id);
    setDrag({
      mode,
      rowId: row.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      stageWidth: rect.width,
      stageHeight: rect.height,
      originGeometry: { x: row.x, y: row.y, w: row.w, h: row.h },
      moved: false,
    });
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
      const x0 = (drag.startClientX - stageRect()!.left) / drag.stageWidth;
      const y0 = (drag.startClientY - stageRect()!.top) / drag.stageHeight;
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

    if (drag.mode === "move" && drag.rowId && drag.originGeometry) {
      const origin = drag.originGeometry;
      const geometry: Box = {
        x: clamp(origin.x + dx, 0, 1 - origin.w),
        y: clamp(origin.y + dy, 0, 1 - origin.h),
        w: origin.w,
        h: origin.h,
      };
      setDrag({ ...drag, moved: true });
      setDraftGeometry({ rowId: drag.rowId, geometry });
      return;
    }

    if (drag.mode === "resize" && drag.rowId && drag.originGeometry) {
      const origin = drag.originGeometry;
      const geometry: Box = {
        x: origin.x,
        y: origin.y,
        w: clamp(origin.w + dx, 0.02, 1 - origin.x),
        h: clamp(origin.h + dy, 0.02, 1 - origin.y),
      };
      setDrag({ ...drag, moved: true });
      setDraftGeometry({ rowId: drag.rowId, geometry });
    }
  }

  function handlePointerUp() {
    if (!drag) return;

    if (drag.mode === "pan") {
      // nothing to persist — pan is view-only state
    } else if (drag.mode === "draw") {
      const box = drag.currentBox;
      if (drag.moved && box && box.w > 0.01 && box.h > 0.01) {
        onDrawBox(box);
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
    } else if (drag.mode === "move" && drag.rowId) {
      if (drag.moved && draftGeometry) {
        onMoveRow(drag.rowId, draftGeometry.geometry);
      } else {
        onTapRow(drag.rowId);
      }
    } else if (drag.mode === "resize" && drag.rowId) {
      if (draftGeometry) {
        onResizeRow(drag.rowId, draftGeometry.geometry);
      }
    }

    setDrag(null);
    setDraftGeometry(null);
  }

  function handleStagePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (shouldPan) {
      beginPanDrag(event);
      return;
    }
    if (tool === "grid" || tool === "draw") {
      beginDrawDrag(event);
    } else if (tool === "edit") {
      onSelectRow(null);
    } else if (tool === "select") {
      beginMarqueeDrag(event);
    }
  }

  return (
    <div
      ref={viewportRef}
      data-testid="stage-viewport"
      className={cn(
        "relative h-full w-full touch-none select-none overflow-hidden",
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

        {rows.map((row) => {
          const geometry =
            draftGeometry?.rowId === row.id ? draftGeometry.geometry : row;
          const isSelected = selectedRowId === row.id;
          const isBulkSelected = selectedRowIds.has(row.id);
          const isVertical =
            geometry.h * effectiveHeight >= geometry.w * effectiveWidth;

          return (
            <div
              key={row.id}
              onPointerDown={(event) => {
                if (tool === "select") {
                  event.stopPropagation();
                  onToggleRowSelection(row.id, event.shiftKey);
                  return;
                }
                beginRowDrag(event, row, "move");
              }}
              className={cn(
                "absolute overflow-hidden rounded border-2 border-white/50 bg-[#5b6675]/30",
                !row.hasMaterials &&
                  "border-dashed border-destructive bg-destructive/15",
                isSelected &&
                  "outline outline-2 outline-white outline-offset-1",
                tool === "select" &&
                  isBulkSelected &&
                  "outline outline-2 outline-primary outline-offset-1 bg-primary/25"
              )}
              style={{
                left: `${geometry.x * 100}%`,
                top: `${geometry.y * 100}%`,
                width: `${geometry.w * 100}%`,
                height: `${geometry.h * 100}%`,
              }}
            >
              <RowFillMarker
                label={row.label}
                pct={row.pct}
                hasMaterials={row.hasMaterials}
                isComplete={row.isComplete}
                isVertical={isVertical}
              />
              {tool === "edit" && isSelected ? (
                <div
                  onPointerDown={(event) => beginRowDrag(event, row, "resize")}
                  className="absolute -right-2.5 -bottom-2.5 size-5 cursor-nwse-resize rounded-full border-2 border-primary bg-white"
                />
              ) : null}
              {tool === "select" ? (
                <div
                  className={cn(
                    "absolute top-1 left-1 flex size-5 items-center justify-center rounded border-2 text-xs font-bold",
                    isBulkSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-white/70 bg-black/20 text-transparent"
                  )}
                >
                  ✓
                </div>
              ) : null}
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

      <ZoomControls
        zoom={zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFit={fit}
      />
    </div>
  );
}
