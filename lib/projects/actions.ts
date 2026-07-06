"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { laborUnitsFor } from "@/lib/estimating/labor";
import { loadLaborStandardsMap } from "@/lib/estimating/queries";
import { parseMaterialList } from "@/lib/projects/parse-material-list";
import { createClient } from "@/lib/supabase/server";
import type { MaterialCondition } from "@/lib/supabase/database.types";

// Matches projects_insert/update/delete, materials_write, drawings_write,
// and packing_slips_write RLS — all owner/pm only.
const PROJECT_EDITORS = ["owner", "pm"] as const;

// Bumps last_activity_at — feeds the dashboard's STALLED flag (Batch 4,
// sub-phase A). Deliberately logs rather than throws on failure: this is
// a best-effort side signal called from several other actions'
// (installs, blockers, day-log closes, gate-item toggles) own success
// path, and its failure shouldn't masquerade as the calling action's own
// failure when the actual primary write already succeeded.
export async function touchProjectActivity(projectId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) console.error("touchProjectActivity failed", error);
}

export async function createProject(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const siteAddress = String(formData.get("site_address") ?? "").trim();
  const deadline = String(formData.get("deadline") ?? "").trim();

  if (!name) throw new Error("Project name is required.");

  const { userId, orgId } = await requireRole(PROJECT_EDITORS);
  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      org_id: orgId,
      name,
      site_address: siteAddress || null,
      deadline: deadline || null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw error;

  revalidatePath("/app");
  redirect(`/app/project/${project.id}`);
}

export async function addMaterial(projectId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Material name is required.");
  await requireRole(PROJECT_EDITORS);

  const supabase = await createClient();
  const standards = await loadLaborStandardsMap();
  const { error } = await supabase.from("materials").insert({
    project_id: projectId,
    name: trimmed,
    labor_units: laborUnitsFor(standards, "general", null),
  });
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}`);
  revalidatePath(`/app/project/${projectId}/materials`);
}

export async function updateMaterial(
  materialId: string,
  projectId: string,
  patch: Partial<{
    name: string;
    unit: string;
    total_needed: number;
    received: number;
    task_key: string;
    size: string | null;
    profile: string | null;
    capacity: string | null;
    condition: MaterialCondition;
    compatible_system: string | null;
  }>
) {
  await requireRole(PROJECT_EDITORS);
  const supabase = await createClient();

  // task_key/size are the only two inputs to labor_units — recompute it
  // whenever either changes so materials.labor_units never drifts out of
  // sync with labor_standards. Every other field is a plain passthrough
  // update with no extra read.
  let fullPatch: typeof patch & { labor_units?: number } = patch;
  if (patch.task_key !== undefined || patch.size !== undefined) {
    const [standards, { data: current, error: currentError }] = await Promise.all([
      loadLaborStandardsMap(),
      supabase.from("materials").select("task_key, size").eq("id", materialId).single(),
    ]);
    if (currentError) throw currentError;
    const taskKey = patch.task_key ?? current.task_key;
    const size = patch.size !== undefined ? patch.size : current.size;
    fullPatch = { ...patch, labor_units: laborUnitsFor(standards, taskKey, size) };
  }

  const { error } = await supabase
    .from("materials")
    .update(fullPatch)
    .eq("id", materialId);
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}/materials`);
}

export async function deleteMaterial(materialId: string, projectId: string) {
  await requireRole(PROJECT_EDITORS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("materials")
    .delete()
    .eq("id", materialId);
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}`);
  revalidatePath(`/app/project/${projectId}/materials`);
}

export async function pasteMaterialList(
  projectId: string,
  text: string,
  replaceExisting: boolean
) {
  const parsed = parseMaterialList(text);
  if (parsed.length === 0) {
    throw new Error('Couldn\'t find any "name, qty" lines to add.');
  }
  await requireRole(PROJECT_EDITORS);

  const supabase = await createClient();
  const standards = await loadLaborStandardsMap();

  if (replaceExisting) {
    const { error: deleteError } = await supabase
      .from("materials")
      .delete()
      .eq("project_id", projectId);
    if (deleteError) throw deleteError;
  }

  // A plain "name, qty" paste line carries no task classification — every
  // line lands as 'general' (the labor_standards catch-all) and can be
  // reclassified afterward in the Materials grid, same as a manually
  // added material.
  const { error } = await supabase.from("materials").insert(
    parsed.map((line) => ({
      project_id: projectId,
      name: line.name,
      total_needed: line.qty,
      received: line.qty,
      labor_units: laborUnitsFor(standards, "general", null),
    }))
  );
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}`);
  revalidatePath(`/app/project/${projectId}/materials`);
}

