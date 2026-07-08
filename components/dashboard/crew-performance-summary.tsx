import type { DashboardCrewPerformance } from "@/lib/dashboard/queries";
import { cn } from "@/lib/utils";

const TIER_CLASS: Record<DashboardCrewPerformance["tier"], string> = {
  over: "bg-success/20 text-success-fg",
  normal: "bg-brand-subtle text-foreground",
  under: "bg-destructive/20 text-destructive",
  "no-data": "bg-muted text-muted-foreground",
};

const TIER_LABEL: Record<DashboardCrewPerformance["tier"], string> = {
  over: "Ahead of standard",
  normal: "At standard",
  under: "Behind standard",
  "no-data": "No data yet",
};

export function CrewPerformanceSummary({
  crews,
}: {
  crews: DashboardCrewPerformance[];
}) {
  if (crews.length === 0) {
    return <p className="text-sm text-muted-foreground">No crews yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {crews.map((crew) => (
        <li
          key={crew.crewId}
          className="flex items-center justify-between gap-2 text-sm"
        >
          <span className="text-foreground">{crew.crewName}</span>
          <span className="flex items-center gap-2">
            {crew.blendedRate !== null ? (
              <span className="text-xs text-muted-foreground">
                {crew.blendedRate.toFixed(2)}x ({crew.totalSamples} day
                {crew.totalSamples === 1 ? "" : "s"})
              </span>
            ) : null}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                TIER_CLASS[crew.tier]
              )}
            >
              {TIER_LABEL[crew.tier]}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
