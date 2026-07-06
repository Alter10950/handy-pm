import { createClient } from "@/lib/supabase/server";
import type { PhotoSource, Tables } from "@/lib/supabase/database.types";

// Office-side reads (RLS-scoped, authenticated owner/pm session) — for
// the project's "Portal" tab: managing share links and curating which
// photos are customer-visible. The public /portal/[token] route itself
// never calls anything in this file; see lib/portal/public.ts for that
// (service-role, no session to scope RLS against).

export async function listShareTokens(
  projectId: string
): Promise<Tables<"share_tokens">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("share_tokens")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function listApprovedPhotos(
  projectId: string
): Promise<(Tables<"approved_photos"> & { url: string })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("approved_photos")
    .select("*")
    .eq("project_id", projectId)
    .order("approved_at", { ascending: false });
  if (error) throw error;
  if (data.length === 0) return [];

  const urls = await Promise.all(
    data.map(async (photo) => {
      const { data: signed, error: signError } = await supabase.storage
        .from("daily-photos")
        .createSignedUrl(photo.storage_path, 3600);
      if (signError) throw signError;
      return signed.signedUrl;
    })
  );
  return data.map((photo, i) => ({ ...photo, url: urls[i] }));
}

export interface CandidatePhoto {
  storagePath: string;
  source: PhotoSource;
  context: string;
  url: string;
  approvedPhotoId: string | null;
}

function formatWorkDate(workDate: string): string {
  return new Date(`${workDate}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Every photo attached anywhere on this project (day-log documentation
// photos + blocker photos), regardless of approval state — the office UI
// browses this full list and toggles individual photos in or out of
// approved_photos. Deliberately does NOT auto-suggest or auto-approve
// anything: a blocker photo in particular usually documents a problem,
// not something to default-expose to a customer.
export async function listCandidatePhotos(
  projectId: string
): Promise<CandidatePhoto[]> {
  const supabase = await createClient();
  const [
    { data: dayLogs, error: dayLogsError },
    { data: blockers, error: blockersError },
    { data: approved, error: approvedError },
  ] = await Promise.all([
    supabase
      .from("day_logs")
      .select("work_date, photo_paths")
      .eq("project_id", projectId),
    supabase
      .from("blockers")
      .select("code, work_date, photo_path")
      .eq("project_id", projectId)
      .not("photo_path", "is", null),
    supabase
      .from("approved_photos")
      .select("id, storage_path")
      .eq("project_id", projectId),
  ]);
  if (dayLogsError) throw dayLogsError;
  if (blockersError) throw blockersError;
  if (approvedError) throw approvedError;

  const approvedByPath = new Map(approved.map((a) => [a.storage_path, a.id]));

  const candidates: Omit<CandidatePhoto, "url">[] = [
    ...dayLogs.flatMap((log) =>
      log.photo_paths.map((storagePath) => ({
        storagePath,
        source: "day_log" as PhotoSource,
        context: `Day log — ${formatWorkDate(log.work_date)}`,
        approvedPhotoId: approvedByPath.get(storagePath) ?? null,
      }))
    ),
    ...blockers.map((blocker) => ({
      storagePath: blocker.photo_path!,
      source: "blocker" as PhotoSource,
      context: `Blocker — ${blocker.code} (${formatWorkDate(blocker.work_date)})`,
      approvedPhotoId: approvedByPath.get(blocker.photo_path!) ?? null,
    })),
  ];
  if (candidates.length === 0) return [];

  const urls = await Promise.all(
    candidates.map(async (candidate) => {
      const { data: signed, error } = await supabase.storage
        .from("daily-photos")
        .createSignedUrl(candidate.storagePath, 3600);
      if (error) throw error;
      return signed.signedUrl;
    })
  );
  return candidates.map((candidate, i) => ({ ...candidate, url: urls[i] }));
}
