"use server";

import { revalidatePath } from "next/cache";

import { requireOrg, requireRole } from "@/lib/auth/session";
import { touchProjectActivity } from "@/lib/projects/actions";
import { createClient } from "@/lib/supabase/server";
import type {
  ScopeItemStatus,
  ScopeWorkType,
} from "@/lib/supabase/database.types";

// Matches scope_items_write RLS exactly (owner/pm). Crew's own write
// path is logScopeItemProgress below, against the separate append-only
// scope_item_updates log — not this table.
const SCOPE_MANAGERS = ["owner", "pm"] as const;

function revalidateProject(projectId: string) {
  revalidatePath(`/app/project/${projectId}`);
  revalidatePath(`/app/project/${projectId}/scope`);
}

export interface ScopeItemInput {
  workType: ScopeWorkType;
  description: string;
  qty?: number | null;
  unit?: string | null;
  laborUnits?: number | null;
  rowId?: string | null;
  phaseId?: string | null;
}

export async function addScopeItem(
  projectId: string,
  input: ScopeItemInput
): Promise<void> {
  const trimmedDescription = input.description.trim();
  if (!trimmedDescription) throw new Error("Description is required.");
  await requireRole(SCOPE_MANAGERS);
  const supabase = await createClient();

  const { error } = await supabase.from("scope_items").insert({
    project_id: projectId,
    work_type: input.workType,
    description: trimmedDescription,
    qty: input.qty ?? null,
    unit: input.unit ?? null,
    labor_units: input.laborUnits ?? null,
    row_id: input.rowId ?? null,
    phase_id: input.phaseId ?? null,
    source: "estimate",
  });
  if (error) throw error;

  revalidateProject(projectId);
}

export async function updateScopeItem(
  scopeItemId: string,
  projectId: string,
  input: ScopeItemInput
): Promise<void> {
  const trimmedDescription = input.description.trim();
  if (!trimmedDescription) throw new Error("Description is required.");
  await requireRole(SCOPE_MANAGERS);
  const supabase = await createClient();

  const { error } = await supabase
    .from("scope_items")
    .update({
      work_type: input.workType,
      description: trimmedDescription,
      qty: input.qty ?? null,
      unit: input.unit ?? null,
      labor_units: input.laborUnits ?? null,
      row_id: input.rowId ?? null,
      phase_id: input.phaseId ?? null,
    })
    .eq("id", scopeItemId);
  if (error) throw error;

  revalidateProject(projectId);
}

export async function removeScopeItem(
  scopeItemId: string,
  projectId: string
): Promise<void> {
  await requireRole(SCOPE_MANAGERS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("scope_items")
    .delete()
    .eq("id", scopeItemId);
  if (error) throw error;

  revalidateProject(projectId);
}

// Any signed-in org member (crew included) may log progress — matches
// scope_item_updates_insert RLS (org-scoped only, no role restriction),
// the same "crew reports, office doesn't gate the report" posture as
// blockers_insert.
export async function logScopeItemProgress(
  scopeItemId: string,
  projectId: string,
  input: {
    status: ScopeItemStatus;
    note?: string | null;
    photoPath?: string | null;
  }
): Promise<void> {
  const { userId } = await requireOrg();
  const supabase = await createClient();

  const { error } = await supabase.from("scope_item_updates").insert({
    scope_item_id: scopeItemId,
    status: input.status,
    note: input.note ?? null,
    photo_path: input.photoPath ?? null,
    logged_by: userId,
  });
  if (error) throw error;

  await touchProjectActivity(projectId);
  revalidateProject(projectId);
  revalidatePath(`/field/${projectId}`);
}
