"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import {
  getDefaultGateTemplateId,
  getTemplateStagesWithItems,
  STAGE_ORDER,
} from "@/lib/gates/queries";
import { touchProjectActivity } from "@/lib/projects/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { GateStageKey, ProfileRole } from "@/lib/supabase/database.types";

// Matches project_stages_write / project_gate_items_write RLS's owner/pm
// branch — the scheduler carve-out (schedule-stage rows only) is RLS's
// job to enforce precisely; this app-level gate is intentionally the
// coarser "at least one of these three roles," so a scheduler attempting
// a non-schedule-stage write gets past this check and then a clear,
// specific rejection from the RLS-aware .maybeSingle() checks below,
// rather than a generic "no permission" before RLS even gets a say.
const GATE_MANAGERS = ["owner", "pm"] as const;
const GATE_WRITERS = ["owner", "pm", "scheduler"] as const;
// Matches gate_templates_write/gate_template_stages_write/
// gate_template_items_write RLS exactly — "Template management (owner)"
// per ADR-037, stricter than GATE_MANAGERS above.
const TEMPLATE_MANAGERS = ["owner"] as const;

function revalidateProject(projectId: string) {
  revalidatePath(`/app/project/${projectId}`);
  revalidatePath("/app/dashboard");
}

// Idempotent — creates project_stages + project_gate_items from the org's
// current default template the first time a project needs them. Uses the
// admin client deliberately: this is a one-time bootstrap of rows that
// would exist anyway (copied verbatim from the org's own template), not a
// discretionary edit, so it shouldn't be blocked by the RLS write policy's
// owner/pm/scheduler-only restriction if a crew member happens to be the
// first person to open a project's lifecycle view. Safe for any project
// already created (new, going forward, via createProject/
// createEstimateProject) or any pre-Batch-4 project sub-phase J hasn't
// walked forward yet — either way, calling this twice is a no-op.
export async function ensureProjectStages(
  projectId: string,
  orgId: string
): Promise<void> {
  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("project_stages")
    .select("id")
    .eq("project_id", projectId)
    .limit(1);
  if (existingError) throw existingError;
  if (existing.length > 0) return;

  const templateId = await getDefaultGateTemplateId(orgId);
  if (!templateId) return;
  const templateStages = await getTemplateStagesWithItems(templateId);

  for (const stage of templateStages) {
    const { data: projectStage, error: stageError } = await admin
      .from("project_stages")
      .insert({
        project_id: projectId,
        stage_key: stage.stage_key,
        status: stage.stage_key === "handoff" ? "active" : "locked",
      })
      .select("id")
      .single();
    if (stageError) throw stageError;

    if (stage.items.length > 0) {
      const { error: itemsError } = await admin.from("project_gate_items").insert(
        stage.items.map((item) => ({
          project_stage_id: projectStage.id,
          template_item_id: item.id,
          label: item.label,
          position: item.position,
        }))
      );
      if (itemsError) throw itemsError;
    }
  }
}

async function advanceToNextStage(
  projectId: string,
  completedStageKey: GateStageKey
): Promise<void> {
  const nextKey = STAGE_ORDER[STAGE_ORDER.indexOf(completedStageKey) + 1];
  if (!nextKey) return; // closeout was the last stage — nothing to unlock
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_stages")
    .update({ status: "active" })
    .eq("project_id", projectId)
    .eq("stage_key", nextKey);
  if (error) throw error;

  const { error: projectError } = await supabase
    .from("projects")
    .update({ stage_key: nextKey })
    .eq("id", projectId);
  if (projectError) throw projectError;
}

export interface GateItemPatch {
  done?: boolean;
  photoPath?: string | null;
  note?: string | null;
  dueDate?: string | null;
}

