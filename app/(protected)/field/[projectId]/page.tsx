import { notFound } from "next/navigation";

import { FieldWorkspace } from "@/components/field/field-workspace";
import { listCrews } from "@/lib/crews/queries";
import {
  getInstalledTotals,
  listTodayDayLogs,
  listTodayBlockers,
} from "@/lib/field/queries";
import { listPhases } from "@/lib/phases/queries";
import {
  getProject,
  listMaterials,
  listRowMaterials,
  listRowProgress,
} from "@/lib/projects/queries";

export const dynamic = "force-dynamic";

export default async function FieldProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const [rows, materials, phases, crews, dayLogs, blockers] =
    await Promise.all([
      listRowProgress(projectId),
      listMaterials(projectId),
      listPhases(projectId),
      listCrews(),
      listTodayDayLogs(projectId),
      listTodayBlockers(projectId),
    ]);
  const rowMaterials = await listRowMaterials(rows.map((row) => row.row_id));
  const installedTotals = await getInstalledTotals(
    rows.map((row) => row.row_id)
  );

  return (
    <FieldWorkspace
      project={project}
      rows={rows}
      materials={materials}
      rowMaterials={rowMaterials}
      installedTotals={Object.fromEntries(installedTotals)}
      phases={phases}
      crews={crews}
      dayLogs={dayLogs}
      todayBlockers={blockers}
    />
  );
}
