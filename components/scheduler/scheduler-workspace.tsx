"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { CrewPerformancePanel } from "@/components/scheduler/crew-performance-panel";
import { ProjectTimeline } from "@/components/scheduler/project-timeline";
import { ScheduleBuilder } from "@/components/scheduler/schedule-builder";
import { WeekView } from "@/components/scheduler/week-view";
import { Input } from "@/components/ui/input";
import { generateTargets, upsertPlannedDays } from "@/lib/scheduler/actions";
import type { PhaseTimelineEntry } from "@/lib/scheduler/queries";
import {
  RISK_TIER_CLASS,
  classifySpi,
  computeProjectSpi,
} from "@/lib/scheduler/spi";
import type { Tables, Views } from "@/lib/supabase/database.types";

export function SchedulerWorkspace({
  project,
  progress,
  rows,
  phases,
  crews,
  members,
  assignments,
  schedule,
  targets,
  remaining,
  dailyActuals,
  crewDailyActuals,
  phaseTimelines,
  isOwner,
}: {
  project: Tables<"projects">;
  progress: Views<"project_progress"> | null;
  rows: Views<"row_progress">[];
  phases: Tables<"phases">[];
  crews: Tables<"crews">[];
  members: Tables<"crew_members">[];
  assignments: Tables<"assignments">[];
  schedule: Tables<"project_schedule">[];
  targets: Tables<"targets">[];
  remaining: { materialId: string; name: string; remaining: number }[];
  dailyActuals: Record<string, number>;
  crewDailyActuals: Record<string, Record<string, number>>;
  phaseTimelines: PhaseTimelineEntry[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [plannedDays, setPlannedDays] = useState(
    project.planned_days !== null ? String(project.planned_days) : ""
  );
  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState<string | null>(null);

  const targetsByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const target of targets) {
      map.set(
        target.work_date,
        (map.get(target.work_date) ?? 0) + target.target_qty
      );
    }
    return map;
  }, [targets]);

  const spi = useMemo(
    () => computeProjectSpi(targets, dailyActuals),
    [targets, dailyActuals]
  );

  const totalRemaining = remaining.reduce((sum, m) => sum + m.remaining, 0);

  async function handlePlannedDaysBlur() {
    const value = plannedDays.trim() ? Number(plannedDays) : null;
    await upsertPlannedDays(project.id, value);
    router.refresh();
  }

  async function handleGenerateTargets() {
    setGenerating(true);
    setGenerateMessage(null);
    try {
      const dayCount = await generateTargets(project.id);
      setGenerateMessage(
        dayCount === 0
          ? "No upcoming scheduled days — build the schedule first."
          : `Targets set for ${dayCount} upcoming day${dayCount === 1 ? "" : "s"}.`
      );
      router.refresh();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {project.name}
          </h2>
          {progress ? (
            <p className="text-sm text-muted-foreground">
              {Math.round(progress.pct * 100)}% complete ·{" "}
              {progress.rows_complete}/{progress.row_count} rows done
            </p>
          ) : null}
        </div>
        {spi !== null ? (
          <div
            className={`rounded-full px-3 py-1 text-sm font-medium ${RISK_TIER_CLASS[classifySpi(spi)]}`}
          >
            SPI {spi.toFixed(2)}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card shadow-e1 p-3">
        <label htmlFor="planned-days" className="text-sm text-foreground">
          Planned days
        </label>
        <Input
          id="planned-days"
          type="number"
          min={0}
          value={plannedDays}
          onChange={(event) => setPlannedDays(event.target.value)}
          onBlur={() => void handlePlannedDaysBlur()}
          className="w-24"
        />
        <span className="text-sm text-muted-foreground">
          {totalRemaining} units remaining across {remaining.length} material
          {remaining.length === 1 ? "" : "s"}
        </span>
      </div>

      <ScheduleBuilder
        projectId={project.id}
        schedule={schedule}
        isOwner={isOwner}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={generating}
          onClick={() => void handleGenerateTargets()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {generating ? "Generating…" : "Generate targets from today forward"}
        </button>
        {generateMessage ? (
          <span className="text-sm text-muted-foreground">
            {generateMessage}
          </span>
        ) : null}
      </div>

      <WeekView
        projectId={project.id}
        rows={rows}
        phases={phases}
        crews={crews}
        members={members}
        assignments={assignments}
        scheduledDates={schedule.map((entry) => entry.work_date)}
        targetsByDate={targetsByDate}
        dailyActuals={dailyActuals}
      />

      <ProjectTimeline
        phases={phases}
        timelines={phaseTimelines}
        crews={crews}
      />

      <CrewPerformancePanel
        crews={crews}
        assignments={assignments}
        targetsByDate={targetsByDate}
        crewDailyActuals={crewDailyActuals}
      />
    </div>
  );
}
