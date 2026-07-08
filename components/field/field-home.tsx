"use client";

import Link from "next/link";
import { useMemo } from "react";

import { useCrewSelection } from "@/components/field/use-crew-selection";
import type { TodayAssignment } from "@/lib/field/queries";
import type { Tables, Views } from "@/lib/supabase/database.types";

function ProjectLink({
  project,
  highlighted,
}: {
  project: Views<"project_progress">;
  highlighted: boolean;
}) {
  const pct = Math.round(project.pct * 100);
  return (
    <Link
      href={`/field/${project.project_id}`}
      className={
        highlighted
          ? "flex items-center justify-between gap-2 rounded-lg border border-primary bg-primary/10 p-4 active:bg-primary/20"
          : "flex flex-col gap-2 rounded-lg border border-border bg-card shadow-e1 p-4 active:bg-accent"
      }
    >
      <div className="flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">{project.name}</span>
          <span className="text-sm text-muted-foreground">{pct}%</span>
        </div>
        {project.site_address ? (
          <span className="text-sm text-muted-foreground">
            {project.site_address}
          </span>
        ) : null}
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-background">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </Link>
  );
}

export function FieldHome({
  projects,
  todayAssignments,
  crews,
  myCrewId,
}: {
  projects: Views<"project_progress">[];
  todayAssignments: TodayAssignment[];
  crews: Tables<"crews">[];
  myCrewId: string | null;
}) {
  const [crewId, setCrewId] = useCrewSelection(myCrewId);

  const { assigned, rest } = useMemo(() => {
    if (!crewId) return { assigned: [], rest: projects };
    const assignedProjectIds = new Set(
      todayAssignments
        .filter((a) => a.crewId === crewId)
        .map((a) => a.projectId)
    );
    return {
      assigned: projects.filter((p) => assignedProjectIds.has(p.project_id)),
      rest: projects.filter((p) => !assignedProjectIds.has(p.project_id)),
    };
  }, [crewId, todayAssignments, projects]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold text-foreground">Field</h1>

      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground" htmlFor="home-crew-select">
          Logging as
        </label>
        <select
          id="home-crew-select"
          value={crewId ?? ""}
          onChange={(event) => setCrewId(event.target.value || null)}
          className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        >
          <option value="">No crew selected</option>
          {crews.map((crew) => (
            <option key={crew.id} value={crew.id}>
              {crew.name}
            </option>
          ))}
        </select>
      </div>

      {assigned.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            My assignments today
          </h2>
          {assigned.map((project) => (
            <ProjectLink key={project.project_id} project={project} highlighted />
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {assigned.length > 0 ? (
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            All active projects
          </h2>
        ) : null}
        {rest.length === 0 && assigned.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-muted-foreground">
            No active projects yet.
          </div>
        ) : (
          rest.map((project) => (
            <ProjectLink
              key={project.project_id}
              project={project}
              highlighted={false}
            />
          ))
        )}
      </div>
    </div>
  );
}
