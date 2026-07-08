"use client";

import { cn } from "@/lib/utils";

// Canvas/workspace toolbar chrome (Phase 11): a floating raised strip of
// icon actions with dividers — consistent home for zoom/fit/undo/redo/
// auto-rows on the Layout stage and any future canvas.
export function Toolbar({
  children,
  className,
  ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  ariaLabel: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className={cn(
        "flex items-center gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-e3",
        className
      )}
    >
      {children}
    </div>
  );
}

export function ToolbarButton({
  label,
  onClick,
  active = false,
  disabled = false,
  children,
  className,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-sm font-medium transition-colors disabled:opacity-40",
        active
          ? "bg-brand-subtle text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
        className
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      {children}
    </button>
  );
}

export function ToolbarDivider() {
  return <div aria-hidden className="mx-0.5 h-5 w-px bg-border" />;
}
