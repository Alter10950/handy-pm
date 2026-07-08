"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createAssignment } from "@/lib/scheduler/actions";
import type { Tables, Views } from "@/lib/supabase/database.types";

type Scope = "project" | "rows" | "phase";

export function AssignCrewForm({
  projectId,
  workDate,
  crews,
  rows,
  phases,
  onDone,
}: {
  projectId: string;
  workDate: string;
  crews: Tables<"crews">[];
  rows: Views<"row_progress">[];
  phases: Tables<"phases">[];
  onDone: () => void;
}) {
  const [crewId, setCrewId] = useState(crews[0]?.id ?? "");
  const [scope, setScope] = useState<Scope>("project");
  const [rowIds, setRowIds] = useState<Set<string>>(new Set());
  const [phaseId, setPhaseId] = useState(phases[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleRow(id: string) {
    setRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (!crewId) return;

    const targetRowIds =
      scope === "project"
        ? null
        : scope === "rows"
          ? [...rowIds]
          : rows
              .filter((row) => row.phase_id === phaseId)
              .map((row) => row.row_id);

    // Warn, don't hard-block — same posture as the calendar's
    // double-booking check (ADR-029): a row can be genuinely blocked for
    // reasons the scheduler should still be able to override (e.g.
    // sending a crew to prep the area itself), so this is a confirmation,
    // not a refusal.
    if (targetRowIds && targetRowIds.length > 0) {
      const blockedLabels = rows
        .filter(
          (row) =>
            targetRowIds.includes(row.row_id) &&
            row.readiness_status === "blocked"
        )
        .map((row) => row.label);
      if (blockedLabels.length > 0) {
        const confirmed = window.confirm(
          `${blockedLabels.join(", ")} ${blockedLabels.length === 1 ? "is" : "are"} marked blocked (materials not ready or area not accessible). Assign anyway?`
        );
        if (!confirmed) return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      await createAssignment(projectId, crewId, workDate, targetRowIds);
      onDone();
    } catch (err) {
      // The dispatch gate (ADR-042) rejects server-side while Mobilize is
      // locked — surface its message instead of silently doing nothing.
      setError(err instanceof Error ? err.message : "Could not assign crew.");
    } finally {
      setSaving(false);
    }
  }

  if (crews.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No crews yet — add one above first.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-2">
      <select
        value={crewId}
        onChange={(event) => setCrewId(event.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
      >
        {crews.map((crew) => (
          <option key={crew.id} value={crew.id}>
            {crew.name}
          </option>
        ))}
      </select>

      <div className="flex gap-1.5 text-xs">
        {(["project", "rows", "phase"] as Scope[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setScope(option)}
            className={`rounded-md border px-2 py-1 ${
              scope === option
                ? "border-brand bg-brand-subtle text-foreground"
                : "border-border text-muted-foreground"
            }`}
          >
            {option === "project"
              ? "Whole project"
              : option === "rows"
                ? "Specific rows"
                : "A phase"}
          </button>
        ))}
      </div>

      {scope === "rows" ? (
        <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
          {rows.map((row) => (
            <button
              key={row.row_id}
              type="button"
              title={
                row.readiness_status === "blocked"
                  ? "Blocked — materials not ready or area not accessible"
                  : undefined
              }
              onClick={() => toggleRow(row.row_id)}
              className={`rounded-md border px-1.5 py-0.5 text-xs ${
                rowIds.has(row.row_id)
                  ? "border-primary bg-primary/20 text-foreground"
                  : row.readiness_status === "blocked"
                    ? "border-destructive/50 text-destructive"
                    : "border-border text-muted-foreground"
              }`}
            >
              {row.readiness_status === "blocked" ? "⚠ " : ""}
              {row.label}
            </button>
          ))}
        </div>
      ) : null}

      {scope === "phase" ? (
        phases.length === 0 ? (
          <p className="text-xs text-muted-foreground">No phases yet.</p>
        ) : (
          <select
            value={phaseId}
            onChange={(event) => setPhaseId(event.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          >
            {phases.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.name}
              </option>
            ))}
          </select>
        )
      ) : null}

      <Button
        type="button"
        size="sm"
        disabled={
          saving ||
          !crewId ||
          (scope === "rows" && rowIds.size === 0) ||
          (scope === "phase" && !phaseId)
        }
        onClick={() => void handleSubmit()}
      >
        {saving ? "Assigning…" : "Assign"}
      </Button>

      {error ? (
        <p data-testid="assign-crew-error" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
