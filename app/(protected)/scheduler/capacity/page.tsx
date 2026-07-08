import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { listCrews } from "@/lib/crews/queries";
import { getCapacityBoardData } from "@/lib/scheduler/capacity";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Capacity board — Handy PM",
};

export const dynamic = "force-dynamic";

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m, 0));
  return date.toISOString().slice(0, 10);
}

// Stable per-project chip colors, same simple hash idea as the crew
// calendar's project coloring.
const CHIP_CLASSES = [
  "bg-primary/20 text-foreground border-primary/40",
  "bg-success/15 text-foreground border-success/40",
  "bg-destructive/10 text-foreground border-destructive/30",
  "bg-muted text-foreground border-border",
  "bg-primary/10 text-foreground border-primary/20",
];
function chipClass(projectId: string): string {
  let hash = 0;
  for (const char of projectId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return CHIP_CLASSES[Math.abs(hash) % CHIP_CLASSES.length];
}

// The month view you look at before promising a customer a date
// (ADR-044): the "Committed" row is the capacity-consuming truth (one
// scheduled project-day = one crew-day), the crew lanes below show who's
// actually dispatched where, and anything red is a day that's been
// promised to more customers than there are crews.
export default async function CapacityBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();
  if (
    !profile?.org_id ||
    !["owner", "pm", "scheduler"].includes(profile.role)
  ) {
    redirect("/app");
  }

  const params = await searchParams;
  const month =
    params.month && /^\d{4}-\d{2}$/.test(params.month)
      ? params.month
      : new Date().toISOString().slice(0, 7);
  const monthStart = `${month}-01`;
  const monthEnd = lastDayOfMonth(month);

  const [board, crews] = await Promise.all([
    getCapacityBoardData(monthStart, monthEnd),
    listCrews(),
  ]);

  const assignmentsByCrewDate = new Map<
    string,
    { projectId: string; projectName: string }[]
  >();
  for (const a of board.assignments) {
    const key = `${a.crewId}:${a.workDate}`;
    const list = assignmentsByCrewDate.get(key) ?? [];
    list.push({ projectId: a.projectId, projectName: a.projectName });
    assignmentsByCrewDate.set(key, list);
  }

  const today = new Date().toISOString().slice(0, 10);
  const overCapacityDays = board.days.filter((d) => d.overCapacity).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Capacity board
          </h1>
          <p className="text-sm text-muted-foreground">
            {board.numCrews} crew{board.numCrews === 1 ? "" : "s"} of capacity —
            what&apos;s promised, to whom, and where the gaps are.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/scheduler/capacity?month=${shiftMonth(month, -1)}`}
            className="rounded-md border border-border px-2.5 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            ←
          </Link>
          <span className="min-w-36 text-center text-sm font-medium text-foreground">
            {monthLabel(month)}
          </span>
          <Link
            href={`/scheduler/capacity?month=${shiftMonth(month, 1)}`}
            className="rounded-md border border-border px-2.5 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            →
          </Link>
        </div>
      </div>

      {overCapacityDays > 0 ? (
        <p
          data-testid="over-capacity-summary"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {overCapacityDays} day{overCapacityDays === 1 ? "" : "s"} this month
          {overCapacityDays === 1 ? " is" : " are"} committed beyond{" "}
          {board.numCrews}-crew capacity.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table
          data-testid="capacity-board"
          className="w-full border-separate border-spacing-0 text-xs"
        >
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-28 border-b border-r border-border bg-muted p-2 text-left font-semibold text-muted-foreground">
                Lane
              </th>
              {board.days.map((day) => {
                const dayNum = Number(day.date.slice(8, 10));
                const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay();
                const isWeekend = weekday === 0 || weekday === 6;
                return (
                  <th
                    key={day.date}
                    data-testid={`capacity-day-${day.date}`}
                    className={cn(
                      "min-w-14 border-b border-border p-1.5 text-center font-semibold",
                      day.overCapacity
                        ? "bg-destructive/20 text-destructive"
                        : isWeekend
                          ? "bg-background text-muted-foreground/60"
                          : "bg-muted text-muted-foreground",
                      day.date === today ? "underline underline-offset-4" : ""
                    )}
                  >
                    {dayNum}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="sticky left-0 z-10 border-b border-r border-border bg-card p-2 font-medium text-foreground">
                Committed
                <div className="text-[10px] font-normal text-muted-foreground">
                  scheduled projects
                </div>
              </td>
              {board.days.map((day) => (
                <td
                  key={day.date}
                  className={cn(
                    "border-b border-border p-1 align-top",
                    day.overCapacity ? "bg-destructive/10" : ""
                  )}
                >
                  <div className="flex flex-col gap-0.5">
                    {day.scheduled.map((p) => (
                      <span
                        key={p.projectId}
                        title={p.projectName}
                        className={cn(
                          "truncate rounded border px-1 py-0.5 text-[10px] leading-tight",
                          chipClass(p.projectId)
                        )}
                      >
                        {p.projectName}
                      </span>
                    ))}
                  </div>
                </td>
              ))}
            </tr>
            {crews.map((crew) => (
              <tr key={crew.id}>
                <td className="sticky left-0 z-10 border-b border-r border-border bg-card p-2 font-medium text-foreground">
                  {crew.name}
                  <div className="text-[10px] font-normal text-muted-foreground">
                    {crew.size} {crew.size === 1 ? "person" : "people"}
                  </div>
                </td>
                {board.days.map((day) => {
                  const assigned =
                    assignmentsByCrewDate.get(`${crew.id}:${day.date}`) ?? [];
                  return (
                    <td
                      key={day.date}
                      className="border-b border-border p-1 align-top"
                    >
                      <div className="flex flex-col gap-0.5">
                        {assigned.map((p) => (
                          <span
                            key={p.projectId}
                            title={p.projectName}
                            className={cn(
                              "truncate rounded border px-1 py-0.5 text-[10px] leading-tight",
                              chipClass(p.projectId)
                            )}
                          >
                            {p.projectName}
                          </span>
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {crews.length === 0 ? (
              <tr>
                <td
                  colSpan={board.days.length + 1}
                  className="p-6 text-center text-sm text-muted-foreground"
                >
                  Add a crew on the Scheduler page first.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        &ldquo;Committed&rdquo; counts scheduled working days per project (each
        needs a crew that day); the crew lanes show actual assignments. A red
        day is promised to more customers than there are crews — fix the
        schedule, or an owner can override with a reason when committing dates.
      </p>
    </div>
  );
}