// Every task_key the AI extraction prompt's own description vocabulary
// covers — the prompt (app/api/packing-slips/extract/route.ts) explicitly
// asks for one of these exact words, so a case-insensitive substring match
// against the extracted description reliably classifies it without any
// extra AI call. Falls back to 'general' for anything else (freight lines
// are already filtered out upstream, so this is mostly genuine materials
// the seeded task_key list doesn't have a specific bucket for yet).
const DESCRIPTION_TASK_KEYWORDS: [string, string][] = [
  ["upright", "upright"],
  ["beam", "beam"],
  ["wire deck", "wire_deck"],
  ["row spacer", "row_spacer"],
  ["end barrier", "end_barrier"],
  ["post protector", "post_protector"],
  ["anchor", "anchor"],
];

function inferTaskKeyFromDescription(description: string): string {
  const lower = description.toLowerCase();
  for (const [keyword, taskKey] of DESCRIPTION_TASK_KEYWORDS) {
    if (lower.includes(keyword)) return taskKey;
  }
  return "general";
}

export async function confirmExtractedMaterials(
  projectId: string,
  items: { code: string; description: string; size: string; qty: number }[],
  replaceExisting: boolean
) {
  // code/description/size are folded into one `name` for at-a-glance grid
  // display and to keep two same-description-different-size lines (like
  // two beam lengths) distinguishable — but size is ALSO stored in its own
  // column now (Batch 3 sub-phase 0), and task_key is inferred from
  // description, so labor_units computes size-aware instead of always
  // falling back to the size-independent standard.
  const cleaned = items
    .map((item) => ({
      name: [item.code, item.description, item.size]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" "),
      size: item.size.trim() || null,
      taskKey: inferTaskKeyFromDescription(item.description),
      qty: Math.round(Number(item.qty)),
    }))
    .filter(
      (item) => item.name.length > 0 && Number.isFinite(item.qty) && item.qty >= 0
    );
  if (cleaned.length === 0) {
    throw new Error("No valid material lines to add.");
  }
  await requireRole(PROJECT_EDITORS);

  const supabase = await createClient();
  const standards = await loadLaborStandardsMap();

  if (replaceExisting) {
    const { error: deleteError } = await supabase
      .from("materials")
      .delete()
      .eq("project_id", projectId);
    if (deleteError) throw deleteError;
  }

  const { error } = await supabase.from("materials").insert(
    cleaned.map((item) => ({
      project_id: projectId,
      name: item.name,
      size: item.size,
      task_key: item.taskKey,
      total_needed: item.qty,
      received: item.qty,
      labor_units: laborUnitsFor(standards, item.taskKey, item.size),
    }))
  );
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}`);
  revalidatePath(`/app/project/${projectId}/materials`);
}

export interface ImportedMaterialRow {
  name: string;
  unit?: string;
  totalNeeded: number;
  taskKey?: string;
  size?: string | null;
  profile?: string | null;
  capacity?: string | null;
  condition?: MaterialCondition;
  compatibleSystem?: string | null;
}

// The CSV/XLSX counterpart to pasteMaterialList/confirmExtractedMaterials —
// same "received = total_needed" packing-slip assumption, same
// replaceExisting toggle, but carrying the fuller identity-field set a
// spreadsheet import can plausibly supply straight from a column mapping.
export async function importMaterials(
  projectId: string,
  items: ImportedMaterialRow[],
  replaceExisting: boolean
): Promise<{ imported: number }> {
  const cleaned = items
    .map((item) => ({
      name: item.name.trim(),
      unit: item.unit?.trim() || undefined,
      totalNeeded: Math.round(Number(item.totalNeeded)),
      taskKey: item.taskKey?.trim() || "general",
      size: item.size?.trim() || null,
      profile: item.profile?.trim() || null,
      capacity: item.capacity?.trim() || null,
      condition: item.condition ?? "new",
      compatibleSystem: item.compatibleSystem?.trim() || null,
    }))
    .filter(
      (item) =>
        item.name.length > 0 &&
        Number.isFinite(item.totalNeeded) &&
        item.totalNeeded >= 0
    );
  if (cleaned.length === 0) {
    throw new Error("No valid material rows to import.");
  }
  await requireRole(PROJECT_EDITORS);

  const supabase = await createClient();
  const standards = await loadLaborStandardsMap();

  if (replaceExisting) {
    const { error: deleteError } = await supabase
      .from("materials")
      .delete()
      .eq("project_id", projectId);
    if (deleteError) throw deleteError;
  }

  const { error } = await supabase.from("materials").insert(
    cleaned.map((item) => ({
      project_id: projectId,
      name: item.name,
      ...(item.unit ? { unit: item.unit } : {}),
      total_needed: item.totalNeeded,
      received: item.totalNeeded,
      task_key: item.taskKey,
      size: item.size,
      profile: item.profile,
      capacity: item.capacity,
      condition: item.condition,
      compatible_system: item.compatibleSystem,
      labor_units: laborUnitsFor(standards, item.taskKey, item.size),
    }))
  );
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}`);
  revalidatePath(`/app/project/${projectId}/materials`);
  return { imported: cleaned.length };
}

