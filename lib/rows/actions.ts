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
