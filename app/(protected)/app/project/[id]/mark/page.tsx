import { DrawingUpload } from "@/components/projects/drawing-upload";
import { RowMarkingWorkspace } from "@/components/projects/row-marking-workspace";
import { listDrawingVersionsByProject } from "@/lib/drawings/queries";
import { listPhases } from "@/lib/phases/queries";
import {
  getProject,
  getSignedDrawingUrl,
  listDrawings,
  listMaterials,
  listRowProgress,
} from "@/lib/projects/queries";

export default async function ProjectMarkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, drawings, rowProgress, materials, phases, versionsByPage] =
    await Promise.all([
      getProject(id),
      listDrawings(id),
      listRowProgress(id),
      listMaterials(id),
      listPhases(id),
      listDrawingVersionsByProject(id),
    ]);
  const pages = await Promise.all(
    drawings.map(async (drawing) => ({
      id: drawing.id,
      pageIndex: drawing.page_index,
      url: await getSignedDrawingUrl(drawing.storage_path),
      storagePath: drawing.storage_path,
      width: drawing.width ?? 0,
      height: drawing.height ?? 0,
      role: drawing.role,
      history: (versionsByPage.get(drawing.page_index) ?? []).map((v) => ({
        id: v.id,
        version: v.version,
        approvedForInstall: v.approved_for_install,
        createdAt: v.created_at,
        supersededAt: v.superseded_at,
      })),
    }))
  );

  const rows = rowProgress.map((row) => ({
    id: row.row_id,
    drawingId: row.drawing_id,
    label: row.label,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    pct: row.pct,
    hasMaterials: row.has_materials,
    isComplete: row.is_complete,
    phaseId: row.phase_id,
    readinessStatus: row.readiness_status,
    materialsReady: row.materials_ready,
    areaAccessible: row.area_accessible,
    drawingApproved: row.drawing_approved,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Layout</h2>
        <DrawingUpload projectId={id} existingPageCount={drawings.length} />
      </div>

      {pages.length > 0 ? (
        <RowMarkingWorkspace
          projectId={id}
          pages={pages}
          rows={rows}
          materials={materials}
          phases={phases}
          markDrawingId={project?.mark_drawing_id ?? null}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-muted-foreground">
          Upload a layout drawing to get started, then mark rows on it.
        </div>
      )}
    </div>
  );
}
