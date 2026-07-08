import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LifecyclePanel } from "@/components/gates/lifecycle-panel";
import { WhatsNextPanel } from "@/components/gates/whats-next-panel";
import { PmAssignment } from "@/components/projects/pm-assignment";
import { StatTile } from "@/components/ui/stat-tile";
import { ensureProjectStages } from "@/lib/gates/actions";
import { computeNextActions, getProjectLifecycle } from "@/lib/gates/queries";
import {
  getProject,
  getProjectProgress,
  getSignedDrawingUrl,
  listDrawings,
  listMaterials,
} from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";
import { listPmCandidates, listTeamMembers } from "@/lib/team/queries";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
    ? await supabase
        .from("profiles")
        .select("org_id, role")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };
  const canDownloadCloseout =
    profile?.role === "owner" || profile?.role === "pm";
  const canManageGates = profile?.role === "owner" || profile?.role === "pm";
  const canWriteGates = canManageGates || profile?.role === "scheduler";
  const canManagePm = profile?.role === "owner" || profile?.role === "pm";

  // A pre-sale draft (status='estimate') has no execution lifecycle yet —
  // the 8 stages are about running a real job, not pricing one.
  let lifecycle: Awaited<ReturnType<typeof getProjectLifecycle>> = [];
  if (project.status !== "estimate" && profile?.org_id) {
    await ensureProjectStages(id, profile.org_id);
    lifecycle = await getProjectLifecycle(id);
  }
  const nextActions = computeNextActions(lifecycle);

  const [pmCandidates, teamMembers] = await Promise.all([
    listPmCandidates(),
    listTeamMembers(),
  ]);
  const currentPm = teamMembers.find((m) => m.id === project.pm_user_id);
  const currentPmLabel = currentPm
    ? currentPm.fullName || currentPm.email
    : null;

  const thumbnail = drawings[0];
  const thumbnailUrl = thumbnail
    ? await getSignedDrawingUrl(thumbnail.storage_path)
    : null;

  return (
    <div className="flex flex-col gap-4">
      {lifecycle.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <LifecyclePanel
              projectId={id}
              stages={lifecycle}
              canWrite={canWriteGates}
              canManage={canManageGates}
            />
          </div>
          <WhatsNextPanel actions={nextActions} />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <div className="rounded-xl border border-border bg-surface p-5 shadow-e1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="type-overline text-muted-foreground">
                Project details
              </h2>
              {canDownloadCloseout ? (
                <Link
                  href={`/api/projects/${id}/closeout-pdf`}
                  className="text-xs font-medium text-info-fg hover:underline"
                >
                  Download closeout PDF
                </Link>
              ) : null}
            </div>
            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Site address</dt>
                <dd className="text-foreground">
                  {project.site_address || "—"}
                </dd>
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
              {project.status !== "estimate" ? (
                <div>
                  <dt className="text-xs text-muted-foreground">
                    PM of record
                  </dt>
                  <dd className="mt-0.5">
                    <PmAssignment
                      projectId={id}
                      currentPmId={project.pm_user_id}
                      currentPmLabel={currentPmLabel}
                      candidates={pmCandidates}
                      canManage={canManagePm}
                    />
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <StatTile label="Rows" value={String(progress?.row_count ?? 0)} />
            <StatTile label="Materials" value={String(materials.length)} />
            <StatTile
              label="Complete"
              value={String(Math.round((progress?.pct ?? 0) * 100))}
              suffix="%"
            />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 shadow-e1">
          <h2 className="type-overline text-muted-foreground">Drawing</h2>
          <div className="mt-3 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-stage">
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
    </div>
  );
}