export async function toggleGateItem(
  itemId: string,
  projectId: string,
  patch: GateItemPatch
): Promise<void> {
  const { userId } = await requireRole(GATE_WRITERS);
  const supabase = await createClient();

  // An explicit inline object type, not Record<string, unknown> — the
  // latter's index signature doesn't satisfy Supabase's generated Update
  // type (same fix as lib/rows/actions.ts#updateRowReadiness).
  const dbPatch: {
    done?: boolean;
    done_by?: string | null;
    done_at?: string | null;
    photo_path?: string | null;
    note?: string | null;
    due_date?: string | null;
  } = {};
  if (patch.done !== undefined) {
    dbPatch.done = patch.done;
    dbPatch.done_by = patch.done ? userId : null;
    dbPatch.done_at = patch.done ? new Date().toISOString() : null;
  }
  if (patch.photoPath !== undefined) dbPatch.photo_path = patch.photoPath;
  if (patch.note !== undefined) dbPatch.note = patch.note;
  if (patch.dueDate !== undefined) dbPatch.due_date = patch.dueDate;
  if (Object.keys(dbPatch).length === 0) return;

  const { data, error } = await supabase
    .from("project_gate_items")
    .update(dbPatch)
    .eq("id", itemId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(
      "Couldn't update that item — you may not have permission, or it's in a different stage than allowed."
    );
  }

  await touchProjectActivity(projectId);
  revalidateProject(projectId);
}

