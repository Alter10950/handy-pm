import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getProject,
  getProjectProgress,
  getSignedDrawingUrl,
  listDrawings,
  listMaterials,
} from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-2xl font-bold tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, progress, materials, drawings] = await Promise.all([
    getProject(id),
    getProjectProgress(id),
    listMaterials(id),
    listDrawings(id),
  ]);
  if (!project) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
    : { data: null };
  const canDownloadCloseout = profile?.role === "owner" || profile?.role === "pm";

  const thumbnail = drawings[0];
  const thumbnailUrl = thumbnail
    ? await getSignedDrawingUrl(thumbnail.storage_path)
    : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Project details
            </h2>
            {canDownloadCloseout ? (
              <Link
                href={`/api/projects/${id}/closeout-pdf`}
                className="text-xs font-medium text-primary hover:underline"
              >
                Download closeout PDF
              </Link>
            ) : null}
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Site address</dt>
              <dd className="text-foreground">{project.site_address || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Deadline</dt>
              <dd className="text-foreground">
                {formatDate(project.deadline)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Created</dt>
              <dd className="text-foreground">
                {formatDate(project.created_at.slice(0, 10))}
              </dd>
            </div>
          </dl>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <StatTile label="Rows" value={String(progress?.row_count ?? 0)} />
          <StatTile label="Materials" value={String(materials.length)} />
          <StatTile
            label="Complete"
            value={`${Math.round((progress?.pct ?? 0) * 100)}%`}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Drawing
        </h2>
        <div className="mt-3 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-muted">
          {thumbnailUrl ? (
            <Image
              src={thumbnailUrl}
              alt="Drawing thumbnail"
              width={thumbnail?.width ?? 800}
              height={thumbnail?.height ?? 600}
              className="h-full w-full object-contain"
              unoptimized
            />
          ) : (
            <p className="px-4 text-center text-sm text-muted-foreground">
              No drawing uploaded yet — upload one from the Layout tab.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
