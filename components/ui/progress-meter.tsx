import { cn } from "@/lib/utils";

// Progress primitives (Phase 11): brand-yellow fill that turns green at
// 100%, tabular % labels. Bar for rows/tables, Ring for heroes.

function fillClass(pct: number): string {
  return pct >= 100 ? "bg-success" : "bg-brand";
}

export function ProgressBar({
  pct,
  showLabel = false,
  size = "md",
  className,
}: {
  /** 0–100 */
  pct: number;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const height = size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn(
          "flex-1 overflow-hidden rounded-full bg-surface-sunken",
          height
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            fillClass(clamped)
          )}
          style={{
            width: `${clamped}%`,
            transitionDuration: "var(--duration-slow)",
            transitionTimingFunction: "var(--easing-standard)",
          }}
        />
      </div>
      {showLabel ? (
        <span className="num type-body-sm shrink-0 font-medium text-muted-foreground">
          {clamped}%
        </span>
      ) : null}
    </div>
  );
}

export function ProgressRing({
  pct,
  size = 96,
  strokeWidth = 8,
  label,
  className,
}: {
  /** 0–100 */
  pct: number;
  size?: number;
  strokeWidth?: number;
  /** optional line under the % (e.g. "complete") */
  label?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (clamped / 100) * circumference;

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "relative inline-flex items-center justify-center",
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-surface-sunken"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          className={clamped >= 100 ? "stroke-success" : "stroke-brand"}
          style={{
            transition:
              "stroke-dasharray var(--duration-slow) var(--easing-standard)",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="num font-semibold text-foreground"
          style={{ fontSize: size * 0.22, lineHeight: 1 }}
        >
          {clamped}%
        </span>
        {label ? (
          <span className="type-caption mt-0.5 text-muted-foreground">
            {label}
          </span>
        ) : null}
      </div>
    </div>
  );
}
