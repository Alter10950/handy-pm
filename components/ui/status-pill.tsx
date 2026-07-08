import { cn } from "@/lib/utils";

export type PillTone =
  "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const TONE_CLASS: Record<PillTone, string> = {
  neutral: "bg-muted text-text-secondary",
  brand: "bg-brand-subtle text-foreground",
  success: "bg-success-subtle text-success-fg",
  warning: "bg-warning-subtle text-warning-fg",
  danger: "bg-destructive-subtle text-destructive-fg",
  info: "bg-info-subtle text-info-fg",
};

// Status pills (Phase 11): subtle tinted backgrounds + readable -fg text,
// never solid color slabs. Optional leading dot for scannable lists.
export function StatusPill({
  tone = "neutral",
  dot = false,
  children,
  className,
  title,
}: {
  tone?: PillTone;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
        className
      )}
    >
      {dot ? (
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", {
            "bg-muted-foreground": tone === "neutral",
            "bg-brand": tone === "brand",
            "bg-success": tone === "success",
            "bg-warning": tone === "warning",
            "bg-destructive": tone === "danger",
            "bg-info": tone === "info",
          })}
        />
      ) : null}
      {children}
    </span>
  );
}
