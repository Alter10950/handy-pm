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

export type RowOrientation = "vertical" | "horizontal";

export function AutoRowsDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (count: number, orientation: RowOrientation) => void;
}) {
  const [count, setCount] = useState(24);
  const [orientation, setOrientation] = useState<RowOrientation>("vertical");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Auto-create rows</DialogTitle>
          <DialogDescription>
            Split the rack area into equal rows. Each gets the default setup —
            adjust any row after.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="row-count">How many rows?</Label>
          <Input
            id="row-count"
            type="number"
            min={1}
            max={150}
            value={count}
            onChange={(event) =>
              setCount(
                Math.max(1, Math.min(150, Number(event.target.value) || 1))
              )
            }
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="row-orientation">Rows run…</Label>
          <select
            id="row-orientation"
            value={orientation}
            onChange={(event) =>
              setOrientation(event.target.value as RowOrientation)
            }
            className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="vertical">
              Vertical (side by side) — split left→right
            </option>
            <option value="horizontal">
              Horizontal (stacked) — split top→bottom
            </option>
          </select>
        </div>

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            onClick={() => {
              onConfirm(count, orientation);
              onOpenChange(false);
            }}
          >
            Next → drag box
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
