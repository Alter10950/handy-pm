import Link from "next/link";

import { MaterialsWorkspace } from "@/components/projects/materials-workspace";
import { PackingSlipExtractDialog } from "@/components/projects/packing-slip-extract-dialog";
import { PackingSlipUpload } from "@/components/projects/packing-slip-upload";
import { ReconciliationCard } from "@/components/projects/reconciliation-card";
import { listLaborStandards } from "@/lib/estimating/queries";
import { listPhases } from "@/lib/phases/queries";
import {
  getProject,
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
import { createClient } from "@/lib/supabase/server";

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
    project,
  ] = await Promise.all([
    listMaterials(id),
    listDrawings(id),
    listRowProgress(id),
    listMaterialReconciliation(id),
    listPackingSlips(id),
    getProjectProgress(id),
    listPhases(id),
    listLaborStandards(),
    getProject(id),
  ]);

  // Scope-growth guard (ADR-043): materials added while the project is
  // already executing, with no change order behind them, are exactly how
  // margin quietly leaks. Compare created_at against the Mobilize
  // stage's completion — everything before that was planning; everything
  // after is mid-execution growth until a CO says otherwise.
  let scopeGrowthCount = 0;
  if (project && ["execute", "punch"].includes(project.stage_key)) {
    const supabase = await createClient();
    const { data: mobilize } = await supabase
      .from("project_stages")
      .select("completed_at")
      .eq("project_id", id)
      .eq("stage_key", "mobilize")
      .maybeSingle();
    if (mobilize?.completed_at) {
      scopeGrowthCount = materials.filter(
        (m) => m.change_order_id === null && m.created_at > mobilize.completed_at!
      ).length;
    }
  }

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

      {scopeGrowthCount > 0 ? (
        <div
          data-testid="scope-growth-banner"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/50 bg-primary/10 px-4 py-3"
        >
          <p className="text-sm text-foreground">
            <span className="font-semibold">
              {scopeGrowthCount} material{scopeGrowthCount === 1 ? "" : "s"} added
              mid-execution
            </span>{" "}
            with no change order behind {scopeGrowthCount === 1 ? "it" : "them"} —
            this looks like scope growth.
          </p>
          <Link
            href={`/app/project/${id}/change-orders`}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            Create a change order?
          </Link>
        </div>
      ) : null}

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
                  className="break-all text-sm text-info-fg hover:underline"
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
