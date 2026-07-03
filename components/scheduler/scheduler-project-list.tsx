import Link from "next/link";

import type { Views } from "@/lib/supabase/database.types";

export function SchedulerProjectList({
  projects,
}: {
  projects: Views<"project_progress">[];
}) {
  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-muted-foreground">
        No active projects yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {projects.map((project) => (
        <Link
          key={project.project_id}
          href={`/scheduler/${project.project_id}`}
          className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 hover:bg-accent"
        >
          <span className="font-medium text-foreground">{project.name}</span>
          <span className="text-sm text-muted-foreground">
            {Math.round(project.pct * 100)}%
          </span>
        </Link>
      ))}
    </div>
  );
}
