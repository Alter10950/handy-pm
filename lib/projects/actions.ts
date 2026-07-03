"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseMaterialList } from "@/lib/projects/parse-material-list";
import { createClient } from "@/lib/supabase/server";

async function requireOrgId(): Promise<{ userId: string; orgId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();
  if (error) throw error;
  if (!profile.org_id) {
    throw new Error(
      "Your account isn't assigned to an organization yet. Ask an owner/PM to assign you one."
    );
  }
  return { userId: user.id, orgId: profile.org_id };
}

export async function createProject(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const siteAddress = String(formData.get("site_address") ?? "").trim();
  const deadline = String(formData.get("deadline") ?? "").trim();

  if (!name) throw new Error("Project name is required.");

  const { userId, orgId } = await requireOrgId();
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

  const supabase = await createClient();
  const { error } = await supabase
    .from("materials")
    .insert({ project_id: projectId, name: trimmed });
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
  }>
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("materials")
    .update(patch)
    .eq("id", materialId);
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}/materials`);
}

export async function deleteMaterial(materialId: string, projectId: string) {
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

  const supabase = await createClient();

  if (replaceExisting) {
    const { error: deleteError } = await supabase
      .from("materials")
      .delete()
      .eq("project_id", projectId);
    if (deleteError) throw deleteError;
  }

  const { error } = await supabase.from("materials").insert(
    parsed.map((line) => ({
      project_id: projectId,
      name: line.name,
      total_needed: line.qty,
      received: line.qty,
    }))
  );
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}`);
  revalidatePath(`/app/project/${projectId}/materials`);
}

export async function confirmExtractedMaterials(
  projectId: string,
  items: { code: string; description: string; size: string; qty: number }[],
  replaceExisting: boolean
) {
  // code/description/size are folded into one `name` — materials has no
  // dedicated code/size column, and the composed name (e.g. "36SQ10 Beam
  // 144\"") is what keeps two same-description-different-size lines (like
  // two beam lengths) distinguishable in the grid.
  const cleaned = items
    .map((item) => ({
      name: [item.code, item.description, item.size]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" "),
      qty: Math.round(Number(item.qty)),
    }))
    .filter(
      (item) => item.name.length > 0 && Number.isFinite(item.qty) && item.qty >= 0
    );
  if (cleaned.length === 0) {
    throw new Error("No valid material lines to add.");
  }

  const supabase = await createClient();

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
      total_needed: item.qty,
      received: item.qty,
    }))
  );
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}`);
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
  const supabase = await createClient();
  const { error } = await supabase
    .from("packing_slips")
    .insert({ project_id: projectId, storage_path: storagePath });
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}`);
  revalidatePath(`/app/project/${projectId}/materials`);
}
