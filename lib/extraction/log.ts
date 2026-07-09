import { createClient } from "@/lib/supabase/server";
import type { Json, Tables } from "@/lib/supabase/database.types";

// Every AI capture is logged to extraction_runs — reviewable, and
// re-runnable (Batch 5 Sub-phase A/B). Guarded + best-effort, same
// posture as the audit log: a logging failure (including the table not
// existing until the migration is approved) must never break the capture
// flow itself. Returns the run id when it lands so the review UI can mark
// it applied/rejected later.

export type ExtractionKind = "packing_slip" | "drawing_rows" | "row_assignment";

export interface StartRunInput {
  projectId: string;
  kind: ExtractionKind;
  inputPath?: string | null;
  rawOutput?: Json | null;
  confidence?: number | null;
  status?: "extracted" | "failed";
}

async function orgFor(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ userId: string; orgId: string } | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.org_id) return null;
  return { userId: user.id, orgId: profile.org_id };
}

/** Record a completed extraction. Returns the run id, or null if logging
 * is unavailable (pre-migration) — callers treat null as "not logged" and
 * carry on. */
export async function recordExtractionRun(
  input: StartRunInput
): Promise<string | null> {
  try {
    const supabase = await createClient();
    const ctx = await orgFor(supabase);
    if (!ctx) return null;
    const { data, error } = await supabase
      .from("extraction_runs")
      .insert({
        org_id: ctx.orgId,
        project_id: input.projectId,
        kind: input.kind,
        status: input.status ?? "extracted",
        input_path: input.inputPath ?? null,
        raw_output: input.rawOutput ?? null,
        confidence: input.confidence ?? null,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) return null;
    return data.id;
  } catch {
    return null;
  }
}

/** Mark a run reviewed + applied/rejected once the human acts on it. */
export async function resolveExtractionRun(
  runId: string,
  applied: boolean
): Promise<void> {
  try {
    const supabase = await createClient();
    const ctx = await orgFor(supabase);
    if (!ctx) return;
    await supabase
      .from("extraction_runs")
      .update({
        status: applied ? "applied" : "rejected",
        applied,
        reviewed_by: ctx.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", runId);
  } catch {
    // Best-effort; the material write is the source of truth.
  }
}

export interface RecentRun {
  id: string;
  kind: string;
  status: string;
  confidence: number | null;
  applied: boolean;
  createdAt: string;
}

/** Guarded list of a project's recent capture runs (audit surface). */
export async function listExtractionRuns(
  projectId: string
): Promise<{ available: boolean; runs: RecentRun[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("extraction_runs")
    .select("id, kind, status, confidence, applied, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { available: false, runs: [] };
  return {
    available: true,
    runs: (data as Pick<
      Tables<"extraction_runs">,
      "id" | "kind" | "status" | "confidence" | "applied" | "created_at"
    >[]).map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      confidence: r.confidence,
      applied: r.applied,
      createdAt: r.created_at,
    })),
  };
}
