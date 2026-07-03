"use client";

import { useMemo, useState } from "react";

import type { Tables, Views } from "@/lib/supabase/database.types";

// Phase-scoped stats computed client-side from data the Progress page
// already fetched (row_progress + phases) — no extra round trip, and no
// new query needed just to slice numbers the page already has by phase_id.
export function PhaseProgress({
  phases,
  rowProgress,
}: {
  phases: Tables<"phases">[];
  rowProgress: Views<"row_progress">[];
}) {
  const [phaseId, setPhaseId] = useState("");

  const stats = useMemo(() => {
    const rows = phaseId
      ? rowProgress.filter((row) => row.phase_id === phaseId)
      : rowProgress;
    const rowCount = rows.length;
    const rowsComplete = rows.filter((row) => row.is_complete).length;
    const rowsMissingMaterials = rows.filter((row) => !row.has_materials).length;
    const requiredTotal = rows.reduce((sum, row) => sum + row.required_total, 0);
    const installedTotal = rows.reduce((sum, row) => sum + row.installed_total, 0);
    const pct = requiredTotal > 0 ? installedTotal / requiredTotal : 0;
    return { rowCount, rowsComplete, rowsMissingMaterials, pct };
  }, [phaseId, rowProgress]);

  if (phases.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <label htmlFor="progress-phase-filter" className="text-sm text-foreground">
          Filter by phase
        </label>
        <select
          id="progress-phase-filter"
          value={phaseId}
          onChange={(event) => setPhaseId(event.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        >
          <option value="">All phases</option>
          {phases.map((phase) => (
            <option key={phase.id} value={phase.id}>
              {phase.name}
            </option>
          ))}
        </select>
      </div>

      {phaseId ? (
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              {phases.find((p) => p.id === phaseId)?.name} complete
            </span>
            <span className="text-2xl font-bold tabular-nums text-foreground">
              {Math.round(stats.pct * 100)}%
            </span>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${Math.round(stats.pct * 100)}%` }}
            />
          </div>
          <div className="mt-3 flex gap-4 text-sm text-muted-foreground">
            <span>{stats.rowCount} rows</span>
            <span className="text-success">{stats.rowsComplete} complete</span>
            {stats.rowsMissingMaterials > 0 ? (
              <span className="text-warning">
                {stats.rowsMissingMaterials} missing materials
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
