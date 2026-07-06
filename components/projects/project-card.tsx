import Link from "next/link";

import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import type { Views } from "@/lib/supabase/database.types";

function formatDeadline(deadline: string | null): string {
  if (!deadline) return "No deadline";
  return new Date(`${deadline}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ProjectCard({
  project,
  pmLabel,
}: {
  project: Views<"project_progress">;
  // undefined: don't show a PM row at all (the pre-sale estimates list —
  // a PM isn't expected yet there). null: show the "No PM assigned"
  // warning (the real, active projects list — Batch 4 Sub-phase B).
  pmLabel?: string | null;
}) {
  const pct = Math.round(project.pct * 100);

  return (
    <Link
      href={`/app/project/${project.project_id}`}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/60"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          {project.name}
        </h2>
        <ProjectStatusBadge status={project.status} />
      </div>

      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-sm font-medium tabular-nums text-muted-foreground">
          {pct}%
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {formatDeadline(project.deadline)}
        </p>
        {pmLabel !== undefined ? (
          <p
            className={
              pmLabel
                ? "truncate text-sm text-muted-foreground"
                : "truncate text-sm font-medium text-warning"
            }
          >
            {pmLabel ? `PM: ${pmLabel}` : "No PM assigned"}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
