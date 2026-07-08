"use client";

import Link from "next/link";
import { useMemo } from "react";

import { useCrewSelection } from "@/components/field/use-crew-selection";
import { ProgressBar } from "@/components/ui/progress-meter";
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
          ? "flex items-center justify-between gap-2 rounded-xl border-2 border-brand bg-brand-subtle p-4 shadow-e1 active:bg-brand-subtle/70"
          : "flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-e1 active:bg-accent"
      }
    >
      <div className="flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">{project.name}</span>
          <span className="num text-sm text-muted-foreground">{pct}%</span>
        </div>
        {project.site_address ? (
          <span className="text-sm text-muted-foreground">
            {project.site_address}
          </span>
        ) : null}
        <ProgressBar pct={pct} className="mt-2" />
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
      <div>
        <p className="type-overline text-muted-foreground">Handy Equip</p>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Field
        </h1>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow-e1">
        <label
          className="shrink-0 text-sm text-muted-foreground"
          htmlFor="home-crew-select"
        >
          Logging as
        </label>
        <select
          id="home-crew-select"
          value={crewId ?? ""}
          onChange={(event) => setCrewId(event.target.value || null)}
          className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-base text-foreground"
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
