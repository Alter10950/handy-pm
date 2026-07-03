"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export interface RowGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

function revalidateProjectTabs(projectId: string) {
  revalidatePath(`/app/project/${projectId}`);
  revalidatePath(`/app/project/${projectId}/mark`);
  revalidatePath(`/app/project/${projectId}/materials`);
  revalidatePath(`/app/project/${projectId}/progress`);
}

export async function createRow(
  projectId: string,
  drawingId: string,
  label: string,
  geometry: RowGeometry
): Promise<{ id: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rows")
    .insert({
      project_id: projectId,
      drawing_id: drawingId,
      label,
      ...geometry,
    })
    .select("id")
    .single();
  if (error) throw error;

  revalidateProjectTabs(projectId);
  return data;
}

export async function createRowsBatch(
  projectId: string,
  drawingId: string,
  rows: { label: string; geometry: RowGeometry }[]
): Promise<void> {
  if (rows.length === 0) return;

  const supabase = await createClient();
  const { error } = await supabase.from("rows").insert(
    rows.map((row) => ({
      project_id: projectId,
      drawing_id: drawingId,
      label: row.label,
      ...row.geometry,
    }))
  );
  if (error) throw error;

  revalidateProjectTabs(projectId);
}

export async function updateRowGeometry(
  rowId: string,
  projectId: string,
  geometry: RowGeometry
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("rows")
    .update(geometry)
    .eq("id", rowId);
  if (error) throw error;

  revalidateProjectTabs(projectId);
}

export async function renameRow(
  rowId: string,
  projectId: string,
  label: string
): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Row name is required.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("rows")
    .update({ label: trimmed })
    .eq("id", rowId);
  if (error) throw error;

  revalidateProjectTabs(projectId);
}

export async function deleteRow(
  rowId: string,
  projectId: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("rows").delete().eq("id", rowId);
  if (error) throw error;

  revalidateProjectTabs(projectId);
}

export async function upsertRowMaterialQty(
  rowId: string,
  materialId: string,
  projectId: string,
  requiredQty: number
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("row_materials").upsert(
    {
      row_id: rowId,
      material_id: materialId,
      required_qty: Math.max(0, requiredQty),
    },
    { onConflict: "row_id,material_id" }
  );
  if (error) throw error;

  revalidateProjectTabs(projectId);
}

/**
 * Sets the same required_qty for every (row, material) pair in the cross
 * product of rowIds x materialQtys — one upsert covering every selected
 * row at once, rather than N x M individual round trips. Uses the same
 * RLS-scoped client and onConflict target as the single-cell upsert above,
 * so it's subject to the exact same row_materials_write policy.
 */
export async function upsertRowMaterialQtyBulk(
  projectId: string,
  rowIds: string[],
  materialQtys: { materialId: string; requiredQty: number }[]
): Promise<void> {
  if (rowIds.length === 0 || materialQtys.length === 0) return;

  const supabase = await createClient();
  const upserts = rowIds.flatMap((rowId) =>
    materialQtys.map((entry) => ({
      row_id: rowId,
      material_id: entry.materialId,
      required_qty: Math.max(0, entry.requiredQty),
    }))
  );

  const { error } = await supabase
    .from("row_materials")
    .upsert(upserts, { onConflict: "row_id,material_id" });
  if (error) throw error;

  revalidateProjectTabs(projectId);
}

/**
 * Creates one or more new rows and, optionally, copies the source row's
 * current row_materials onto every copy. Two round trips (insert rows,
 * then read + insert row_materials) rather than one, since Postgres needs
 * the new rows' generated ids before row_materials can reference them.
 */
export async function duplicateRows(
  projectId: string,
  drawingId: string,
  sourceRowId: string,
  newRows: { label: string; geometry: RowGeometry }[],
  copyMaterials: boolean
): Promise<void> {
  if (newRows.length === 0) return;

  const supabase = await createClient();
  const { data: inserted, error } = await supabase
    .from("rows")
    .insert(
      newRows.map((row) => ({
        project_id: projectId,
        drawing_id: drawingId,
        label: row.label,
        ...row.geometry,
      }))
    )
    .select("id");
  if (error) throw error;

  if (copyMaterials) {
    const { data: sourceMaterials, error: sourceError } = await supabase
      .from("row_materials")
      .select("material_id, required_qty")
      .eq("row_id", sourceRowId);
    if (sourceError) throw sourceError;

    if (sourceMaterials.length > 0) {
      const { error: copyError } = await supabase.from("row_materials").insert(
        inserted.flatMap((newRow) =>
          sourceMaterials.map((material) => ({
            row_id: newRow.id,
            material_id: material.material_id,
            required_qty: material.required_qty,
          }))
        )
      );
      if (copyError) throw copyError;
    }
  }

  revalidateProjectTabs(projectId);
}
