"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type DuplicateDirection = "right" | "below";

// Repeats the current multi-row selection as one block, N times — e.g.
// selecting rows 1-10 and duplicating ×1 to the right creates rows 11-20
// in the same pattern. Distinct from the single-row "Copy" button (which
// places one adjacent copy per selected row, independently) — see
// docs/DECISIONS.md ADR-034 for why this needed its own action instead of
// looping Copy.
export function DuplicateRangeDialog({
  open,
  onOpenChange,
  maxRepeatsRight,
  maxRepeatsBelow,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxRepeatsRight: number;
  maxRepeatsBelow: number;
  onConfirm: (
    repeatCount: number,
    direction: DuplicateDirection,
    copyMaterials: boolean
  ) => void;
}) {
  const [direction, setDirection] = useState<DuplicateDirection>(
    maxRepeatsRight >= maxRepeatsBelow ? "right" : "below"
  );
  const [repeatCount, setRepeatCount] = useState(1);
  const [copyMaterials, setCopyMaterials] = useState(true);

  // Re-derive the default direction/count each time the dialog opens for a
  // (possibly different) selection, rather than carrying stale state from
  // the last time it was used. The React-docs "adjust state on a prop
  // change" pattern (previous prop mirrored in state, setState called
  // conditionally during render) — not a useEffect, which the compiler-
  // aligned react-hooks/set-state-in-effect rule now hard-errors on for a
  // synchronous setState in an effect body. Same pattern already used by
  // row-stage.tsx's own draft-geometry reconciliation.
  const [priorOpen, setPriorOpen] = useState(open);
  if (open !== priorOpen) {
    setPriorOpen(open);
    if (open) {
      setDirection(maxRepeatsRight >= maxRepeatsBelow ? "right" : "below");
      setRepeatCount(1);
    }
  }

  const maxForDirection =
    direction === "right" ? maxRepeatsRight : maxRepeatsBelow;
  const noRoom = maxRepeatsRight === 0 && maxRepeatsBelow === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate range</DialogTitle>
          <DialogDescription>
            Repeats the selected rows as one block — e.g. select rows 1-10 and
            duplicate ×1 to the right to create rows 11-20 in the same pattern.
          </DialogDescription>
        </DialogHeader>

        {noRoom ? (
          <p className="text-sm text-destructive">
            No room to duplicate this selection in either direction — make space
            on the drawing first.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="duplicate-direction">Direction</Label>
              <select
                id="duplicate-direction"
                value={direction}
                onChange={(event) => {
                  const next = event.target.value as DuplicateDirection;
                  setDirection(next);
                  const max =
                    next === "right" ? maxRepeatsRight : maxRepeatsBelow;
                  setRepeatCount((count) => Math.min(count, Math.max(1, max)));
                }}
                className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="right" disabled={maxRepeatsRight === 0}>
                  Right — up to {maxRepeatsRight} fit
                </option>
                <option value="below" disabled={maxRepeatsBelow === 0}>
                  Below — up to {maxRepeatsBelow} fit
                </option>
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="duplicate-count">How many times?</Label>
              <Input
                id="duplicate-count"
                type="number"
                min={1}
                max={maxForDirection}
                value={repeatCount}
                onChange={(event) =>
                  setRepeatCount(
                    Math.max(
                      1,
                      Math.min(maxForDirection, Number(event.target.value) || 1)
                    )
                  )
                }
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={copyMaterials}
                onChange={(event) => setCopyMaterials(event.target.checked)}
                className="size-4 rounded border-border"
              />
              Also copy each row&apos;s materials
            </label>
          </>
        )}

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            disabled={noRoom}
            onClick={() => {
              onConfirm(repeatCount, direction, copyMaterials);
              onOpenChange(false);
            }}
          >
            Duplicate ×{repeatCount}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
