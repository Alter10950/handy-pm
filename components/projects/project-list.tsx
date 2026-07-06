"use client";

import { useState } from "react";

import { ProjectCard } from "@/components/projects/project-card";
import type { Views } from "@/lib/supabase/database.types";

export function ProjectList({
  projects,
  pmLabelById,
  currentUserId,
}: {
  projects: Views<"project_progress">[];
  pmLabelById: Record<string, string>;
  currentUserId: string;
}) {
  const [myProjectsOnly, setMyProjectsOnly] = useState(false);
  const visible = myProjectsOnly
    ? projects.filter((project) => project.pm_user_id === currentUserId)
    : projects;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex w-fit items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={myProjectsOnly}
          onChange={(event) => setMyProjectsOnly(event.target.checked)}
          className="size-4 rounded border-border"
        />
        My projects only
      </label>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <p className="text-foreground">
            {myProjectsOnly
              ? "No projects assigned to you."
              : "No projects yet."}
          </p>
          {!myProjectsOnly ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first project to upload a layout drawing and start
              marking rows.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((project) => (
            <ProjectCard
              key={project.project_id}
              project={project}
              pmLabel={
                project.pm_user_id
                  ? (pmLabelById[project.pm_user_id] ?? null)
                  : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
