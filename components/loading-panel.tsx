// Shared content for every route's loading.tsx — a plain spinner + label
// rather than a bespoke skeleton per route. Next.js only shows this while
// the route's Server Component is still awaiting its data (several routes
// in this app fire 5-10+ parallel queries before their first paint), so
// even a simple one beats the blank screen there was before.
export function LoadingPanel({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center py-24">
      <div className="flex items-center gap-3 text-muted-foreground">
        <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}
