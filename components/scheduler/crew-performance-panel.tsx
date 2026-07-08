"use client";

import { useMemo } from "react";

import type { Tables } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

// Per-crew SPI, same "no rule specified, split evenly" approximation as
// the capacity view: targets (project-wide, per ADR-022 — never split
// per crew at generation time) are attributed to a crew-day by dividing
// that day's target across however many crews were assigned that day.
export function CrewPerformancePanel({
  crews,
  assignments,
  targetsByDate,
  crewDailyActuals,
}: {
  crews: Tables<"crews">[];
  assignments: Tables<"assignments">[];
  targetsByDate: Map<string, number>;
  crewDailyActuals: Record<string, Record<string, number>>;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const crewStats = useMemo(() => {
    const datesByCrew = new Map<string, Set<string>>();
    const crewCountByDate = new Map<string, Set<string>>();
    for (const a of assignments) {
      if (!a.crew_id) continue;
      const dates = datesByCrew.get(a.crew_id) ?? new Set<string>();
      dates.add(a.work_date);
      datesByCrew.set(a.crew_id, dates);

      const crewsThatDay = crewCountByDate.get(a.work_date) ?? new Set<string>();
      crewsThatDay.add(a.crew_id);
      crewCountByDate.set(a.work_date, crewsThatDay);
    }

    return crews
      .map((crew) => {
        const dates = datesByCrew.get(crew.id) ?? new Set<string>();
        let planned = 0;
        let actual = 0;
        for (const date of dates) {
          if (date > today) continue;
          const dayTarget = targetsByDate.get(date) ?? 0;
          const sharedBy = crewCountByDate.get(date)?.size ?? 1;
          planned += dayTarget / sharedBy;
          actual += crewDailyActuals[crew.id]?.[date] ?? 0;
        }
        const spi = planned > 0 ? actual / planned : null;
        return { crew, planned, actual, spi };
      })
      .filter((stat) => stat.planned > 0 || stat.actual > 0);
  }, [crews, assignments, targetsByDate, crewDailyActuals, today]);

  if (crewStats.length === 0) return null;

  return (
    <div
      data-testid="crew-performance-panel"
      className="flex flex-col gap-2 rounded-lg border border-border bg-card shadow-e1 p-3"
    >
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Crew performance
      </h3>
      <div className="flex flex-col gap-1.5">
        {crewStats.map(({ crew, planned, actual, spi }) => (
          <div
            key={crew.id}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span className="text-foreground">{crew.name}</span>
            <div className="flex items-center gap-2">
              <span className="tabular-nums text-muted-foreground">
                {actual.toFixed(0)} / {planned.toFixed(0)}
              </span>
              {spi !== null ? (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    spi >= 1
                      ? "bg-success/20 text-success-fg"
                      : spi >= 0.8
                        ? "bg-brand-subtle text-foreground"
                        : "bg-destructive/20 text-destructive"
                  )}
                >
                  SPI {spi.toFixed(2)}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
