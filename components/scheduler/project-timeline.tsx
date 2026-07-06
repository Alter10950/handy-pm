"use client";

import type { PhaseTimelineEntry } from "@/lib/scheduler/queries";
import type { Tables } from "@/lib/supabase/database.types";

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) /
      86_400_000
  );
}

function formatDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

// Gantt-style: each phase's date range is inferred from when its rows
// were actually assigned to a crew (assignments joined through
// rows.phase_id — see getPhaseTimelines), not a stored start/end date —
// phases have none of their own. A phase with no assignments yet simply
// has no bar.
export function ProjectTimeline({
  phases,
  timelines,
  crews,
}: {
  phases: Tables<"phases">[];
  timelines: PhaseTimelineEntry[];
  crews: Tables<"crews">[];
}) {
  if (timelines.length === 0) return null;

  const overallStart = timelines.reduce(
    (min, t) => (t.startDate < min ? t.startDate : min),
    timelines[0].startDate
  );
  const overallEnd = timelines.reduce(
    (max, t) => (t.endDate > max ? t.endDate : max),
    timelines[0].endDate
  );
  const totalDays = Math.max(1, daysBetween(overallStart, overallEnd) + 1);
  const phaseById = new Map(phases.map((p) => [p.id, p]));
  const crewNameById = new Map(crews.map((c) => [c.id, c.name]));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Timeline
        </h3>
        <span className="text-xs text-muted-foreground">
          {formatDate(overallStart)} – {formatDate(overallEnd)}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {timelines.map((entry) => {
          const phase = phaseById.get(entry.phaseId);
          if (!phase) return null;
          const offsetDays = daysBetween(overallStart, entry.startDate);
          const spanDays = daysBetween(entry.startDate, entry.endDate) + 1;
          const leftPct = (offsetDays / totalDays) * 100;
          const widthPct = Math.max(3, (spanDays / totalDays) * 100);
          const crewNames = entry.crewIds
            .map((id) => crewNameById.get(id) ?? "Unknown crew")
            .join(", ");
          return (
            <div key={entry.phaseId} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-xs text-foreground">
                {phase.name}
              </span>
              <div className="relative h-6 flex-1 rounded bg-background">
                <div
                  className="absolute top-0 h-full rounded opacity-80"
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    backgroundColor: phase.color,
                  }}
                  title={`${formatDate(entry.startDate)} → ${formatDate(entry.endDate)}${crewNames ? ` — ${crewNames}` : ""}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
