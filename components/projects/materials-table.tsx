"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addMaterial,
  deleteMaterial,
  updateMaterial,
} from "@/lib/projects/actions";
import type { Tables } from "@/lib/supabase/database.types";

type MaterialPatch = Partial<{
  name: string;
  unit: string;
  total_needed: number;
  received: number;
}>;

export function MaterialsTable({
  projectId,
  materials,
}: {
  projectId: string;
  materials: Tables<"materials">[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(id: string, patch: MaterialPatch) {
    setError(null);
    startTransition(async () => {
      try {
        await updateMaterial(id, projectId, patch);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await deleteMaterial(id, projectId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not remove.");
      }
    });
  }

  function add() {
    setError(null);
    startTransition(async () => {
      try {
        await addMaterial(projectId, "New part");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Part</th>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 text-right font-medium">Needed</th>
              <th className="px-3 py-2 text-right font-medium">Received</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {materials.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  No materials yet — add one or paste from a packing slip.
                </td>
              </tr>
            ) : (
              materials.map((material) => (
                <MaterialRow
                  // Remount on any server-confirmed field change so the
                  // uncontrolled inputs' defaultValue stays in sync after
                  // a Server Action revalidates this page.
                  key={`${material.id}:${material.name}:${material.unit}:${material.total_needed}:${material.received}`}
                  material={material}
                  onSave={save}
                  onRemove={remove}
                  disabled={isPending}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={add}
          disabled={isPending}
        >
          + Add material
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

function MaterialRow({
  material,
  onSave,
  onRemove,
  disabled,
}: {
  material: Tables<"materials">;
  onSave: (id: string, patch: MaterialPatch) => void;
  onRemove: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2">
        <Input
          defaultValue={material.name}
          onBlur={(event) => {
            if (event.target.value !== material.name) {
              onSave(material.id, { name: event.target.value });
            }
          }}
          disabled={disabled}
          className="h-9"
        />
      </td>
      <td className="px-3 py-2">
        <Input
          defaultValue={material.unit}
          onBlur={(event) => {
            if (event.target.value !== material.unit) {
              onSave(material.id, { unit: event.target.value });
            }
          }}
          disabled={disabled}
          className="h-9 w-20"
        />
      </td>
      <td className="px-3 py-2">
        <Input
          type="number"
          min={0}
          defaultValue={material.total_needed}
          onBlur={(event) => {
            const value = Math.max(0, Number(event.target.value) || 0);
            if (value !== material.total_needed) {
              onSave(material.id, { total_needed: value });
            }
          }}
          disabled={disabled}
          className="h-9 w-24 text-right"
        />
      </td>
      <td className="px-3 py-2">
        <Input
          type="number"
          min={0}
          defaultValue={material.received}
          onBlur={(event) => {
            const value = Math.max(0, Number(event.target.value) || 0);
            if (value !== material.received) {
              onSave(material.id, { received: value });
            }
          }}
          disabled={disabled}
          className="h-9 w-24 text-right"
        />
      </td>
      <td className="px-3 py-2 text-right">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onRemove(material.id)}
          disabled={disabled}
          className="text-destructive"
        >
          Remove
        </Button>
      </td>
    </tr>
  );
}
