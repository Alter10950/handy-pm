import Link from "next/link";

import { STAGE_LABEL } from "@/lib/gates/shared";
import type { StageOverrideSummary } from "@/lib/gates/queries";
import type { GateStageKey } from "@/lib/supabase/database.types";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// Every gate that was overridden rather than completed, org-wide — the
// override is the accountable escape hatch, and this list is what keeps
// it accountable: who skipped which gate, why, on which job, in one
// place instead of buried per-project (ADR-042).
export function GateOverrideList({
  overrides,
}: {
  overrides: StageOverrideSummary[];
}) {
  if (overrides.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No overridden gates — every completed stage earned it.
      </p>
    );
  }

  return (
    <ul data-testid="gate-override-list" className="flex flex-col gap-2">
      {overrides.map((override) => (
        <li
          key={`${override.projectId}-${override.stageKey}`}
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
              {STAGE_LABEL[override.stageKey as GateStageKey] ??
                override.stageKey}{" "}
              · {formatDate(override.overriddenAt)}
              {override.overriddenByName
                ? ` · ${override.overriddenByName}`
                : ""}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            &ldquo;{override.overrideReason}&rdquo;
          </p>
        </li>
      ))}
    </ul>
  );
}
