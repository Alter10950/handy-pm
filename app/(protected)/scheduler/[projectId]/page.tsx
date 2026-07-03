import { notFound } from "next/navigation";

import { SchedulerWorkspace } from "@/components/scheduler/scheduler-workspace";
import { listCrewMembers, listCrews } from "@/lib/crews/queries";
import { listPhases } from "@/lib/phases/queries";
import { getProject, listRowProgress } from "@/lib/projects/queries";
import {
  getDailyActuals,
  getProjectWithSchedule,
  listAssignments,
  listProjectSchedule,
  listRemainingByMaterial,
  listTargets,
} from "@/lib/scheduler/queries";

export const dynamic = "force-dynamic";

export default async function SchedulerProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const [
    progress,
    rows,
    phases,
    crews,
    assignments,
    schedule,
    targets,
    remaining,
    dailyActuals,
  ] = await Promise.all([
    getProjectWithSchedule(projectId),
    listRowProgress(projectId),
    listPhases(projectId),
    listCrews(),
    listAssignments(projectId),
    listProjectSchedule(projectId),
    listTargets(projectId),
    listRemainingByMaterial(projectId),
    getDailyActuals(projectId),
  ]);
  const members = await listCrewMembers(crews.map((crew) => crew.id));

  return (
    <SchedulerWorkspace
      project={project}
      progress={progress}
      rows={rows}
      phases={phases}
      crews={crews}
      members={members}
      assignments={assignments}
      schedule={schedule}
      targets={targets}
      remaining={remaining}
      dailyActuals={Object.fromEntries(dailyActuals)}
    />
  );
}
