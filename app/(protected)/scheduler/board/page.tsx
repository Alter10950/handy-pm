import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ScheduleBoard } from "@/components/scheduler/schedule-board";
import { PageHeader } from "@/components/ui/page-header";
import { listCrewMembers, listCrews } from "@/lib/crews/queries";
import { addDays, todayIso } from "@/lib/dates";
import { getOrgSettings } from "@/lib/org/queries";
import {
  listBlockersInRange,
  listBoardProjectMeta,
  listOrgAssignmentsInRange,
  listOrgScheduleInRange,
} from "@/lib/scheduler/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Schedule Board — Handy PM",
};

export const dynamic = "force-dynamic";

function startOfWeek(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() - date.getDay());
  return date.toISOString().slice(0, 10);
}

// The flagship scheduling surface (design pass v3 F1). The client board
// zooms week/month/quarter without refetching, so the horizon fetched
// here deliberately overshoots the widest zoom (91 days) on both sides.
export default async function SchedulerBoardPage({
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
  const today = todayIso();
  const windowStart = startOfWeek(start ?? today);
  const horizonStart = addDays(windowStart, -14);
  const horizonEnd = addDays(windowStart, 105);

  const [crews, projects, assignments, schedule, blockers, org] =
    await Promise.all([
      listCrews(),
      listBoardProjectMeta(),
      listOrgAssignmentsInRange(horizonStart, horizonEnd),
      listOrgScheduleInRange(horizonStart, horizonEnd),
      listBlockersInRange(horizonStart, horizonEnd),
      getOrgSettings(),
    ]);
  const members = await listCrewMembers(crews.map((crew) => crew.id));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        overline="Scheduler"
        title="Schedule board"
        description="Drag bars to move, grab an edge to stretch, drag across lanes to hand off between crews."
        actions={
          <Link
            href="/scheduler"
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground shadow-e1 transition-colors hover:bg-muted"
          >
            ← Scheduler
          </Link>
        }
      />
      <ScheduleBoard
        crews={crews}
        members={members}
        projects={projects}
        assignments={assignments}
        schedule={schedule}
        blockers={blockers}
        numCrews={org?.num_crews ?? 2}
        workingDays={org?.default_working_days ?? [1, 2, 3, 4, 5]}
        today={today}
        windowStart={windowStart}
      />
    </div>
  );
}
