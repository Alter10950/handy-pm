import Link from "next/link";

import type { OrgNextActionsSummary } from "@/lib/gates/queries";

// Read-only — nothing to mutate here (unlike the blocker/shortage
// lists), so this stays a Server Component: just links into each
// project's own Overview, where the real lifecycle actions live.
export function LifecycleAttentionList({
  summaries,
}: {
  summaries: OrgNextActionsSummary[];
}) {
  if (summaries.length === 0) {
    return (
      <p
        data-testid="lifecycle-attention-list"
        className="text-sm text-muted-foreground"
      >
        Every active project has fresh activity and nothing overdue.
      </p>
    );
  }

  return (
    <ul data-testid="lifecycle-attention-list" className="flex flex-col gap-2">
      {summaries.map((summary) => {
        const overdueCount = summary.actions.filter((a) => a.isOverdue).length;
        return (
          <li
            key={summary.projectId}
            className="rounded-md border border-border bg-background p-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href={`/app/project/${summary.projectId}`}
                className="text-sm font-medium text-foreground hover:underline"
              >
                {summary.projectName}
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                {summary.isStalled ? (
                  <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
                    Stalled {summary.daysSinceActivity}d
                  </span>
                ) : null}
                {overdueCount > 0 ? (
                  <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
                    {overdueCount} overdue
                  </span>
                ) : null}
              </div>
            </div>
            {summary.actions.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-0.5">
                {summary.actions.slice(0, 3).map((action) => (
                  <li
                    key={action.itemId}
                    className="truncate text-xs text-muted-foreground"
                  >
                    {action.label}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