// A signoff item's requires_signoff_role (carried on its template item,
// not copied onto the per-project row — see ADR-038) restricts WHO can
// sign it, on top of the general owner/pm/scheduler gate above.
export async function signOffGateItem(
  itemId: string,
  projectId: string
): Promise<void> {
  const { userId, role } = await requireRole(GATE_WRITERS);
  const supabase = await createClient();

  const { data: item, error: itemError } = await supabase
    .from("project_gate_items")
    .select("id, template_item_id")
    .eq("id", itemId)
    .single();
  if (itemError) throw itemError;

  if (item.template_item_id) {
    const { data: templateItem, error: templateItemError } = await supabase
      .from("gate_template_items")
      .select("requires_signoff_role")
      .eq("id", item.template_item_id)
      .maybeSingle();
    if (templateItemError) throw templateItemError;
    if (
      templateItem?.requires_signoff_role &&
      templateItem.requires_signoff_role !== role
    ) {
      throw new Error(`Only a ${templateItem.requires_signoff_role} can sign off this item.`);
    }
  }

  const { error } = await supabase
    .from("project_gate_items")
    .update({
      signoff_user_id: userId,
      done: true,
      done_by: userId,
      done_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  if (error) throw error;

  await touchProjectActivity(projectId);
  revalidateProject(projectId);
}

export async function addGateItem(
  projectStageId: string,
  projectId: string,
  label: string
): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Item label is required.");
  await requireRole(GATE_MANAGERS);
  const supabase = await createClient();

  // Append after every existing item in this stage, not just the
  // template-copied ones — a custom item always belongs at the end of
  // the checklist it was added to.
  const { data: last, error: lastError } = await supabase
    .from("project_gate_items")
    .select("position")
    .eq("project_stage_id", projectStageId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw lastError;

  const { error } = await supabase.from("project_gate_items").insert({
    project_stage_id: projectStageId,
    label: trimmed,
    position: (last?.position ?? 0) + 1,
  });
  if (error) throw error;

  revalidateProject(projectId);
}

export async function removeGateItem(
  itemId: string,
  projectId: string
): Promise<void> {
  await requireRole(GATE_MANAGERS);
  const supabase = await createClient();
  const { error } = await supabase.from("project_gate_items").delete().eq("id", itemId);
  if (error) throw error;

  revalidateProject(projectId);
}

// A stage can only complete when every item is done — or an owner/pm
// overrides with a required reason (see overrideStage). Completing
// unlocks the next stage and syncs projects.stage_key — the gate
// philosophy's own "blocks by default, accountable escape hatch"
// posture, applied here first before the rest of this batch reuses it.
export async function completeStage(
  projectStageId: string,
  projectId: string
): Promise<void> {
  await requireRole(GATE_MANAGERS);
  const supabase = await createClient();

  const { data: stage, error: stageError } = await supabase
    .from("project_stages")
    .select("id, stage_key")
    .eq("id", projectStageId)
    .single();
  if (stageError) throw stageError;

  const { data: items, error: itemsError } = await supabase
    .from("project_gate_items")
    .select("done")
    .eq("project_stage_id", projectStageId);
  if (itemsError) throw itemsError;
  const incomplete = items.filter((i) => !i.done).length;
  if (incomplete > 0) {
    throw new Error(
      `${incomplete} item${incomplete === 1 ? "" : "s"} still open — finish them, or use Override.`
    );
  }

  const { error } = await supabase
    .from("project_stages")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("id", projectStageId);
  if (error) throw error;

  await advanceToNextStage(projectId, stage.stage_key);
  await touchProjectActivity(projectId);
  revalidateProject(projectId);
}

export async function overrideStage(
  projectStageId: string,
  projectId: string,
  reason: string
): Promise<void> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error("A reason is required to override a gate.");
  const { userId } = await requireRole(GATE_MANAGERS);
  const supabase = await createClient();

  const { data: stage, error: stageError } = await supabase
    .from("project_stages")
    .select("id, stage_key")
    .eq("id", projectStageId)
    .single();
  if (stageError) throw stageError;

  const { error } = await supabase
    .from("project_stages")
    .update({
      status: "overridden",
      overridden_by: userId,
      override_reason: trimmedReason,
      completed_at: new Date().toISOString(),
    })
    .eq("id", projectStageId);
  if (error) throw error;

  await advanceToNextStage(projectId, stage.stage_key);
  await touchProjectActivity(projectId);
  revalidateProject(projectId);
}

// TEMPLATE MANAGEMENT (owner-only, see ADR-037/"Template management
// (owner)"). Edits the org's shared default template only — every
// project_gate_items row is copied at project creation (ensureProjectStages
// above), so these never retroactively change an already-bootstrapped
// project's checklist. Stages themselves are structural (fixed to
// STAGE_ORDER's 8 keys, enforced by gate_template_stages' own CHECK
// constraint) — only a stage's ITEMS are editable template content.

export interface TemplateItemPatch {
  label?: string;
  description?: string | null;
  requiresPhoto?: boolean;
  requiresSignoffRole?: ProfileRole | null;
}

export async function updateTemplateItem(
  itemId: string,
  patch: TemplateItemPatch
): Promise<void> {
  await requireRole(TEMPLATE_MANAGERS);
  const supabase = await createClient();

  // An explicit inline object type, not Record<string, unknown> — same
  // fix as toggleGateItem above (Supabase's generated Update type has an
  // index-signature mismatch with a loose Record).
  const dbPatch: {
    label?: string;
    description?: string | null;
    requires_photo?: boolean;
    requires_signoff_role?: string | null;
  } = {};
  if (patch.label !== undefined) {
    const trimmed = patch.label.trim();
    if (!trimmed) throw new Error("Item label is required.");
    dbPatch.label = trimmed;
  }
  if (patch.description !== undefined) dbPatch.description = patch.description;
  if (patch.requiresPhoto !== undefined) dbPatch.requires_photo = patch.requiresPhoto;
  if (patch.requiresSignoffRole !== undefined) {
    dbPatch.requires_signoff_role = patch.requiresSignoffRole;
  }
  if (Object.keys(dbPatch).length === 0) return;

  const { error } = await supabase
    .from("gate_template_items")
    .update(dbPatch)
    .eq("id", itemId);
  if (error) throw error;

  revalidatePath("/app/settings");
}

export async function addTemplateItem(
  templateStageId: string,
  label: string
): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Item label is required.");
  await requireRole(TEMPLATE_MANAGERS);
  const supabase = await createClient();

  const { data: last, error: lastError } = await supabase
    .from("gate_template_items")
    .select("position")
    .eq("template_stage_id", templateStageId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw lastError;

  const { error } = await supabase.from("gate_template_items").insert({
    template_stage_id: templateStageId,
    label: trimmed,
    position: (last?.position ?? 0) + 1,
  });
  if (error) throw error;

  revalidatePath("/app/settings");
}

// Safe to hard-delete: project_gate_items.template_item_id is ON DELETE
// SET NULL, so any project that already copied this item keeps its own
// row (label/done/photo/etc. all intact) and just loses the
// requiresPhoto/requiresSignoffRole display hint that was only ever
// looked up through that reference.
export async function removeTemplateItem(itemId: string): Promise<void> {
  await requireRole(TEMPLATE_MANAGERS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("gate_template_items")
    .delete()
    .eq("id", itemId);
  if (error) throw error;

  revalidatePath("/app/settings");
}
