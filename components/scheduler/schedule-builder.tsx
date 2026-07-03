"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setProjectSchedule } from "@/lib/scheduler/actions";
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
}: {
  projectId: string;
  schedule: Tables<"project_schedule">[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [end, setEnd] = useState(addDays(new Date().toISOString().slice(0, 10), 13));
  const [skipWeekends, setSkipWeekends] = useState(true);
  const [candidateDates, setCandidateDates] = useState<string[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  function generateCandidates() {
    const dates: string[] = [];
    let cursor = start;
    while (cursor <= end) {
      if (!skipWeekends || !isWeekend(cursor)) dates.push(cursor);
      cursor = addDays(cursor, 1);
    }
    setCandidateDates(dates);
    setExcluded(new Set());
  }

  function toggleDate(date: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  async function handleSave() {
    if (!candidateDates) return;
    setSaving(true);
    try {
      const finalDates = candidateDates.filter((date) => !excluded.has(date));
      await setProjectSchedule(projectId, finalDates);
      setOpen(false);
      setCandidateDates(null);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <span className="text-sm text-foreground">
          {schedule.length === 0
            ? "No schedule set yet"
            : `${schedule.length} scheduled day${schedule.length === 1 ? "" : "s"} (${schedule[0].work_date} → ${schedule[schedule.length - 1].work_date})`}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          {schedule.length === 0 ? "Build schedule" : "Rebuild schedule"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="schedule-start" className="text-xs text-muted-foreground">
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
          <label htmlFor="schedule-end" className="text-xs text-muted-foreground">
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
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
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
            onClick={() => void handleSave()}
            className="self-start"
          >
            {saving ? "Saving…" : "Save schedule"}
          </Button>
        </>
      ) : null}
    </div>
  );
}
