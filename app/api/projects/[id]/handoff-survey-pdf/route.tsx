import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse, type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/session";
import { parseConstraints } from "@/lib/handoff/shared";
import { HandoffPdfDocument, type HandoffPdfData } from "@/lib/pdf/handoff-survey-pdf";
import { createClient } from "@/lib/supabase/server";

const PDF_VIEWERS = ["owner", "pm"] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole(PDF_VIEWERS);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Not signed in." },
      { status: 401 }
    );
  }

  const { id: projectId } = await params;
  const supabase = await createClient();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("name, site_address, org_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throw projectError;
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const [
    { data: org, error: orgError },
    { data: survey, error: surveyError },
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("name, address, logo_path")
      .eq("id", project.org_id)
      .single(),
    supabase
      .from("handoff_surveys")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle(),
  ]);
  if (orgError) throw orgError;
  if (surveyError) throw surveyError;

  const signerIds = [
    ...new Set(
      [survey?.estimator_signoff_user_id, survey?.pm_signoff_user_id].filter(
        (id): id is string => id !== null && id !== undefined
      )
    ),
  ];
  const { data: signers, error: signersError } =
    signerIds.length > 0
      ? await supabase.from("profiles").select("id, full_name").in("id", signerIds)
      : { data: [] as { id: string; full_name: string | null }[], error: null };
  if (signersError) throw signersError;
  const nameById = new Map(signers.map((s) => [s.id, s.full_name]));

  const photoPaths = survey?.photo_paths ?? [];
  const [logoUrlResult, photoUrlResults] = await Promise.all([
    org.logo_path
      ? supabase.storage.from("org-logos").createSignedUrl(org.logo_path, 3600)
      : Promise.resolve({ data: null, error: null }),
    Promise.all(
      photoPaths.map((path) =>
        supabase.storage.from("daily-photos").createSignedUrl(path, 3600)
      )
    ),
  ]);

  const data: HandoffPdfData = {
    orgName: org.name,
    orgAddress: org.address,
    orgLogoUrl: logoUrlResult.data?.signedUrl ?? null,
    projectName: project.name,
    projectAddress: project.site_address,
    siteVisitDate: survey?.site_visit_date ?? null,
    existingRackingCondition: survey?.existing_racking_condition ?? null,
    teardownRequired: survey?.teardown_required ?? false,
    teardownNotes: survey?.teardown_notes ?? null,
    constraints: survey ? parseConstraints(survey.constraints) : parseConstraints(null),
    photoUrls: photoUrlResults
      .map((r) => r.data?.signedUrl)
      .filter((url): url is string => Boolean(url)),
    estimatorName: survey?.estimator_signoff_user_id
      ? (nameById.get(survey.estimator_signoff_user_id) ?? "Unknown")
      : null,
    estimatorSignedAt: survey?.estimator_signed_at ?? null,
    pmName: survey?.pm_signoff_user_id
      ? (nameById.get(survey.pm_signoff_user_id) ?? "Unknown")
      : null,
    pmSignedAt: survey?.pm_signed_at ?? null,
  };

  const buffer = await renderToBuffer(<HandoffPdfDocument data={data} />);
  const fileName = `${project.name.replace(/[^a-z0-9]+/gi, "-")}-handoff.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${fileName}"`,
    },
  });
}
