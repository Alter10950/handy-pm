import { MaterialsTable } from "@/components/projects/materials-table";
import { PackingSlipUpload } from "@/components/projects/packing-slip-upload";
import { PasteMaterialsDialog } from "@/components/projects/paste-materials-dialog";
import {
  getSignedPackingSlipUrl,
  listMaterials,
  listPackingSlips,
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
  const [materials, packingSlips] = await Promise.all([
    listMaterials(id),
    listPackingSlips(id),
  ]);

  const packingSlipLinks = await Promise.all(
    packingSlips.map(async (slip) => ({
      id: slip.id,
      name: fileNameFromPath(slip.storage_path),
      url: await getSignedPackingSlipUrl(slip.storage_path),
    }))
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Materials</h2>
        <div className="flex flex-wrap gap-2">
          <PackingSlipUpload projectId={id} />
          <PasteMaterialsDialog projectId={id} />
        </div>
      </div>

      <MaterialsTable projectId={id} materials={materials} />

      {packingSlipLinks.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Uploaded packing slips
          </h3>
          <ul className="flex flex-col gap-1">
            {packingSlipLinks.map((slip) => (
              <li key={slip.id}>
                <a
                  href={slip.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  {slip.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
