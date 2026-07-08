import { cn } from "@/lib/utils";

// Designed empty state (Phase 11): icon, headline, one line, ONE primary
// CTA. Replaces the bare dashed boxes.
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  testId,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center",
        className
      )}
    >
      {icon ? (
        <div className="mb-1 flex size-11 items-center justify-center rounded-lg bg-surface-sunken text-muted-foreground [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <p className="type-title text-foreground">{title}</p>
      {description ? (
        <p className="type-body-sm max-w-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  retry,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  retry?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive-subtle/40 px-6 py-10 text-center",
        className
      )}
    >
      <p className="type-title text-destructive-fg">{title}</p>
      {description ? (
        <p className="type-body-sm max-w-sm text-text-secondary">
          {description}
        </p>
      ) : null}
      {retry ? <div className="mt-2">{retry}</div> : null}
    </div>
  );
}

// Skeleton loaders per surface — shimmerless (calm), token-driven.
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-surface-sunken", className)}
    />
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-e1">
      <Skeleton className="h-5 w-2/5" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3.5" />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1">
      <Skeleton className="h-9 rounded-none bg-surface-sunken" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-t border-border-subtle px-3 py-2.5">
          <Skeleton className="h-3.5 w-full" />
        </div>
      ))}
    </div>
  );
}
