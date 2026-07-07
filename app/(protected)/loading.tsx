// Segment-level loading state for every protected screen — server pages
// here are all force-dynamic, so slow connections otherwise stare at the
// previous page during navigation. One shared skeleton beats per-route
// spinners; keep it minimal and theme-correct.
export default function ProtectedLoading() {
  return (
    <div className="flex flex-col gap-4 p-1" aria-busy="true" aria-live="polite">
      <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
      <div className="h-32 animate-pulse rounded-lg border border-border bg-card" />
      <div className="h-64 animate-pulse rounded-lg border border-border bg-card" />
    </div>
  );
}
