"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  checkDoubleBooking,
  createAssignment,
  deleteAssignment,
  moveAssignment,
} from "@/lib/scheduler/actions";
import type { OrgAssignment } from "@/lib/scheduler/queries";
import type { Tables, Views } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

const PROJECT_DATA_TYPE = "application/x-handy-pm-project";
const ASSIGNMENT_DATA_TYPE = "application/x-handy-pm-assignment";

function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDay(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// A small, fixed color palette keyed by project id (stable across
// re-renders/reloads, since it hashes the id) — good enough to visually
// tell projects apart on the calendar without a dedicated "project
// color" column.
const CHIP_COLORS = [
  "bg-brand-subtle text-foreground border-brand/40",
  "bg-blue-500/20 text-blue-400 border-blue-500/40",
  "bg-purple-500/20 text-purple-400 border-purple-500/40",
  "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
  "bg-orange-500/20 text-orange-400 border-orange-500/40",
  "bg-pink-500/20 text-pink-400 border-pink-500/40",
];
function colorForProject(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i += 1) {
    hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  }
  return CHIP_COLORS[hash % CHIP_COLORS.length];
}

export function CrewCalendar({
  crews,
  projects,
  assignments,
  weekStart,
  laborLoadByProject,
}: {
  crews: Tables<"crews">[];
  projects: Views<"project_progress">[];
  assignments: OrgAssignment[];
  weekStart: string;
  laborLoadByProject: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const projectNameById = useMemo(
    () => new Map(projects.map((p) => [p.project_id, p.name])),
    [projects]
  );

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const assignmentsByCrewDay = useMemo(() => {
    const map = new Map<string, OrgAssignment[]>();
    for (const a of assignments) {
      const key = `${a.crewId}:${a.workDate}`;
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return map;
  }, [assignments]);

  // How many distinct crews share each (project, day) — used to split
  // that project's daily labor load evenly across them, same "no rule
  // specified, split evenly" reasoning as ADR-022's target generation.
  const crewCountByProjectDay = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const a of assignments) {
      const key = `${a.projectId}:${a.workDate}`;
      const set = map.get(key) ?? new Set<string>();
      set.add(a.crewId);
      map.set(key, set);
    }
    return map;
  }, [assignments]);

  function plannedUnitsFor(crewAssignments: OrgAssignment[]): number {
    return crewAssignments.reduce((sum, a) => {
      const dailyLoad = laborLoadByProject[a.projectId] ?? 0;
      const sharedBy = crewCountByProjectDay.get(`${a.projectId}:${a.workDate}`)?.size ?? 1;
      return sum + dailyLoad / Math.max(1, sharedBy);
    }, 0);
  }

  async function assignOrMove(
    source: { projectId: string } | { assignmentId: string },
    crewId: string,
    workDate: string
  ) {
    const excludeId = "assignmentId" in source ? source.assignmentId : undefined;
    const hits = await checkDoubleBooking(crewId, workDate, excludeId);
    if (hits.length > 0) {
      const names = hits.map((h) => h.projectName).join(", ");
      const crewName = crews.find((c) => c.id === crewId)?.name ?? "This crew";
      const confirmed = window.confirm(
        `${crewName} is already assigned to ${names} on ${workDate}. Assign them here too?`
      );
      if (!confirmed) return;
    }

    setPending(true);
    setActionError(null);
    try {
      if ("projectId" in source) {
        await createAssignment(source.projectId, crewId, workDate, null);
      } else {
        await moveAssignment(source.assignmentId, crewId, workDate);
      }
      router.refresh();
    } catch (err) {
      // The dispatch gate (ADR-042) rejects server-side while a project's
      // Mobilize stage is locked — a dropped chip must explain itself, not
      // silently snap back.
      setActionError(err instanceof Error ? err.message : "Could not assign crew.");
    } finally {
      setPending(false);
    }
  }

  async function handleDrop(event: React.DragEvent, crewId: string, workDate: string) {
    event.preventDefault();
    setDragOverCell(null);
    const projectId = event.dataTransfer.getData(PROJECT_DATA_TYPE);
    const assignmentId = event.dataTransfer.getData(ASSIGNMENT_DATA_TYPE);
    if (projectId) {
      await assignOrMove({ projectId }, crewId, workDate);
    } else if (assignmentId) {
      await assignOrMove({ assignmentId }, crewId, workDate);
    }
  }

  async function handleRemove(assignment: OrgAssignment) {
    setPending(true);
    try {
      await deleteAssignment(assignment.id, assignment.projectId);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex-1">
        {actionError ? (
          <p
            data-testid="calendar-action-error"
            className="mb-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {actionError}
          </p>
        ) : null}
        <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-32 border-b border-r border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                Crew
              </th>
              {days.map((day) => (
                <th
                  key={day}
                  className="min-w-40 border-b border-border bg-muted p-2 text-left font-semibold text-muted-foreground"
                >
                  {formatDay(day)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {crews.map((crew) => (
              <tr key={crew.id}>
                <td className="sticky left-0 z-10 border-b border-r border-border bg-card p-2 font-medium text-foreground">
                  {crew.name}
                  <div className="text-xs font-normal text-muted-foreground">
                    {crew.size} {crew.size === 1 ? "person" : "people"}
                  </div>
                </td>
                {days.map((day) => {
                  const key = `${crew.id}:${day}`;
                  const cellAssignments = assignmentsByCrewDay.get(key) ?? [];
                  const plannedUnits = plannedUnitsFor(cellAssignments);
                  const capacityHours = crew.size * 8;
                  const overCapacity = plannedUnits > capacityHours;
                  return (
                    <td
                      key={day}
                      data-testid={`calendar-cell-${crew.id}-${day}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragOverCell(key);
                      }}
                      onDragLeave={() =>
                        setDragOverCell((current) => (current === key ? null : current))
                      }
                      onDrop={(event) => void handleDrop(event, crew.id, day)}
                      className={cn(
                        "border-b border-border p-2 align-top",
                        dragOverCell === key && "bg-primary/10"
                      )}
                    >
                      <div className="flex min-h-12 flex-col gap-1">
                        {cellAssignments.map((a) => (
                          <div
                            key={a.id}
                            draggable={a.rowId === null}
                            onDragStart={(event) => {
                              event.dataTransfer.setData(ASSIGNMENT_DATA_TYPE, a.id);
                            }}
                            title={
                              a.rowId !== null
                                ? "Row/phase-scoped — reassign from the project's own schedule page"
                                : "Drag to reassign"
                            }
                            className={cn(
                              "flex items-center justify-between gap-1 rounded-md border px-1.5 py-1 text-xs",
                              colorForProject(a.projectId),
                              a.rowId === null ? "cursor-grab" : "cursor-default opacity-90"
                            )}
                          >
                            <span className="truncate">
                              {projectNameById.get(a.projectId) ?? a.projectName}
                              {a.rowId !== null ? " (partial)" : ""}
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove ${a.projectName} assignment`}
                              disabled={pending}
                              onClick={() => void handleRemove(a)}
                              className="shrink-0 opacity-70 hover:opacity-100"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                      {cellAssignments.length > 0 ? (
                        <p
                          className={cn(
                            "mt-1 text-[11px]",
                            overCapacity ? "text-destructive" : "text-muted-foreground"
                          )}
                        >
                          {plannedUnits.toFixed(1)} / {capacityHours}h planned
                          {overCapacity ? " ⚠" : ""}
                        </p>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
            {crews.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="p-6 text-center text-sm text-muted-foreground"
                >
                  Add a crew on the Scheduler page first.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        </div>
      </div>

      <div className="flex w-full flex-col gap-2 lg:w-56">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Active projects
        </h2>
        <p className="text-xs text-muted-foreground">
          Drag a project onto a crew&apos;s day to assign the whole project.
        </p>
        {projects.map((project) => (
          <div
            key={project.project_id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(PROJECT_DATA_TYPE, project.project_id);
            }}
            className={cn(
              "cursor-grab rounded-md border px-2 py-1.5 text-sm",
              colorForProject(project.project_id)
            )}
          >
            {project.name}
          </div>
        ))}
      </div>
    </div>
  );
}
