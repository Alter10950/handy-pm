"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Tables } from "@/lib/supabase/database.types";

const SWATCH_COLORS = [
  "#f2c00e",
  "#22c55e",
  "#3b82f6",
  "#ef4444",
  "#a855f7",
  "#f97316",
];

// Minimal — enough for the Layout tab's "Set phase" command to work end
// to end now. The full Phases sub-phase (colors on the drawing, legend,
// show/hide) builds on this same phases/rows.phase_id data later.
export function PhasePicker({
  phases,
  onApply,
  onCreateAndApply,
  onCancel,
}: {
  phases: Tables<"phases">[];
  onApply: (phaseId: string | null) => void;
  onCreateAndApply: (name: string, color: string) => void;
  onCancel: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCH_COLORS[0]);

  if (creating) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
        <Input
          autoFocus
          placeholder="Phase name (e.g. Phase 2)"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="flex items-center gap-1.5">
          {SWATCH_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Color ${swatch}`}
              onClick={() => setColor(swatch)}
              className="size-6 rounded-full border-2"
              style={{
                backgroundColor: swatch,
                borderColor: color === swatch ? "#fff" : "transparent",
              }}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!name.trim()}
            onClick={() => onCreateAndApply(name.trim(), color)}
          >
            Create &amp; assign
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCreating(false)}
          >
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Assign selection to a phase
      </p>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => onApply(null)}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
        >
          <span className="size-3 rounded-full border border-border" />
          No phase
        </button>
        {phases.map((phase) => (
          <button
            key={phase.id}
            type="button"
            onClick={() => onApply(phase.id)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            <span
              className="size-3 rounded-full"
              style={{ backgroundColor: phase.color }}
            />
            {phase.name}
          </button>
        ))}
      </div>
      <div className="flex gap-2 border-t border-border pt-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCreating(true)}
        >
          + New phase
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
