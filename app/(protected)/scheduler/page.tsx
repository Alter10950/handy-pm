import type { Metadata } from "next";

import { CrewManager } from "@/components/scheduler/crew-manager";
import { SchedulerProjectList } from "@/components/scheduler/scheduler-project-list";
import { listCrewMembers, listCrews } from "@/lib/crews/queries";
import { listActiveProjectsForField } from "@/lib/field/queries";

export const metadata: Metadata = {
  title: "Scheduler — Handy PM",
};

export const dynamic = "force-dynamic";

export default async function SchedulerPage() {
  const [crews, projects] = await Promise.all([
    listCrews(),
    listActiveProjectsForField(),
  ]);
  const members = await listCrewMembers(crews.map((crew) => crew.id));

  return (
    <div className="flex flex-col gap-6">
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
