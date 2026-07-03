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
    setSaving(true);
    try {
      const targetRowIds =
        scope === "project"
          ? null
          : scope === "rows"
            ? [...rowIds]
            : rows.filter((row) => row.phase_id === phaseId).map((row) => row.row_id);
      await createAssignment(projectId, crewId, workDate, targetRowIds);
      onDone();
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
                ? "border-primary bg-primary text-primary-foreground"
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
              onClick={() => toggleRow(row.row_id)}
              className={`rounded-md border px-1.5 py-0.5 text-xs ${
                rowIds.has(row.row_id)
                  ? "border-primary bg-primary/20 text-foreground"
                  : "border-border text-muted-foreground"
              }`}
            >
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
    </div>
  );
}
