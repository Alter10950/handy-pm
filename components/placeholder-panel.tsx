export function PlaceholderPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card shadow-e1 p-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        {title}
      </h1>
      <p className="text-muted-foreground">{description}</p>
      {children}
    </div>
  );
}
