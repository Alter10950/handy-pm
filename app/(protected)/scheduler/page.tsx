import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CrewManager } from "@/components/scheduler/crew-manager";
import { SchedulerProjectList } from "@/components/scheduler/scheduler-project-list";
import { listCrewMembers, listCrews } from "@/lib/crews/queries";
import { listActiveProjectsForField } from "@/lib/field/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Scheduler — Handy PM",
};

export const dynamic = "force-dynamic";

// Scheduler is an office tool — crew's equivalent view is "My assignments
// today" in Field. Gating the whole page (not just individual buttons
// inside it) is simpler and more correct than trying to hide every
// mutating control in CrewManager/ScheduleBuilder/AssignCrewForm
// individually, and matches how /app/team and /app/settings are already
// gated.
export default async function SchedulerPage() {
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

  const [crews, projects] = await Promise.all([
    listCrews(),
    listActiveProjectsForField(),
  ]);
  const members = await listCrewMembers(crews.map((crew) => crew.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">Scheduler</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/scheduler/capacity"
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            📊 Capacity Board
          </Link>
          <Link
            href="/scheduler/calendar"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            📅 Crew Calendar
          </Link>
        </div>
      </div>
      <div>
        <h2 className="mb-3 text-lg font-semibold text-foreground">Crews</h2>
        <CrewManager crews={crews} members={members} />
      </div>
      <div>
        <h2 className="mb-3 text-lg font-semibold text-foreground">
          Schedule a project
        </h2>
        <SchedulerProjectList projects={projects} />
      </div>
    </div>
  );
}
