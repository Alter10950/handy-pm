import { notFound, redirect } from "next/navigation";

import { SchedulerWorkspace } from "@/components/scheduler/scheduler-workspace";
import { listCrewMembers, listCrews } from "@/lib/crews/queries";
import { isProjectClearedForInstall } from "@/lib/gates/queries";
import { getMaterialsReadiness } from "@/lib/materials/queries";
import { listPhases } from "@/lib/phases/queries";
import { getProject, listRowProgress } from "@/lib/projects/queries";
import {
  getCrewDailyActuals,
  getDailyActuals,
  getPhaseTimelines,
  getProjectWithSchedule,
  listAssignments,
  listProjectSchedule,
  listRemainingByMaterial,
  listTargets,
} from "@/lib/scheduler/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SchedulerProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
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
    crewDailyActuals,
    phaseTimelines,
    clearedForDispatch,
    materialsReadiness,
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
    getCrewDailyActuals(projectId),
    getPhaseTimelines(projectId),
    isProjectClearedForInstall(projectId),
    getMaterialsReadiness(projectId),
  ]);
  const members = await listCrewMembers(crews.map((crew) => crew.id));

  return (
    <div className="flex flex-col gap-4">
      {!clearedForDispatch ? (
        <div
          data-testid="dispatch-gate-banner"
          className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3"
        >
          <p className="text-sm font-semibold text-destructive">
            Not cleared for crew dispatch — Materials gate
          </p>
          <p className="mt-1 text-sm text-foreground">
            {materialsReadiness.blockedReason ?? "Materials aren't verified yet."}{" "}
            Verify the BOM on the project&apos;s Receiving tab and complete the
            Materials stage (or have an owner/PM override it) to assign crews.
          </p>
        </div>
      ) : null}

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
        crewDailyActuals={Object.fromEntries(
          [...crewDailyActuals.entries()].map(([crewId, perDate]) => [
            crewId,
            Object.fromEntries(perDate),
          ])
        )}
        phaseTimelines={phaseTimelines}
      />
    </div>
  );
}
