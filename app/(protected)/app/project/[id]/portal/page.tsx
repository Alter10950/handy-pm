import { PhotoApprovalPanel } from "@/components/portal/photo-approval-panel";
import { ShareLinkPanel } from "@/components/portal/share-link-panel";
import {
  listApprovedPhotos,
  listCandidatePhotos,
  listShareTokens,
} from "@/lib/portal/queries";

export default async function ProjectPortalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [tokens, candidatePhotos, approvedPhotos] = await Promise.all([
    listShareTokens(id),
    listCandidatePhotos(id),
    listApprovedPhotos(id),
  ]);

  // Approved photos always sort first — an already-shown photo shouldn't
  // require scrolling past everything else to find and remove it.
  const approvedPaths = new Set(approvedPhotos.map((p) => p.storage_path));
  const orderedCandidates = [
    ...candidatePhotos.filter((p) => approvedPaths.has(p.storagePath)),
    ...candidatePhotos.filter((p) => !approvedPaths.has(p.storagePath)),
  ];

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-foreground">Customer portal</h2>
      <p className="text-sm text-muted-foreground">
        Share a read-only status page with this customer — name, % complete,
        most recent update, and only the photos you approve below. Shortages,
        costs, and internal notes never appear here.
      </p>
      <ShareLinkPanel projectId={id} tokens={tokens} />
      <PhotoApprovalPanel projectId={id} candidates={orderedCandidates} />
    </div>
  );
}
