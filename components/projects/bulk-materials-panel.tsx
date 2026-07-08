"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Tables } from "@/lib/supabase/database.types";

export function BulkMaterialsPanel({
  selectedCount,
  materials,
  onApply,
  onClearSelection,
}: {
  selectedCount: number;
  materials: Tables<"materials">[];
  onApply: (
    materialQtys: { materialId: string; requiredQty: number }[]
  ) => Promise<void>;
  onClearSelection: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  function handleApply() {
    const materialQtys = materials
      .map((material) => ({
        materialId: material.id,
        raw: values[material.id]?.trim() ?? "",
      }))
      .filter((entry) => entry.raw !== "")
      .map((entry) => ({
        materialId: entry.materialId,
        requiredQty: Number(entry.raw),
      }));

    if (materialQtys.some((entry) => !Number.isFinite(entry.requiredQty))) {
      setError("Quantities must be numbers.");
      return;
    }
    if (materialQtys.length === 0) {
      setError("Enter a quantity for at least one material.");
      return;
    }

    setError(null);
    setApplied(false);
    startTransition(async () => {
      try {
        await onApply(materialQtys);
        setApplied(true);
        setValues({});
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  if (materials.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
        {selectedCount} row{selectedCount === 1 ? "" : "s"} selected — add
        materials on the Materials tab first, then come back here to set
        quantities in bulk.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card shadow-e1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          Set materials for {selectedCount} selected row
          {selectedCount === 1 ? "" : "s"}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
        >
          Clear selection
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {materials.map((material) => (
          <div key={material.id} className="flex flex-col gap-1">
            <Label htmlFor={`bulk-qty-${material.id}`} className="text-xs">
              {material.name}
            </Label>
            <Input
              id={`bulk-qty-${material.id}`}
              type="number"
              min={0}
              placeholder="—"
              value={values[material.id] ?? ""}
              onChange={(event) =>
                setValues((prev) => ({
                  ...prev,
                  [material.id]: event.target.value,
                }))
              }
            />
          </div>
        ))}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {applied && !error ? (
        <p className="text-sm text-success-fg">
          Applied to {selectedCount} row{selectedCount === 1 ? "" : "s"}.
        </p>
      ) : null}

      <Button
        type="button"
        size="lg"
        disabled={isPending || selectedCount === 0}
        onClick={handleApply}
      >
        {isPending
          ? "Applying..."
          : `Apply to ${selectedCount} selected row${selectedCount === 1 ? "" : "s"}`}
      </Button>
    </div>
  );
}
