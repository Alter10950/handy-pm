import { createAdminClient } from "@/lib/supabase/admin";
import type { PhotoPhase, ProjectStatus } from "@/lib/supabase/database.types";

// The public /portal/[token] route has no user session at all — RLS has
// nothing to scope against (auth.uid() is null), so every read here goes
// through the service-role admin client and manually filters by whatever
// project_id resolveShareToken() already validated, exactly the pattern
// lib/reports/data.ts established for the same "no session" reason
// (there, a Vercel Cron request; here, an anonymous browser). See
// docs/DECISIONS.md ADR-035.

export interface ResolvedShareToken {
  projectId: string;
}

// A token is invalid if it doesn't exist, has been explicitly revoked, or
// has passed its own expires_at — the portal page only ever needs to know
// "valid or not," so those three cases collapse into one null return
// rather than a discriminated reason (nothing customer-facing should ever
// explain *why* a link stopped working beyond "ask your PM").
export async function resolveShareToken(
  token: string
): Promise<ResolvedShareToken | null> {
  if (!token) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("share_tokens")
    .select("project_id, revoked_at, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  return { projectId: data.project_id };
}

export interface PortalPhoto {
  url: string;
  caption: string | null;
  phase: "before" | "during" | "after";
}

export interface PortalData {
  projectName: string;
  status: ProjectStatus;
  pct: number;
  mostRecentUpdate: { workDate: string; note: string | null } | null;
  nextMilestone: string | null;
  photos: PortalPhoto[];
}

// Deliberately narrow selects throughout — project_progress and
// project_estimates both carry shortage/cost-adjacent columns
// (rows_missing_materials, required_total, labor/cost figures) that must
// never reach a customer; every query below names only the columns this
// screen actually renders, not select("*").
export async function getPortalData(projectId: string): Promise<PortalData> {
  const admin = createAdminClient();

  const [
    { data: project, error: projectError },
    { data: latestDayLog, error: dayLogError },
    { data: latestEstimate, error: estimateError },
    { data: approvedPhotos, error: photosError },
  ] = await Promise.all([
    admin
      .from("project_progress")
      .select("name, status, pct, deadline")
      .eq("project_id", projectId)
      .single(),
    admin
      .from("day_logs")
      .select("work_date, note")
      .eq("project_id", projectId)
      .order("work_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("project_estimates")
      .select("forecast_finish")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // phase lands with the Phase 14 migration — named-select with a
    // fallback keeps the narrow-select policy AND pre-migration behavior.
    admin
      .from("approved_photos")
      .select("storage_path, caption, phase")
      .eq("project_id", projectId)
      .order("approved_at", { ascending: false })
      .then((result) =>
        result.error
          ? admin
              .from("approved_photos")
              .select("storage_path, caption")
              .eq("project_id", projectId)
              .order("approved_at", { ascending: false })
              .then(({ data, error }) => ({
                data:
                  data?.map((p) => ({ ...p, phase: "during" as PhotoPhase })) ??
                  null,
                error,
              }))
          : result
      ),
  ]);
  if (projectError) throw projectError;
  if (dayLogError) throw dayLogError;
  if (estimateError) throw estimateError;
  if (photosError) throw photosError;

  const photos = await Promise.all(
    (approvedPhotos ?? []).map(async (photo) => {
      const { data: signed, error } = await admin.storage
        .from("daily-photos")
        .createSignedUrl(photo.storage_path, 3600);
      if (error) throw error;
      return {
        url: signed.signedUrl,
        caption: photo.caption,
        phase: (photo.phase ?? "during") as PortalPhoto["phase"],
      };
    })
  );

  return {
    projectName: project.name,
    status: project.status,
    pct: project.pct,
    mostRecentUpdate: latestDayLog
      ? { workDate: latestDayLog.work_date, note: latestDayLog.note }
      : null,
    nextMilestone: project.deadline ?? latestEstimate?.forecast_finish ?? null,
    photos,
  };
}
