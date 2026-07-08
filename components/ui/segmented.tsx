"use client";

import { cn } from "@/lib/utils";

// Segmented control (Phase 11): single- or multi-select option row on a
// sunken track — replaces ad-hoc button groups and the all-yellow day
// toggles. Active segment = raised white chip with a hairline, NOT a
// yellow slab.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  ariaLabel,
  className,
}: {
  options: { value: T; label: React.ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5",
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-md font-medium transition-colors disabled:opacity-50",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active
                ? "border border-border bg-surface text-foreground shadow-e1"
                : "border border-transparent text-muted-foreground hover:text-foreground"
            )}
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// Multi-select variant (e.g. working days).
export function SegmentedMulti<T extends string>({
  options,
  values,
  onToggle,
  size = "md",
  ariaLabel,
  className,
}: {
  options: { value: T; label: React.ReactNode; disabled?: boolean }[];
  values: readonly T[];
  onToggle: (value: T) => void;
  size?: "sm" | "md";
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5",
        className
      )}
    >
      {options.map((option) => {
        const active = values.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={option.disabled}
            onClick={() => onToggle(option.value)}
            className={cn(
              "rounded-md font-medium transition-colors disabled:opacity-50",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active
                ? "border border-border bg-surface text-foreground shadow-e1"
                : "border border-transparent text-muted-foreground hover:text-foreground"
            )}
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
