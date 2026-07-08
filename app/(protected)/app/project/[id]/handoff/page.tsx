import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { HandoffSurveyForm } from "@/components/handoff/handoff-survey-form";
import {
  getHandoffSurvey,
  getSignedHandoffPhotoUrls,
} from "@/lib/handoff/queries";
import {
  getProject,
  getSignedDrawingUrl,
  listDrawings,
} from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Handoff — Handy PM",
};

export const dynamic = "force-dynamic";

export default async function HandoffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  // handoff_surveys RLS is owner/pm-only both ways — same posture as the
  // Team page, redirect rather than render an empty/broken form for a
  // role that could never read the row anyway.
  if (profile?.role !== "owner" && profile?.role !== "pm") {
    redirect(`/app/project/${id}`);
  }

  const [survey, drawings] = await Promise.all([
    getHandoffSurvey(id),
    listDrawings(id),
  ]);
  const photoUrls = await getSignedHandoffPhotoUrls(survey?.photo_paths ?? []);

  const referenceDrawing = drawings[0] ?? null;
  const drawingUrl = referenceDrawing
    ? await getSignedDrawingUrl(referenceDrawing.storage_path)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Sales → ops handoff
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One structured record of the site visit — condition, teardown,
            constraints, and photos — signed off by both the estimator and the
            PM before work is scheduled.
          </p>
        </div>
        <Link
          href={`/api/projects/${id}/handoff-survey-pdf`}
          className="text-xs font-medium text-info-fg hover:underline"
        >
          Download handoff PDF
        </Link>
      </div>

      <div className="rounded-lg border border-border bg-card shadow-e1 p-4">
        <h3 className="text-sm font-semibold text-foreground">
          Walk the drawing
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Reference this while walking the site, if one&apos;s already on file —
          confirm it still matches what&apos;s actually there.
        </p>
        <div className="mt-3 flex aspect-[4/3] max-w-md items-center justify-center overflow-hidden rounded-md bg-muted">
          {drawingUrl ? (
            <Image
              src={drawingUrl}
              alt="Reference drawing"
              width={referenceDrawing?.width ?? 800}
              height={referenceDrawing?.height ?? 600}
              className="h-full w-full object-contain"
              unoptimized
            />
          ) : (
            <p className="px-4 text-center text-sm text-muted-foreground">
              No drawing on file yet.
            </p>
          )}
        </div>
      </div>

      <HandoffSurveyForm
        projectId={id}
        survey={survey}
        photoUrls={photoUrls}
        currentUserId={user.id}
        canManage
        aiDraftAvailable={Boolean(process.env.ANTHROPIC_API_KEY)}
      />
    </div>
  );
}
