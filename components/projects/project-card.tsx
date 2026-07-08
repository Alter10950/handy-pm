import { CalendarIcon, UserIcon } from "lucide-react";
import Link from "next/link";

import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { ProgressBar } from "@/components/ui/progress-meter";
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
      className="group flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-e1 transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      style={{ transitionDuration: "var(--duration-base)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold leading-snug text-foreground">
          {project.name}
        </h2>
        <ProjectStatusBadge status={project.status} />
      </div>

      <div className="flex items-center gap-3">
        <ProgressBar pct={pct} className="flex-1" />
        <span className="num text-sm font-medium text-text-secondary">
          {pct}%
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 text-[13px]">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <CalendarIcon aria-hidden className="size-3.5" />
          {formatDeadline(project.deadline)}
        </span>
        {pmLabel !== undefined ? (
          pmLabel ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <UserIcon aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{pmLabel}</span>
            </span>
          ) : (
            <span className="truncate font-medium text-warning-fg">
              No PM assigned
            </span>
          )
        ) : null}
      </div>
    </Link>
  );
}
