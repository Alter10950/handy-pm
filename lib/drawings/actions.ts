"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

// Matches drawing_versions_write / drawings_write RLS exactly (owner/pm) —
// same editors as every other project-content mutation.
const DRAWING_EDITORS = ["owner", "pm"] as const;

// Re-uploads a page: supersedes whatever version was latest, inserts the
// new one UNAPPROVED (a fresh revision needs a PM's eyes before crews build
// from it — the one exception is the very first version of a brand-new
// page, auto-approved by recordDrawingUpload since there's nothing yet to
// review against), and updates the drawings row in place so every existing
// reader of `drawings` (the marking canvas, materials reference stage,
// signed-URL generation) keeps working unmodified and always shows the
// latest image. See docs/DECISIONS.md ADR-034.
export async function uploadDrawingVersion(
  projectId: string,
  drawingId: string,
  pageIndex: number,
  storagePath: string,
  width: number,
  height: number
): Promise<void> {
  await requireRole(DRAWING_EDITORS);
  const supabase = await createClient();

  const { data: existingVersions, error: existingError } = await supabase
    .from("drawing_versions")
    .select("version")
    .eq("project_id", projectId)
    .eq("page_index", pageIndex);
  if (existingError) throw existingError;
  const nextVersion =
    existingVersions.reduce((max, v) => Math.max(max, v.version), 0) + 1;

  const { error: supersedeError } = await supabase
    .from("drawing_versions")
    .update({ superseded_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("page_index", pageIndex)
    .is("superseded_at", null);
  if (supersedeError) throw supersedeError;

  const { error: insertError } = await supabase.from("drawing_versions").insert({
    project_id: projectId,
    page_index: pageIndex,
    storage_path: storagePath,
    version: nextVersion,
    approved_for_install: false,
  });
  if (insertError) throw insertError;

  const { error: drawingError } = await supabase
    .from("drawings")
    .update({ storage_path: storagePath, width, height })
    .eq("id", drawingId);
  if (drawingError) throw drawingError;

  revalidatePath(`/app/project/${projectId}/mark`);
  revalidatePath(`/app/project/${projectId}/materials`);
}

// Approves the given version and defensively un-approves every other
// version of the same page, so "at most one approved version per page"
// holds even if this is ever called out of latest-version order.
export async function approveDrawingVersion(
  versionId: string,
  projectId: string,
  pageIndex: number
): Promise<void> {
  await requireRole(DRAWING_EDITORS);
  const supabase = await createClient();

  const { error: clearError } = await supabase
    .from("drawing_versions")
    .update({ approved_for_install: false })
    .eq("project_id", projectId)
    .eq("page_index", pageIndex)
    .neq("id", versionId);
  if (clearError) throw clearError;

  const { error } = await supabase
    .from("drawing_versions")
    .update({ approved_for_install: true })
    .eq("id", versionId);
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}/mark`);
}
