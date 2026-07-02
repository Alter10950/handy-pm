"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RowEditSheet({
  row,
  onClose,
  onRename,
  onDelete,
}: {
  row: { id: string; label: string };
  onClose: () => void;
  onRename: (id: string, label: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [label, setLabel] = useState(row.label);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await onRename(row.id, label);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      try {
        await onDelete(row.id);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete.");
      }
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit row</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="row-label">Row name</Label>
          <Input
            id="row-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            autoFocus
          />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={remove}
            disabled={isPending}
            className="text-destructive"
          >
            Delete row
          </Button>
          <Button type="button" size="lg" onClick={save} disabled={isPending}>
            {isPending ? "Saving..." : "Save row"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
