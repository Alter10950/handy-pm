import { cn } from "@/lib/utils";

// The one page-title pattern every screen uses (Phase 11): overline
// section label, title row with optional status + actions, one-line
// description. Consistency beats novelty — screens differ in content,
// never in header anatomy.
export function PageHeader({
  overline,
  title,
  status,
  description,
  actions,
  className,
}: {
  overline?: string;
  title: React.ReactNode;
  status?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-6 gap-y-3",
        className
      )}
    >
      <div className="min-w-0">
        {overline ? (
          <p className="type-overline text-muted-foreground">{overline}</p>
        ) : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-3">
          <h1 className="type-h1 text-foreground">{title}</h1>
          {status}
        </div>
        {description ? (
          <p className="type-body mt-1 max-w-2xl text-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

// Section-level variant for in-page groupings.
export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2",
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="type-h3 text-foreground">{title}</h2>
        {description ? (
          <p className="type-body-sm mt-0.5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
