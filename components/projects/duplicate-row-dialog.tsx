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

export function DuplicateRowDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (count: number, copyMaterials: boolean) => void;
}) {
  const [count, setCount] = useState(1);
  const [copyMaterials, setCopyMaterials] = useState(true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate row</DialogTitle>
          <DialogDescription>
            Places copies adjacent to this row, auto-named the next &ldquo;Row
            N&rdquo;.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="duplicate-count">How many copies?</Label>
          <Input
            id="duplicate-count"
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(event) =>
              setCount(
                Math.max(1, Math.min(50, Number(event.target.value) || 1))
              )
            }
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={copyMaterials}
            onChange={(event) => setCopyMaterials(event.target.checked)}
            className="size-4 rounded border-border"
          />
          Also copy this row&apos;s material assignments
        </label>

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            onClick={() => {
              onConfirm(count, copyMaterials);
              onOpenChange(false);
            }}
          >
            Duplicate{count > 1 ? ` (${count})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
