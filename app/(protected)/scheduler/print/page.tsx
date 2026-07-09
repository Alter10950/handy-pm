import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PrintButton } from "@/components/scheduler/print-button";
import { listCrewMembers, listCrews } from "@/lib/crews/queries";
import { addDays, todayIso } from "@/lib/dates";
import { listOrgAssignmentsInRange } from "@/lib/scheduler/queries";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Weekly Crew Schedule — Handy PM",
};

export const dynamic = "force-dynamic";

function startOfWeek(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() - date.getDay());
  return date.toISOString().slice(0, 10);
}

function formatDay(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Print/PDF weekly crew schedule (design pass v3 F1) — the sheet a PM
// hands each foreman on Monday. Always light (print surface, ADR-048);
// the app chrome hides itself via print: classes in AppShell.
export default async function SchedulerPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
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

  const { start } = await searchParams;
  const weekStart = startOfWeek(start ?? todayIso());
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const [crews, assignments] = await Promise.all([
    listCrews(),
    listOrgAssignmentsInRange(weekStart, days[6]),
  ]);
  const members = await listCrewMembers(crews.map((crew) => crew.id));

  const byCrewDay = new Map<string, string[]>();
  for (const a of assignments) {
    const key = `${a.crewId}:${a.workDate}`;
    const list = byCrewDay.get(key) ?? [];
    if (!list.includes(a.projectName)) {
      list.push(a.projectName + (a.rowId !== null ? " (partial)" : ""));
    }
    byCrewDay.set(key, list);
  }
  const membersByCrew = new Map<string, string[]>();
  for (const m of members) {
    const list = membersByCrew.get(m.crew_id) ?? [];
    list.push(m.name);
    membersByCrew.set(m.crew_id, list);
  }

  return (
    <div className="force-light mx-auto flex max-w-4xl flex-col gap-4 bg-white p-2 text-foreground print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/scheduler/board?start=${weekStart}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Schedule board
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/scheduler/print?start=${addDays(weekStart, -7)}`}
            className="rounded-lg border border-border bg-surface px-2.5 py-1 text-sm text-foreground shadow-e1 hover:bg-muted"
          >
            ← Prev week
          </Link>
          <Link
            href={`/scheduler/print?start=${addDays(weekStart, 7)}`}
            className="rounded-lg border border-border bg-surface px-2.5 py-1 text-sm text-foreground shadow-e1 hover:bg-muted"
          >
            Next week →
          </Link>
          <PrintButton />
        </div>
      </div>

      <header className="border-b-2 border-foreground pb-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Handy Equip
        </p>
        <h1 className="type-h1 text-xl">Weekly crew schedule</h1>
        <p className="num text-sm text-muted-foreground">
          {formatDay(weekStart)} – {formatDay(days[6])}
        </p>
      </header>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border border-border bg-surface-sunken p-2 text-left align-top">
              Crew
            </th>
            {days.map((day) => (
              <th
                key={day}
                className="border border-border bg-surface-sunken p-2 text-left align-top text-xs"
              >
                {formatDay(day)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {crews.map((crew) => (
            <tr key={crew.id}>
              <td className="border border-border p-2 align-top">
                <p className="font-semibold">{crew.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {(membersByCrew.get(crew.id) ?? []).join(", ") ||
                    `${crew.size} ${crew.size === 1 ? "person" : "people"}`}
                </p>
              </td>
              {days.map((day) => {
                const items = byCrewDay.get(`${crew.id}:${day}`) ?? [];
                return (
                  <td
                    key={day}
                    className={cn(
                      "border border-border p-2 align-top text-xs",
                      items.length === 0 && "text-muted-foreground/50"
                    )}
                  >
                    {items.length > 0
                      ? items.map((name) => <p key={name}>{name}</p>)
                      : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
          {crews.length === 0 ? (
            <tr>
              <td
                colSpan={8}
                className="border border-border p-6 text-center text-sm text-muted-foreground"
              >
                No crews yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <p className="text-xs text-muted-foreground">
        Printed from Handy PM · schedule as of {todayIso()}
      </p>
    </div>
  );
}
