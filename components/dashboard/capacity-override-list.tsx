import Link from "next/link";

import type { CapacityOverrideSummary } from "@/lib/scheduler/capacity";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// Owner capacity overrides, org-wide — the counterpart to GateOverrideList
// for the crew-capacity hard limit (ADR-044): who double-booked the
// crews, why, and on which days.
export function CapacityOverrideList({
  overrides,
}: {
  overrides: CapacityOverrideSummary[];
}) {
  if (overrides.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No capacity overrides — every committed schedule fits the crews the org
        actually has.
      </p>
    );
  }

  return (
    <ul data-testid="capacity-override-list" className="flex flex-col gap-2">
      {overrides.map((override, i) => (
        <li
          key={`${override.projectId}-${i}`}
          className="flex flex-col gap-0.5 rounded-md border border-border p-2.5 text-sm"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Link
              href={`/app/project/${override.projectId}`}
              className="font-medium text-foreground hover:underline"
            >
              {override.projectName}
            </Link>
            <span className="text-xs text-muted-foreground">
              {override.conflictDates.length} day
              {override.conflictDates.length === 1 ? "" : "s"} over ·{" "}
              {formatDate(override.createdAt)}
              {override.createdByName ? ` · ${override.createdByName}` : ""}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            &ldquo;{override.reason}&rdquo;
          </p>
        </li>
      ))}
    </ul>
  );
}
