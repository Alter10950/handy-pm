// Presentational only — the parent owns the message state and the
// auto-dismiss timer, so one component doesn't need two sources of truth
// for "is a toast currently showing."
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-lg"
    >
      {message}
    </div>
  );
}
