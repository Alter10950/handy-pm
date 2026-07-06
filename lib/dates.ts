// Shared date-string (YYYY-MM-DD) math. `crew-calendar.tsx` and the
// scheduler calendar page each already had their own identical inline copy
// of this exact function before the estimating brain needed a third,
// server-side one — this is that shared home. The two existing client-side
// copies are left as they are (untouched, working code); nothing here
// changes their behavior.
export function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
