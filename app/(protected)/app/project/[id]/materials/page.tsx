import { MaterialsWorkspace } from "@/components/projects/materials-workspace";
import { PackingSlipExtractDialog } from "@/components/projects/packing-slip-extract-dialog";
import { PackingSlipUpload } from "@/components/projects/packing-slip-upload";
import { ReconciliationCard } from "@/components/projects/reconciliation-card";
import { listLaborStandards } from "@/lib/estimating/queries";
import { listPhases } from "@/lib/phases/queries";
import {
  getProjectProgress,
  getSignedDrawingUrl,
  getSignedPackingSlipUrl,
  listDrawings,
  listMaterialReconciliation,
  listMaterials,
  listPackingSlips,
  listRowMaterials,
  listRowProgress,
} from "@/lib/projects/queries";

function fileNameFromPath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1];
}

export default async function ProjectMaterialsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [
    materials,
    drawings,
    rowProgress,
    reconciliation,
    packingSlips,
    projectProgress,
    phases,
    laborStandards,
  ] = await Promise.all([
    listMaterials(id),
    listDrawings(id),
    listRowProgress(id),
    listMaterialReconciliation(id),
    listPackingSlips(id),
    getProjectProgress(id),
    listPhases(id),
    listLaborStandards(),
  ]);

  const [rowMaterials, pages, packingSlipLinks] = await Promise.all([
    listRowMaterials(rowProgress.map((row) => row.row_id)),
    Promise.all(
      drawings.map(async (drawing) => ({
        id: drawing.id,
        pageIndex: drawing.page_index,
        url: await getSignedDrawingUrl(drawing.storage_path),
      }))
    ),
    Promise.all(
      packingSlips.map(async (slip) => ({
        id: slip.id,
        name: fileNameFromPath(slip.storage_path),
        url: await getSignedPackingSlipUrl(slip.storage_path),
        storagePath: slip.storage_path,
      }))
    ),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Materials</h2>
        <PackingSlipUpload projectId={id} />
      </div>

      <MaterialsWorkspace
        projectId={id}
        pages={pages}
        rowProgress={rowProgress}
        materials={materials}
        reconciliation={reconciliation}
        rowMaterials={rowMaterials}
        phases={phases}
        laborStandards={laborStandards}
      />

      <ReconciliationCard
        reconciliation={reconciliation}
        overallPct={projectProgress?.pct ?? 0}
      />

      {packingSlipLinks.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Uploaded packing slips
          </h3>
          <ul className="flex flex-col gap-2">
            {packingSlipLinks.map((slip) => (
              <li key={slip.id} className="flex flex-wrap items-center gap-2">
                <a
                  href={slip.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-sm text-primary hover:underline"
                >
                  {slip.name}
                </a>
                <PackingSlipExtractDialog
                  projectId={id}
                  storagePath={slip.storagePath}
                  slipName={slip.name}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
