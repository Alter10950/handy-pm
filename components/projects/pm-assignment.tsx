"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { reassignProjectPm } from "@/lib/projects/actions";

export interface PmCandidate {
  id: string;
  label: string;
}

export function PmAssignment({
  projectId,
  currentPmId,
  currentPmLabel,
  candidates,
  canManage,
}: {
  projectId: string;
  currentPmId: string | null;
  currentPmLabel: string | null;
  candidates: PmCandidate[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(currentPmId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleCancel() {
    setEditing(false);
    setSelected(currentPmId ?? "");
    setError(null);
  }

  function handleSave() {
    if (!selected) {
      setError("Select a PM.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await reassignProjectPm(projectId, selected);
        setEditing(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not reassign.");
      }
    });
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={currentPmLabel ? "text-foreground" : "text-muted-foreground"}>
          {currentPmLabel ?? "Unassigned"}
        </span>
        {canManage ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
          >
            Reassign
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Reassign PM"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          disabled={isPending}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="" disabled>
            Select a PM…
          </option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
        <Button type="button" size="sm" disabled={isPending} onClick={handleSave}>
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={handleCancel}
        >
          Cancel
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
