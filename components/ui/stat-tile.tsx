import { ProgressRing } from "@/components/ui/progress-meter";
import { Sparkline } from "@/components/ui/sparkline";
import { cn } from "@/lib/utils";

// KPI stat tile (Phase 11): overline label, big tabular number, optional
// delta chip and sparkline. Replaces the flat "ROWS 16" boxes everywhere.
export function StatTile({
  label,
  value,
  suffix,
  delta,
  deltaDirection = "flat",
  spark,
  ringPct,
  tone = "default",
  className,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  suffix?: string;
  delta?: string;
  deltaDirection?: "up" | "down" | "flat";
  /** up = good (green), down = bad (red) by default */
  spark?: number[];
  /** 0–100: renders a small donut ring beside the number (design pass v3) */
  ringPct?: number;
  tone?: "default" | "success" | "warning" | "danger";
  className?: string;
  testId?: string;
}) {
  const valueTone =
    tone === "success"
      ? "text-success-fg"
      : tone === "warning"
        ? "text-warning-fg"
        : tone === "danger"
          ? "text-destructive-fg"
          : "text-foreground";
  const deltaTone =
    deltaDirection === "up"
      ? "bg-success-subtle text-success-fg"
      : deltaDirection === "down"
        ? "bg-destructive-subtle text-destructive-fg"
        : "bg-muted text-muted-foreground";

  return (
    <div
      data-testid={testId}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-4 shadow-e1",
        className
      )}
    >
      <p className="type-overline text-muted-foreground">{label}</p>
      <div className="flex items-end justify-between gap-2">
        <p className={cn("type-stat leading-none", valueTone)}>
          {value}
          {suffix ? (
            <span className="type-body-sm ml-1 font-normal text-muted-foreground">
              {suffix}
            </span>
          ) : null}
        </p>
        {ringPct !== undefined ? (
          <ProgressRing pct={ringPct} size={44} strokeWidth={5} />
        ) : spark && spark.length > 1 ? (
          <Sparkline values={spark} />
        ) : null}
      </div>
      {delta ? (
        <span
          className={cn(
            "num w-fit rounded-full px-2 py-0.5 text-[11px] font-medium",
            deltaTone
          )}
        >
          {deltaDirection === "up"
            ? "▲ "
            : deltaDirection === "down"
              ? "▼ "
              : ""}
          {delta}
        </span>
      ) : null}
    </div>
  );
}
