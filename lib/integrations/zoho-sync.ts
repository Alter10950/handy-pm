import { STAGE_LABEL } from "@/lib/gates/shared";
import { pushProjectToDeal } from "@/lib/integrations/zoho";
import { createClient } from "@/lib/supabase/server";
import type { GateStageKey } from "@/lib/supabase/database.types";

// Batch 5 Sub-phase G: push a project's status back to its linked Zoho
// deal when a stage completes. Best-effort and fully guarded — no link, no
// connection, or any error is a silent no-op so a local stage transition
// never depends on Zoho being up.
export async function syncProjectStageToZoho(
  projectId: string,
  stageKey: GateStageKey
): Promise<void> {
  try {
    const supabase = await createClient();
    const { data: link } = await supabase
      .from("integration_links")
      .select("org_id, remote_id")
      .eq("provider", "zoho")
      .eq("local_kind", "project")
      .eq("local_id", projectId)
      .maybeSingle();
    if (!link) return;

    const { data: progress } = await supabase
      .from("project_progress")
      .select("pct")
      .eq("project_id", projectId)
      .maybeSingle();

    await pushProjectToDeal(link.org_id, link.remote_id, {
      stage: STAGE_LABEL[stageKey],
      percentComplete: progress
        ? Math.round((progress.pct ?? 0) * 100)
        : undefined,
    });
  } catch {
    // Silent — the linked deal is a mirror, not the source of truth.
  }
}
