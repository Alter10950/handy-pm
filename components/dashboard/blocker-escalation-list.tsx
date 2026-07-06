"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { resolveBlocker } from "@/lib/dashboard/actions";
import type { DashboardBlocker } from "@/lib/dashboard/queries";

function daysOpen(workDate: string): number {
  const opened = new Date(`${workDate}T00:00:00`).getTime();
  const today = new Date().setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - opened) / 86_400_000));
}

export function BlockerEscalationList({
  blockers,
}: {
  blockers: DashboardBlocker[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  function handleResolve(id: string) {
    setError(null);
    setResolvingId(id);
    startTransition(async () => {
      try {
        await resolveBlocker(id);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not resolve.");
      } finally {
        setResolvingId(null);
      }
    });
  }

  if (blockers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No open blockers across any active project.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <ul className="flex flex-col gap-2">
        {blockers.map((blocker) => {
          const open = daysOpen(blocker.workDate);
          return (
            <li
              key={blocker.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background p-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {blocker.projectName}
                  {blocker.crewName ? ` — ${blocker.crewName}` : ""}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {blocker.code}
                  {blocker.note ? `: ${blocker.note}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={
                    open >= 2
                      ? "rounded-full bg-destructive/20 px-2 py-0.5 text-xs font-medium text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {open === 0 ? "today" : `${open}d open`}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending && resolvingId === blocker.id}
                  onClick={() => handleResolve(blocker.id)}
                >
                  {isPending && resolvingId === blocker.id ? "…" : "Mark resolved"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
