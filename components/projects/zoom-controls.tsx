import { Maximize2, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 z-20 flex items-center gap-1 rounded-lg border border-border bg-card shadow-e1/95 p-1 shadow-lg backdrop-blur">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={onZoomOut}
        aria-label="Zoom out"
      >
        <Minus />
      </Button>
      <span className="min-w-11 text-center text-xs font-medium tabular-nums text-muted-foreground">
        {Math.round(zoom * 100)}%
      </span>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={onZoomIn}
        aria-label="Zoom in"
      >
        <Plus />
      </Button>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={onFit}
        aria-label="Fit to screen"
        title="Fit to screen"
      >
        <Maximize2 />
      </Button>
    </div>
  );
}
