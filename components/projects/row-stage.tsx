"use client";

import { useEffect, useRef, useState } from "react";

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

export type StageTool = "grid" | "draw" | "edit";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DragState {
  mode: "draw" | "move" | "resize";
  rowId?: string;
  startClientX: number;
  startClientY: number;
  stageWidth: number;
  stageHeight: number;
  originGeometry?: Box;
  moved: boolean;
  currentBox?: Box;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function RowStage({
  imageUrl,
  rows,
  tool,
  selectedRowId,
  onSelectRow,
  onDrawBox,
  onMoveRow,
  onResizeRow,
  onTapRow,
}: {
  imageUrl: string;
  rows: StageRow[];
  tool: StageTool;
  selectedRowId: string | null;
  onSelectRow: (id: string | null) => void;
  onDrawBox: (box: Box) => void;
  onMoveRow: (id: string, geometry: Box) => void;
  onResizeRow: (id: string, geometry: Box) => void;
  onTapRow: (id: string) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draftGeometry, setDraftGeometry] = useState<{
    rowId: string;
    geometry: Box;
  } | null>(null);
  // Rendered pixel size of the stage, kept in sync via ResizeObserver.
  // Needed because "is this row taller or wider" has to compare actual
  // pixels, not raw normalized w/h — those are only comparable directly
  // when the stage happens to be square.
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
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
    const dx = (event.clientX - drag.startClientX) / drag.stageWidth;
    const dy = (event.clientY - drag.startClientY) / drag.stageHeight;

    if (drag.mode === "draw") {
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

    if (drag.mode === "draw") {
      const box = drag.currentBox;
      if (drag.moved && box && box.w > 0.01 && box.h > 0.01) {
        onDrawBox(box);
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

  return (
    <div
      ref={stageRef}
      className="relative touch-none select-none"
      onPointerDown={(event) => {
        if (tool === "grid" || tool === "draw") {
          beginDrawDrag(event);
        } else if (tool === "edit") {
          onSelectRow(null);
        }
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, drives pointer-math sizing directly */}
      <img
        src={imageUrl}
        alt="Layout drawing"
        className="block max-w-full select-none"
        draggable={false}
      />

      {rows.map((row) => {
        const geometry =
          draftGeometry?.rowId === row.id ? draftGeometry.geometry : row;
        const isSelected = selectedRowId === row.id;
        const pct = Math.round(row.pct * 100);
        const isVertical =
          geometry.h * stageSize.height >= geometry.w * stageSize.width;

        return (
          <div
            key={row.id}
            onPointerDown={(event) => beginRowDrag(event, row, "move")}
            className={cn(
              "absolute overflow-hidden rounded border-2 border-white/50 bg-[#5b6675]/30",
              !row.hasMaterials &&
                "border-dashed border-destructive bg-destructive/15",
              isSelected && "outline outline-2 outline-white outline-offset-1"
            )}
            style={{
              left: `${geometry.x * 100}%`,
              top: `${geometry.y * 100}%`,
              width: `${geometry.w * 100}%`,
              height: `${geometry.h * 100}%`,
            }}
          >
            <div
              className={cn(
                "absolute bg-primary/55",
                row.isComplete && "bg-success/60"
              )}
              style={
                isVertical
                  ? { left: 0, bottom: 0, width: "100%", height: `${pct}%` }
                  : { left: 0, bottom: 0, height: "100%", width: `${pct}%` }
              }
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center p-0.5 text-center text-[10px] font-extrabold leading-tight text-[#06121f] [text-shadow:0_1px_2px_rgba(255,255,255,.5)]">
              <span>{row.label}</span>
              <span>{row.hasMaterials ? `${pct}%` : "⚠"}</span>
            </div>
            {!row.hasMaterials ? (
              <span className="absolute right-0.5 top-0.5 text-xs drop-shadow-[0_1px_1px_rgba(0,0,0,.6)]">
                ⚠️
              </span>
            ) : null}
            {tool === "edit" && isSelected ? (
              <div
                onPointerDown={(event) => beginRowDrag(event, row, "resize")}
                className="absolute -right-2.5 -bottom-2.5 size-5 cursor-nwse-resize rounded-full border-2 border-primary bg-white"
              />
            ) : null}
          </div>
        );
      })}

      {drag?.mode === "draw" && drag.currentBox ? (
        <div
          className="pointer-events-none absolute z-10 border-2 border-dashed border-white bg-blue-500/25"
          style={{
            left: `${drag.currentBox.x * 100}%`,
            top: `${drag.currentBox.y * 100}%`,
            width: `${drag.currentBox.w * 100}%`,
            height: `${drag.currentBox.h * 100}%`,
          }}
        />
      ) : null}
    </div>
  );
}
