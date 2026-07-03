"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { AssignCrewForm } from "@/components/scheduler/assign-crew-form";
import { Button } from "@/components/ui/button";
import { deleteAssignment } from "@/lib/scheduler/actions";
import type { Tables, Views } from "@/lib/supabase/database.types";

function startOfWeek(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday as the first day
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function WeekView({
  projectId,
  rows,
  phases,
  crews,
  members,
  assignments,
  scheduledDates,
  targetsByDate,
  dailyActuals,
}: {
  projectId: string;
  rows: Views<"row_progress">[];
  phases: Tables<"phases">[];
  crews: Tables<"crews">[];
  members: Tables<"crew_members">[];
  assignments: Tables<"assignments">[];
  scheduledDates: string[];
  targetsByDate: Map<string, number>;
  dailyActuals: Record<string, number>;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [weekStart, setWeekStart] = useState(startOfWeek(today));
  const [assignDate, setAssignDate] = useState<string | null>(null);

  const scheduledSet = useMemo(() => new Set(scheduledDates), [scheduledDates]);
  const crewsById = useMemo(
    () => new Map(crews.map((crew) => [crew.id, crew])),
    [crews]
  );
  const assignmentsByDate = useMemo(() => {
    const map = new Map<string, Tables<"assignments">[]>();
    for (const assignment of assignments) {
      const list = map.get(assignment.work_date) ?? [];
      list.push(assignment);
      map.set(assignment.work_date, list);
    }
    return map;
  }, [assignments]);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  async function handleUnassign(id: string) {
    await deleteAssignment(id, projectId);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setWeekStart((prev) => addDays(prev, -7))}
        >
          ← Prev week
        </Button>
        <span className="text-sm text-muted-foreground">
          {formatLabel(weekStart)} – {formatLabel(addDays(weekStart, 6))}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setWeekStart((prev) => addDays(prev, 7))}
        >
          Next week →
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {weekDays.map((date) => {
          const isScheduled = scheduledSet.has(date);
          const target = targetsByDate.get(date) ?? 0;
          const actual = dailyActuals[date] ?? 0;
          const dayAssignments = assignmentsByDate.get(date) ?? [];

          let status: { label: string; className: string } | null = null;
          if (isScheduled && target > 0) {
            if (actual >= target * 1.1) {
              status = { label: "Exceeded", className: "bg-success/20 text-success" };
            } else if (actual >= target) {
              status = { label: "Hit", className: "bg-success/20 text-success" };
            } else if (actual >= target * 0.7) {
              status = { label: "Close", className: "bg-primary/20 text-primary" };
            } else {
              status = { label: "Miss", className: "bg-destructive/20 text-destructive" };
            }
          }

          return (
            <div
              key={date}
              className={`flex flex-col gap-2 rounded-lg border p-3 ${
                isScheduled
                  ? "border-border bg-card"
                  : "border-dashed border-border bg-transparent opacity-60"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  {formatLabel(date)}
                  {date === today ? (
                    <span className="ml-1.5 text-xs text-primary">Today</span>
                  ) : null}
                </span>
                {!isScheduled ? (
                  <span className="text-xs text-muted-foreground">
                    Not scheduled
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    {target > 0 ? (
                      <span className="text-sm text-muted-foreground">
                        {actual} / {target}
                      </span>
                    ) : null}
                    {status ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
                      >
                        {status.label}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>

              {isScheduled ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {dayAssignments.map((assignment) => {
                      const crew = crewsById.get(assignment.crew_id ?? "");
                      return (
                        <span
                          key={assignment.id}
                          className="flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-xs text-foreground"
                        >
                          {crew?.name ?? "Unknown crew"}
                          <button
                            type="button"
                            aria-label="Unassign"
                            onClick={() => void handleUnassign(assignment.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setAssignDate(assignDate === date ? null : date)}
                      className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      + Assign crew
                    </button>
                  </div>
                  {assignDate === date ? (
                    <AssignCrewForm
                      projectId={projectId}
                      workDate={date}
                      crews={crews}
                      rows={rows}
                      phases={phases}
                      onDone={() => {
                        setAssignDate(null);
                        router.refresh();
                      }}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      {members.length === 0 && crews.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          Add a crew above before assigning work.
        </p>
      ) : null}
    </div>
  );
}