export async function deleteMaterialsBatch(
  projectId: string,
  materialIds: string[]
): Promise<void> {
  if (materialIds.length === 0) return;
  await requireRole(PROJECT_EDITORS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("materials")
    .delete()
    .in("id", materialIds);
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}`);
  revalidatePath(`/app/project/${projectId}/materials`);
}

export async function bulkSetMaterialCondition(
  projectId: string,
  materialIds: string[],
  condition: MaterialCondition
): Promise<void> {
  if (materialIds.length === 0) return;
  await requireRole(PROJECT_EDITORS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("materials")
    .update({ condition })
    .in("id", materialIds);
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}/materials`);
}

export async function recordDrawingUpload(
  projectId: string,
  pages: {
    storagePath: string;
    pageIndex: number;
    width: number;
    height: number;
  }[]
) {
  await requireRole(PROJECT_EDITORS);
  const supabase = await createClient();
  // Ordering by page_index has to happen client-side, not via .order() on
  // an insert-returning query — that form errors with "column
  // drawings.page_index does not exist" (PostgREST resolves the ORDER
  // against the statement's own RETURNING/insert-values context, not the
  // table itself, even though the column obviously exists there).
  const { data: inserted, error } = await supabase
    .from("drawings")
    .insert(
      pages.map((page) => ({
        project_id: projectId,
        page_index: page.pageIndex,
        storage_path: page.storagePath,
        width: page.width,
        height: page.height,
      }))
    )
    .select("id, page_index");
  if (error) throw error;

  // Every drawings row needs a matching drawing_versions row (the version
  // history/approval-gate table added in sub-phase 0) — this is the first
  // version of a brand-new page, so there's nothing to supersede and no
  // review gate on day one (see lib/drawings/actions.ts#uploadDrawingVersion
  // for the re-upload path, which does supersede and does reset approval).
  const { error: versionError } = await supabase.from("drawing_versions").insert(
    pages.map((page) => ({
      project_id: projectId,
      page_index: page.pageIndex,
      storage_path: page.storagePath,
      version: 1,
      approved_for_install: true,
    }))
  );
  if (versionError) throw versionError;

  // A project's very first upload becomes its marking page automatically —
  // "exactly one marking page, owner/pm chooses" (see ADR-019) means manual
  // choice for *changing* it later, not friction on the common case of a
  // single-page project that couldn't mark anything until someone picked
  // one. Later uploads default to 'reference' (the column's own default)
  // and need an explicit "Set as marking page."
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("mark_drawing_id")
    .eq("id", projectId)
    .single();
  if (projectError) throw projectError;
  if (!project.mark_drawing_id && inserted.length > 0) {
    const firstPage = [...inserted].sort(
      (a, b) => a.page_index - b.page_index
    )[0];
    await setMarkingDrawing(projectId, firstPage.id);
  }

  revalidatePath(`/app/project/${projectId}`);
  revalidatePath(`/app/project/${projectId}/mark`);
  revalidatePath(`/app/project/${projectId}/materials`);
}

export async function setMarkingDrawing(
  projectId: string,
  drawingId: string
): Promise<void> {
  await requireRole(PROJECT_EDITORS);
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_marking_drawing", {
    p_project_id: projectId,
    p_drawing_id: drawingId,
  });
  if (error) throw error;
  revalidatePath(`/app/project/${projectId}/mark`);
}

export async function recordPackingSlipUpload(
  projectId: string,
  storagePath: string
) {
  await requireRole(PROJECT_EDITORS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("packing_slips")
    .insert({ project_id: projectId, storage_path: storagePath });
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}`);
  revalidatePath(`/app/project/${projectId}/materials`);
}
