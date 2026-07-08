"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { RowReadinessInputs } from "@/lib/rows/actions";

const READINESS_TIER_CLASS: Record<string, string> = {
  ready: "bg-success/15 text-success-fg",
  partial: "bg-brand-subtle text-foreground",
  blocked: "bg-destructive/15 text-destructive",
  complete: "bg-success/15 text-success-fg",
};

export function RowReadinessPanel({
  materialsReady: materialsReadyProp,
  areaAccessible: areaAccessibleProp,
  drawingApproved: drawingApprovedProp,
  readinessStatus,
  isPending,
  onChange,
  onCancel,
}: {
  materialsReady: boolean;
  areaAccessible: boolean;
  drawingApproved: boolean;
  readinessStatus: string;
  isPending: boolean;
  onChange: (patch: RowReadinessInputs) => void;
  onCancel: () => void;
}) {
  // Local-first, same reasoning as row-stage.tsx's move/resize fix: these
  // checkboxes would otherwise be fully server-controlled (checked={prop}
  // with no local state), so a click would flip the DOM checkbox for a
  // frame and then snap back the instant React re-renders with the same
  // still-stale prop — before the persist + router.refresh() round trip
  // ever lands. Seeded from props once; safe because this panel only
  // stays mounted while selection doesn't change (selecting a different
  // row resets activeCommand, unmounting this).
  const [materialsReady, setMaterialsReady] = useState(materialsReadyProp);
  const [areaAccessible, setAreaAccessible] = useState(areaAccessibleProp);
  const [drawingApproved, setDrawingApproved] = useState(drawingApprovedProp);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card shadow-e1 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Readiness</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
            READINESS_TIER_CLASS[readinessStatus] ??
            "bg-muted text-muted-foreground"
          }`}
        >
          {readinessStatus}
        </span>
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={materialsReady}
          disabled={isPending}
          onChange={(event) => {
            setMaterialsReady(event.target.checked);
            onChange({ materialsReady: event.target.checked });
          }}
          className="size-4 rounded border-border"
        />
        Materials ready
      </label>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={areaAccessible}
          disabled={isPending}
          onChange={(event) => {
            setAreaAccessible(event.target.checked);
            onChange({ areaAccessible: event.target.checked });
          }}
          className="size-4 rounded border-border"
        />
        Area accessible
      </label>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={drawingApproved}
          disabled={isPending}
          onChange={(event) => {
            setDrawingApproved(event.target.checked);
            onChange({ drawingApproved: event.target.checked });
          }}
          className="size-4 rounded border-border"
        />
        Drawing approved
      </label>

      <p className="text-xs text-muted-foreground">
        A crew must also be assigned (from the Scheduler) for this row to show
        as fully ready.
      </p>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={onCancel}
      >
        Close
      </Button>
    </div>
  );
}
