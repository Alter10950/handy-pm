import { DrawingUpload } from "@/components/projects/drawing-upload";
import { DrawingViewer } from "@/components/projects/drawing-viewer";
import { getSignedDrawingUrl, listDrawings } from "@/lib/projects/queries";

export default async function ProjectMarkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const drawings = await listDrawings(id);
  const pages = await Promise.all(
    drawings.map(async (drawing) => ({
      id: drawing.id,
      pageIndex: drawing.page_index,
      width: drawing.width ?? 0,
      height: drawing.height ?? 0,
      url: await getSignedDrawingUrl(drawing.storage_path),
    }))
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Layout</h2>
        <DrawingUpload projectId={id} existingPageCount={drawings.length} />
      </div>

      {pages.length > 0 ? (
        <DrawingViewer pages={pages} />
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-muted-foreground">
          Upload a layout drawing to get started. Row marking tools land next.
        </div>
      )}
    </div>
  );
}
