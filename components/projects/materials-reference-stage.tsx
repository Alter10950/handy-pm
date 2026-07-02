"use client";

import { useEffect, useRef, useState } from "react";

import { RowFillMarker } from "@/components/projects/row-fill-marker";
import { cn } from "@/lib/utils";

export interface ReferenceRow {
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

export function MaterialsReferenceStage({
  imageUrl,
  rows,
  highlightedRowId,
  onRowClick,
}: {
  imageUrl: string;
  rows: ReferenceRow[];
  highlightedRowId: string | null;
  onRowClick: (rowId: string) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
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

  return (
    <div ref={stageRef} className="relative select-none">
      {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, drives pointer-math sizing directly */}
      <img
        src={imageUrl}
        alt="Layout drawing"
        className="block max-w-full select-none"
        draggable={false}
      />

      {rows.map((row) => {
        const isVertical = row.h * stageSize.height >= row.w * stageSize.width;

        return (
          <button
            key={row.id}
            type="button"
            onClick={() => onRowClick(row.id)}
            className={cn(
              "absolute overflow-hidden rounded border-2 border-white/50 bg-[#5b6675]/30 text-left",
              !row.hasMaterials &&
                "border-dashed border-destructive bg-destructive/15",
              highlightedRowId === row.id &&
                "outline outline-2 outline-white outline-offset-1"
            )}
            style={{
              left: `${row.x * 100}%`,
              top: `${row.y * 100}%`,
              width: `${row.w * 100}%`,
              height: `${row.h * 100}%`,
            }}
          >
            <RowFillMarker
              label={row.label}
              pct={row.pct}
              hasMaterials={row.hasMaterials}
              isComplete={row.isComplete}
              isVertical={isVertical}
            />
          </button>
        );
      })}
    </div>
  );
}
