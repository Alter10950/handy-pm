import QRCode from "qrcode";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PrintButton } from "@/components/scheduler/print-button";
import { getProject, listMaterials } from "@/lib/projects/queries";

export const metadata: Metadata = {
  title: "Material labels — Handy PM",
};

export const dynamic = "force-dynamic";

// Batch 5 Sub-phase C(1): printable QR label sheet, one label per
// material (code + name + size + qty + a QR of the material id that the
// receiving/staging scan button decodes to jump straight to that line).
// Always light — a print surface.
export default async function MaterialLabelsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, materials] = await Promise.all([
    getProject(id),
    listMaterials(id),
  ]);
  if (!project) notFound();

  // QR payload is the material id — the scanner resolves it against this
  // project's materials. Generated server-side to inline SVG (no runtime
  // asset, prints crisply at any size).
  const labels = await Promise.all(
    materials.map(async (m) => ({
      material: m,
      svg: await QRCode.toString(m.id, {
        type: "svg",
        margin: 0,
        errorCorrectionLevel: "M",
      }),
    }))
  );

  return (
    <div className="force-light mx-auto flex max-w-4xl flex-col gap-4 bg-white p-2 text-foreground print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/app/project/${id}/receiving`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Receiving
        </Link>
        <PrintButton />
      </div>

      <header className="border-b-2 border-foreground pb-2 print:pb-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {project.name}
        </p>
        <h1 className="type-h1 text-xl">Material labels</h1>
        <p className="text-sm text-muted-foreground">
          Print, cut, and stick one on each bundle. Scan on the Receiving tab
          to check a line in.
        </p>
      </header>

      {labels.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No materials yet — add them on the Materials tab first.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3">
          {labels.map(({ material, svg }) => (
            <div
              key={material.id}
              data-testid="qr-label"
              className="flex items-center gap-3 rounded-md border border-border p-2.5 print:break-inside-avoid"
            >
              <div
                className="size-20 shrink-0 [&>svg]:h-full [&>svg]:w-full"
                aria-hidden
                dangerouslySetInnerHTML={{ __html: svg }}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {material.name}
                </p>
                {material.size ? (
                  <p className="text-xs text-muted-foreground">
                    {material.size}
                  </p>
                ) : null}
                <p className="num text-xs text-muted-foreground">
                  Needed {material.total_needed}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
