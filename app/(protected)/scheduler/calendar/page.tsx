import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CrewCalendar } from "@/components/scheduler/crew-calendar";
import { listCrews } from "@/lib/crews/queries";
import { listActiveProjectsForField } from "@/lib/field/queries";
import {
  getProjectDailyLaborLoad,
  listOrgAssignmentsInRange,
} from "@/lib/scheduler/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Crew Calendar — Handy PM",
};

export const dynamic = "force-dynamic";

function startOfWeek(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() - date.getDay());
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function SchedulerCalendarPage({
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
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = startOfWeek(start ?? today);
  const weekEnd = addDays(weekStart, 6);

  const [crews, projects, assignments] = await Promise.all([
    listCrews(),
    listActiveProjectsForField(),
    listOrgAssignmentsInRange(weekStart, weekEnd),
  ]);

  const projectIdsInView = [...new Set(assignments.map((a) => a.projectId))];
  const laborLoadEntries = await Promise.all(
    projectIdsInView.map(
      async (id) => [id, await getProjectDailyLaborLoad(id)] as const
    )
  );
  const laborLoadByProject = Object.fromEntries(laborLoadEntries);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">Crew Calendar</h1>
        <Link href="/scheduler" className="text-sm text-muted-foreground">
          ← Scheduler
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <Link
          href={`/scheduler/calendar?start=${addDays(weekStart, -7)}`}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-accent"
        >
          ← Prev week
        </Link>
        <span className="text-sm text-muted-foreground">
          {weekStart} – {weekEnd}
        </span>
        <Link
          href={`/scheduler/calendar?start=${addDays(weekStart, 7)}`}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-accent"
        >
          Next week →
        </Link>
      </div>

      <CrewCalendar
        crews={crews}
        projects={projects}
        assignments={assignments}
        weekStart={weekStart}
        laborLoadByProject={laborLoadByProject}
      />
    </div>
  );
}
