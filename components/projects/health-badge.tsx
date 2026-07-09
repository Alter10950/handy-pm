import type { ProjectHealth } from "@/lib/dashboard/health";
import { cn } from "@/lib/utils";

const TIER_CLASS: Record<ProjectHealth["tier"], string> = {
  green: "bg-success",
  amber: "bg-warning",
  red: "bg-destructive",
};

const TIER_LABEL: Record<ProjectHealth["tier"], string> = {
  green: "On track",
  amber: "Watch",
  red: "At risk",
};

/** Green/amber/red health dot (design pass v3 F2) — tooltip carries the
 * explainable reasons (SPI, shortages, overridden gates). */
export function HealthBadge({
  health,
  showLabel = false,
}: {
  health: ProjectHealth;
  showLabel?: boolean;
}) {
  return (
    <span
      data-testid="health-badge"
      data-tier={health.tier}
      title={`${TIER_LABEL[health.tier]} — ${health.reasons.join("; ")}`}
      className="inline-flex items-center gap-1.5"
    >
      <span
        aria-hidden
        className={cn(
          "size-2.5 shrink-0 rounded-full ring-2 ring-surface",
          TIER_CLASS[health.tier]
        )}
      />
      <span className="sr-only">{TIER_LABEL[health.tier]}</span>
      {showLabel ? (
        <span className="text-xs font-medium text-muted-foreground">
          {TIER_LABEL[health.tier]}
        </span>
      ) : null}
    </span>
  );
}
