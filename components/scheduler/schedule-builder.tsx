"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setProjectSchedule } from "@/lib/scheduler/actions";
import type { CapacityConflictDay } from "@/lib/scheduler/capacity";
import type { Tables } from "@/lib/supabase/database.types";

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isWeekend(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function ScheduleBuilder({
  projectId,
  schedule,
  isOwner,
}: {
  projectId: string;
  schedule: Tables<"project_schedule">[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [end, setEnd] = useState(
    addDays(new Date().toISOString().slice(0, 10), 13)
  );
  const [skipWeekends, setSkipWeekends] = useState(true);
  const [candidateDates, setCandidateDates] = useState<string[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<CapacityConflictDay[] | null>(
    null
  );
  const [suggestedStart, setSuggestedStart] = useState<string | null>(null);
  const [numCrews, setNumCrews] = useState<number | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function generateCandidates() {
    const dates: string[] = [];
    let cursor = start;
    while (cursor <= end) {
      if (!skipWeekends || !isWeekend(cursor)) dates.push(cursor);
      cursor = addDays(cursor, 1);
    }
    setCandidateDates(dates);
    setExcluded(new Set());
    setConflicts(null);
  }

  function toggleDate(date: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  async function handleSave(withOverride: boolean) {
    if (!candidateDates) return;
    setSaving(true);
    setError(null);
    try {
      const finalDates = candidateDates.filter((date) => !excluded.has(date));
      const result = await setProjectSchedule(
        projectId,
        finalDates,
        withOverride ? { reason: overrideReason } : undefined
      );
      if (!result.ok) {
        // The capacity gate said no — show which projects hold those
        // days and the first start that would actually fit.
        setConflicts(result.conflicts);
        setSuggestedStart(result.suggestedStart);
        setNumCrews(result.numCrews);
        return;
      }
      setOpen(false);
      setCandidateDates(null);
      setConflicts(null);
      setOverrideReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save schedule.");
    } finally {
      setSaving(false);
    }
  }

  function useSuggestedStart() {
    if (!suggestedStart) return;
    // Keep the same window length, shifted to the suggested start.
    const lengthDays =
      (new Date(`${end}T00:00:00Z`).getTime() -
        new Date(`${start}T00:00:00Z`).getTime()) /
      86_400_000;
    setStart(suggestedStart);
    setEnd(addDays(suggestedStart, lengthDays));
    setConflicts(null);
    setCandidateDates(null);
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card shadow-e1 p-3">
        <span className="text-sm text-foreground">
          {schedule.length === 0
            ? "No schedule set yet"
            : `${schedule.length} scheduled day${schedule.length === 1 ? "" : "s"} (${schedule[0].work_date} → ${schedule[schedule.length - 1].work_date})`}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
        >
          {schedule.length === 0 ? "Build schedule" : "Rebuild schedule"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card shadow-e1 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="schedule-start"
            className="text-xs text-muted-foreground"
          >
            Start
          </label>
          <Input
            id="schedule-start"
            type="date"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="schedule-end"
            className="text-xs text-muted-foreground"
          >
            End
          </label>
          <Input
            id="schedule-end"
            type="date"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-foreground">
          <input
            type="checkbox"
            checked={skipWeekends}
            onChange={(event) => setSkipWeekends(event.target.checked)}
          />
          Skip weekends
        </label>
        <Button type="button" size="sm" onClick={generateCandidates}>
          Generate days
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>

      {candidateDates ? (
        <>
          <p className="text-xs text-muted-foreground">
            Tap a day to exclude it (e.g. a holiday), then save.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {candidateDates.map((date) => (
              <button
                key={date}
                type="button"
                onClick={() => toggleDate(date)}
                className={`rounded-md border px-2 py-1 text-xs ${
                  excluded.has(date)
                    ? "border-border bg-background text-muted-foreground line-through"
                    : "border-primary bg-primary/20 text-foreground"
                }`}
              >
                {date}
              </button>
            ))}
          </div>
          <Button
            type="button"
            disabled={saving}
            onClick={() => void handleSave(false)}
            className="self-start"
          >
            {saving ? "Saving…" : "Save schedule"}
          </Button>
        </>
      ) : null}

      {conflicts ? (
        <div
          data-testid="capacity-conflict-panel"
          className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3"
        >
          <p className="text-sm font-semibold text-destructive">
            Over capacity — the org has {numCrews} crew
            {numCrews === 1 ? "" : "s"}
          </p>
          <ul className="flex flex-col gap-0.5 text-xs text-foreground">
            {conflicts.slice(0, 8).map((c) => (
              <li key={c.date}>
                {c.date}: already committed to {c.projectNames.join(", ")}
              </li>
            ))}
            {conflicts.length > 8 ? (
              <li className="text-muted-foreground">
                …and {conflicts.length - 8} more day
                {conflicts.length - 8 === 1 ? "" : "s"}
              </li>
            ) : null}
          </ul>
          {suggestedStart ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-foreground">
                First start that fits:{" "}
                <span data-testid="suggested-start" className="font-semibold">
                  {suggestedStart}
                </span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={useSuggestedStart}
              >
                Use this start
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No fully free window found in the next year.
            </p>
          )}
          {isOwner ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-destructive/30 pt-2">
              <Input
                aria-label="Override reason"
                placeholder="Override reason (e.g. borrowed crew)"
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                disabled={saving}
                className="h-8 w-64 text-sm"
              />
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={saving || !overrideReason.trim()}
                onClick={() => void handleSave(true)}
              >
                {saving ? "Saving…" : "Override & save anyway"}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Only an owner can override the capacity limit.
            </p>
          )}
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
