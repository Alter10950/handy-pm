import { notFound } from "next/navigation";

import { FieldWorkspace } from "@/components/field/field-workspace";
import { listCrews } from "@/lib/crews/queries";
import {
  getInstalledTotals,
  getMyCrewId,
  getSignedDailyPhotoUrls,
  listTodayDayLogs,
  listTodayBlockers,
  listTodayInstalls,
} from "@/lib/field/queries";
import { isProjectClearedForInstall } from "@/lib/gates/queries";
import { listPhases } from "@/lib/phases/queries";
import {
  getProject,
  listMaterials,
  listRowMaterials,
  listRowProgress,
} from "@/lib/projects/queries";
import { listScopeItems } from "@/lib/scope/queries";

export const dynamic = "force-dynamic";

export default async function FieldProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const [
    rows,
    materials,
    phases,
    crews,
    dayLogs,
    blockers,
    myCrewId,
    scopeItems,
    clearedForInstall,
  ] = await Promise.all([
    listRowProgress(projectId),
    listMaterials(projectId),
    listPhases(projectId),
    listCrews(),
    listTodayDayLogs(projectId),
    listTodayBlockers(projectId),
    getMyCrewId(),
    listScopeItems(projectId),
    isProjectClearedForInstall(projectId),
  ]);
  const rowMaterials = await listRowMaterials(rows.map((row) => row.row_id));
  const [installedTotals, todayInstalls, dayLogPhotoUrls] = await Promise.all([
    getInstalledTotals(rows.map((row) => row.row_id)),
    listTodayInstalls(rows.map((row) => row.row_id)),
    getSignedDailyPhotoUrls(dayLogs.flatMap((log) => log.photo_paths ?? [])),
  ]);

  return (
    <FieldWorkspace
      project={project}
      rows={rows}
      materials={materials}
      rowMaterials={rowMaterials}
      installedTotals={Object.fromEntries(installedTotals)}
      todayInstalls={todayInstalls}
      phases={phases}
      crews={crews}
      dayLogs={dayLogs}
      todayBlockers={blockers}
      myCrewId={myCrewId}
      dayLogPhotoUrls={dayLogPhotoUrls}
      scopeItems={scopeItems}
      clearedForInstall={clearedForInstall}
    />
  );
}
