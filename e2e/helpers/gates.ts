import { createAdminClient } from "./supabase-admin";

// Batch 4 Sub-phase E's dispatch gate (ADR-042) blocks createAssignment/
// moveAssignment while a project's Mobilize stage is locked. Tests that
// aren't about the gate itself clear it the way a real org would end up:
// Materials marked complete, Mobilize active — as if the office had
// verified the BOM. Stages must already exist, which they do for any
// UI-created project (creation redirects to the Overview page, whose
// render bootstraps them via ensureProjectStages).
export async function clearDispatchGate(projectId: string) {
  const admin = createAdminClient();

  const { error: materialsError } = await admin
    .from("project_stages")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("stage_key", "materials");
  if (materialsError) throw materialsError;

  const { data: mobilize, error: mobilizeError } = await admin
    .from("project_stages")
    .update({ status: "active" })
    .eq("project_id", projectId)
    .eq("stage_key", "mobilize")
    .select("id");
  if (mobilizeError) throw mobilizeError;
  if (!mobilize || mobilize.length === 0) {
    throw new Error(
      `clearDispatchGate: project ${projectId} has no mobilize stage row — ` +
        "did the test visit the project Overview page (which bootstraps stages) first?"
    );
  }

  const { error: projectError } = await admin
    .from("projects")
    .update({ stage_key: "mobilize" })
    .eq("id", projectId);
  if (projectError) throw projectError;
}
