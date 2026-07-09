import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { ProgressRing } from "@/components/ui/progress-meter";
import type { ProjectStageWithItems } from "@/lib/gates/shared";
import { STAGE_LABEL } from "@/lib/gates/shared";
import type { Tables } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

// Design pass v3 D3 — the Overview's health hero: one glance answers "how
// far along, which gate are we at, when is it due" (ring + stepper +
// facts) instead of three bare number tiles.

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StageDot({ stage }: { stage: ProjectStageWithItems }) {
  const state = stage.status;
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full ring-2 transition-colors",
          state === "complete" && "bg-foreground ring-foreground",
          state === "overridden" && "bg-warning ring-warning",
          state === "active" && "bg-surface ring-brand",
          state === "locked" && "bg-surface-sunken ring-border"
        )}
      >
        {state === "complete" ? (
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            aria-hidden
            className="text-primary-foreground"
          >
            <path
              d="M1.5 4.2 3.2 5.9 6.5 2.3"
              stroke="white"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        ) : state === "active" ? (
          <span className="size-1.5 rounded-full bg-brand" />
        ) : null}
      </span>
      <span
        className={cn(
          "max-w-full truncate text-[10px] font-medium leading-none",
          state === "active"
            ? "text-foreground"
            : state === "complete" || state === "overridden"
              ? "text-text-secondary"
              : "text-muted-foreground/60"
        )}
      >
        {STAGE_LABEL[stage.stage_key]}
      </span>
    </div>
  );
}

export function ProjectHealthHero({
  project,
  pct,
  rowCount,
  materialCount,
  stages,
}: {
  project: Tables<"projects">;
  pct: number; // 0–1
  rowCount: number;
  materialCount: number;
  stages: ProjectStageWithItems[];
}) {
  const activeStage = stages.find((s) => s.status === "active");
  return (
    <div
      data-testid="project-health-hero"
      className="rounded-xl border border-border bg-surface p-5 shadow-e1"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-5">
          <ProgressRing
            pct={Math.round(pct * 100)}
            size={104}
            strokeWidth={9}
            label="complete"
          />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-1 sm:gap-y-2 lg:grid-cols-2">
            <div>
              <dt className="type-overline text-muted-foreground">Status</dt>
              <dd className="mt-0.5">
                <ProjectStatusBadge status={project.status} />
              </dd>
            </div>
            <div>
              <dt className="type-overline text-muted-foreground">Deadline</dt>
              <dd className="num mt-0.5 text-sm font-medium text-foreground">
                {formatDate(project.deadline)}
              </dd>
            </div>
            <div>
              <dt className="type-overline text-muted-foreground">Rows</dt>
              <dd className="num type-stat mt-0.5 leading-none">{rowCount}</dd>
            </div>
            <div>
              <dt className="type-overline text-muted-foreground">Materials</dt>
              <dd className="num type-stat mt-0.5 leading-none">
                {materialCount}
              </dd>
            </div>
          </dl>
        </div>

        {stages.length > 0 ? (
          <div className="min-w-0 flex-1 sm:border-l sm:border-border-subtle sm:pl-5">
            <p className="type-overline mb-3 text-muted-foreground">
              Gates
              {activeStage ? (
                <span className="ml-2 normal-case tracking-normal text-foreground">
                  — now: {STAGE_LABEL[activeStage.stage_key]}
                </span>
              ) : null}
            </p>
            <div className="relative">
              <div
                aria-hidden
                className="absolute left-2 right-2 top-2 h-px -translate-y-1/2 bg-border"
              />
              <div className="relative flex gap-1 overflow-x-auto pb-1">
                {stages.map((stage) => (
                  <StageDot key={stage.id} stage={stage} />
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
