"use server";

import { revalidatePath } from "next/cache";

import { signOffGateItem, toggleGateItem } from "@/lib/gates/actions";
import { touchProjectActivity } from "@/lib/projects/actions";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import type { HandoffConstraints } from "@/lib/handoff/shared";

const HANDOFF_MANAGERS = ["owner", "pm"] as const;

function revalidateProject(projectId: string) {
  revalidatePath(`/app/project/${projectId}`);
  revalidatePath(`/app/project/${projectId}/handoff`);
  revalidatePath(`/app/project/${projectId}/scope`);
}

// Best-effort, silent sync into the Handoff stage's own checklist —
// looked up by label since project_gate_items has no other stable
// pointer back to "the seeded item this conceptually is." Swallows any
// failure (item renamed/removed via Template Management, project not
// yet bootstrapped, signoff role mismatch on signOffGateItem) since the
// survey's own fields are the actual source of truth here; this just
// saves a PM a duplicate manual click in the common case.
async function markHandoffItemDone(
  projectId: string,
  label: string
): Promise<void> {
  try {
    const supabase = await createClient();
    const { data: stage } = await supabase
      .from("project_stages")
      .select("id")
      .eq("project_id", projectId)
      .eq("stage_key", "handoff")
      .maybeSingle();
    if (!stage) return;

    const { data: item } = await supabase
      .from("project_gate_items")
      .select("id, done")
      .eq("project_stage_id", stage.id)
      .eq("label", label)
      .maybeSingle();
    if (!item || item.done) return;

    await toggleGateItem(item.id, projectId, { done: true });
  } catch (err) {
    console.error(`markHandoffItemDone(${label}) failed`, err);
  }
}

async function signOffHandoffItem(
  projectId: string,
  label: string
): Promise<void> {
  try {
    const supabase = await createClient();
    const { data: stage } = await supabase
      .from("project_stages")
      .select("id")
      .eq("project_id", projectId)
      .eq("stage_key", "handoff")
      .maybeSingle();
    if (!stage) return;

    const { data: item } = await supabase
      .from("project_gate_items")
      .select("id, done")
      .eq("project_stage_id", stage.id)
      .eq("label", label)
      .maybeSingle();
    if (!item || item.done) return;

    await signOffGateItem(item.id, projectId);
  } catch (err) {
    console.error(`signOffHandoffItem(${label}) failed`, err);
  }
}

export interface HandoffSurveyInput {
  siteVisitDate?: string | null;
  existingRackingCondition?: string | null;
  teardownRequired: boolean;
  teardownNotes?: string | null;
  constraints: HandoffConstraints;
}

export async function saveHandoffSurvey(
  projectId: string,
  input: HandoffSurveyInput
): Promise<void> {
  await requireRole(HANDOFF_MANAGERS);
  const supabase = await createClient();

  const { error } = await supabase.from("handoff_surveys").upsert(
    {
      project_id: projectId,
      site_visit_date: input.siteVisitDate || null,
      existing_racking_condition: input.existingRackingCondition || null,
      teardown_required: input.teardownRequired,
      teardown_notes: input.teardownNotes || null,
      constraints: input.constraints as unknown as Json,
    },
    { onConflict: "project_id" }
  );
  if (error) throw error;

  // "Teardown answers auto-create draft scope_items" — one draft item,
  // not re-created on every subsequent save (checked via source +
  // work_type, since a handoff-originated teardown item is always
  // exactly one per project).
  if (input.teardownRequired && input.teardownNotes?.trim()) {
    const { data: existing } = await supabase
      .from("scope_items")
      .select("id")
      .eq("project_id", projectId)
      .eq("source", "handoff")
      .eq("work_type", "teardown")
      .maybeSingle();
    if (!existing) {
      const { error: scopeError } = await supabase.from("scope_items").insert({
        project_id: projectId,
        work_type: "teardown",
        description: input.teardownNotes.trim(),
        source: "handoff",
      });
      if (scopeError) throw scopeError;
    }
  }

  // "Site survey completed with photos" is intentionally NOT marked here —
  // its own requires_photo flag means it should only flip once a photo
  // actually exists, which is addHandoffPhoto's job below, not this save.
  if (input.existingRackingCondition) {
    await markHandoffItemDone(projectId, "Existing racking condition recorded");
  }
  await markHandoffItemDone(
    projectId,
    "Teardown scope confirmed (yes/no) and documented"
  );
  await markHandoffItemDone(projectId, "Site constraints recorded");

  await touchProjectActivity(projectId);
  revalidateProject(projectId);
}

export async function addHandoffPhoto(
  projectId: string,
  photoPath: string
): Promise<void> {
  await requireRole(HANDOFF_MANAGERS);
  const supabase = await createClient();

  const { data: survey, error: fetchError } = await supabase
    .from("handoff_surveys")
    .select("photo_paths")
    .eq("project_id", projectId)
    .maybeSingle();
  if (fetchError) throw fetchError;

  const photoPaths = [...(survey?.photo_paths ?? []), photoPath];
  const { error } = await supabase
    .from("handoff_surveys")
    .upsert(
      { project_id: projectId, photo_paths: photoPaths },
      { onConflict: "project_id" }
    );
  if (error) throw error;

  await markHandoffItemDone(projectId, "Site survey completed with photos");
  revalidateProject(projectId);
}

export async function removeHandoffPhoto(
  projectId: string,
  photoPath: string
): Promise<void> {
  await requireRole(HANDOFF_MANAGERS);
  const supabase = await createClient();

  const { data: survey, error: fetchError } = await supabase
    .from("handoff_surveys")
    .select("photo_paths")
    .eq("project_id", projectId)
    .maybeSingle();
  if (fetchError) throw fetchError;

  const photoPaths = (survey?.photo_paths ?? []).filter((p) => p !== photoPath);
  const { error } = await supabase
    .from("handoff_surveys")
    .update({ photo_paths: photoPaths })
    .eq("project_id", projectId);
  if (error) throw error;

  // Unlike day_logs/blockers photos (append-only logs, nothing is ever
  // unlinked), this array is mutable — remove the object itself too, or
  // it sits in Storage forever with nothing left pointing at it.
  await supabase.storage.from("daily-photos").remove([photoPath]);

  revalidateProject(projectId);
}

export async function signHandoffAsEstimator(projectId: string): Promise<void> {
  const { userId } = await requireRole(HANDOFF_MANAGERS);
  const supabase = await createClient();

  const { error } = await supabase.from("handoff_surveys").upsert(
    {
      project_id: projectId,
      estimator_signoff_user_id: userId,
      estimator_signed_at: new Date().toISOString(),
    },
    { onConflict: "project_id" }
  );
  if (error) throw error;

  await signOffHandoffItem(projectId, "Estimator sign-off");
  await touchProjectActivity(projectId);
  revalidateProject(projectId);
}

export async function signHandoffAsPm(projectId: string): Promise<void> {
  const { userId } = await requireRole(HANDOFF_MANAGERS);
  const supabase = await createClient();

  const { error } = await supabase.from("handoff_surveys").upsert(
    {
      project_id: projectId,
      pm_signoff_user_id: userId,
      pm_signed_at: new Date().toISOString(),
    },
    { onConflict: "project_id" }
  );
  if (error) throw error;

  await signOffHandoffItem(projectId, "PM sign-off");
  await touchProjectActivity(projectId);
  revalidateProject(projectId);
}
