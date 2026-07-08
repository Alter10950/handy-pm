"use client";

import type { Tables } from "@/lib/supabase/database.types";

// Show/hide toggles which rows *render* on the drawing (RowStage skips
// hidden-phase rows entirely, not just dims them) — a way to declutter a
// dense drawing down to "just the rows I'm working on," not a permanent
// per-phase visibility setting.
export function PhaseLegend({
  phases,
  hiddenPhaseIds,
  onToggle,
}: {
  phases: Tables<"phases">[];
  hiddenPhaseIds: Set<string>;
  onToggle: (phaseId: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card shadow-e1 p-2">
      <span className="text-xs font-medium text-muted-foreground">Phases:</span>
      {phases.map((phase) => {
        const hidden = hiddenPhaseIds.has(phase.id);
        return (
          <button
            key={phase.id}
            type="button"
            onClick={() => onToggle(phase.id)}
            className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${
              hidden
                ? "border-border text-muted-foreground opacity-50"
                : "border-border text-foreground"
            }`}
            title={hidden ? `Show ${phase.name}` : `Hide ${phase.name}`}
          >
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: phase.color }}
            />
            {phase.name}
          </button>
        );
      })}
    </div>
  );
}
