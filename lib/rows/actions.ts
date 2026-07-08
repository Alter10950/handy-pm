"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

// Matches rows_write / row_materials_write RLS exactly (crew reads rows
// but never writes them).
const ROW_EDITORS = ["owner", "pm"] as const;

export interface RowGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

// A full row snapshot — everything needed to re-create an identical row
// (same id, so anything referencing it keeps working) after a delete, or
// to re-insert on redo after an undo. Explicit ids are inserted rather
// than left to the column default specifically so undo/redo round trips
// don't churn through new ids on every cycle.
export interface RowSnapshot {
  id: string;
  drawingId: string;
  label: string;
  geometry: RowGeometry;
  phaseId: string | null;
  materials: { materialId: string; requiredQty: number }[];
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
  geometry: RowGeometry,
  id?: string
): Promise<{ id: string }> {
  await requireRole(ROW_EDITORS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rows")
    .insert({
      ...(id ? { id } : {}),
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
  rows: { id?: string; label: string; geometry: RowGeometry }[]
): Promise<{ id: string; label: string; geometry: RowGeometry }[]> {
  if (rows.length === 0) return [];
  await requireRole(ROW_EDITORS);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rows")
    .insert(
      rows.map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        project_id: projectId,
        drawing_id: drawingId,
        label: row.label,
        ...row.geometry,
      }))
    )
    .select("id, label, x, y, w, h");
  if (error) throw error;

  revalidateProjectTabs(projectId);
  return data.map((row) => ({
    id: row.id,
    label: row.label,
    geometry: { x: row.x, y: row.y, w: row.w, h: row.h },
  }));
}

export async function updateRowGeometry(
  rowId: string,
  projectId: string,
  geometry: RowGeometry
): Promise<void> {
  await requireRole(ROW_EDITORS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("rows")
    .update(geometry)
    .eq("id", rowId);
  if (error) throw error;

  revalidateProjectTabs(projectId);
}

export interface RowReadinessInputs {
  materialsReady?: boolean;
  areaAccessible?: boolean;
  drawingApproved?: boolean;
}

// Sets the three manual readiness inputs row_progress.readiness_status is
// computed from (crew_assigned is the fourth input, but it's derived from
// assignments, not settable here). Batch 3 sub-phase 0 added these
// columns; this is the first application code to actually write them.
export async function updateRowReadiness(
  rowId: string,
  projectId: string,
  inputs: RowReadinessInputs
): Promise<void> {
  await requireRole(ROW_EDITORS);
  const supabase = await createClient();
  const patch: {
    materials_ready?: boolean;
    area_accessible?: boolean;
    drawing_approved?: boolean;
  } = {};
  if (inputs.materialsReady !== undefined)
    patch.materials_ready = inputs.materialsReady;
  if (inputs.areaAccessible !== undefined)
    patch.area_accessible = inputs.areaAccessible;
  if (inputs.drawingApproved !== undefined)
    patch.drawing_approved = inputs.drawingApproved;
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase.from("rows").update(patch).eq("id", rowId);
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
  await requireRole(ROW_EDITORS);

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
  await requireRole(ROW_EDITORS);
  const supabase = await createClient();
  const { error } = await supabase.from("rows").delete().eq("id", rowId);
  if (error) throw error;

  revalidateProjectTabs(projectId);
}

export async function deleteRowsBatch(
  rowIds: string[],
  projectId: string
): Promise<void> {
  if (rowIds.length === 0) return;
  await requireRole(ROW_EDITORS);
  const supabase = await createClient();
  const { error } = await supabase.from("rows").delete().in("id", rowIds);
  if (error) throw error;

  revalidateProjectTabs(projectId);
}

// Reads everything needed to restore these rows later (undo-of-delete) —
// call BEFORE deleting them.
export async function getRowSnapshots(
  rowIds: string[]
): Promise<RowSnapshot[]> {
  if (rowIds.length === 0) return [];
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("rows")
    .select("id, drawing_id, label, x, y, w, h, phase_id")
    .in("id", rowIds);
  if (error) throw error;

  const { data: materials, error: materialsError } = await supabase
    .from("row_materials")
    .select("row_id, material_id, required_qty")
    .in("row_id", rowIds);
  if (materialsError) throw materialsError;

  return rows.map((row) => ({
    id: row.id,
    drawingId: row.drawing_id,
    label: row.label,
    geometry: { x: row.x, y: row.y, w: row.w, h: row.h },
    phaseId: row.phase_id,
    materials: materials
      .filter((m) => m.row_id === row.id)
      .map((m) => ({ materialId: m.material_id, requiredQty: m.required_qty })),
  }));
}

// Re-inserts rows from a snapshot (undo-of-delete, or redo-of-create after
// an undo deleted them) — same ids, same geometry/phase, same materials.
export async function restoreRows(
  projectId: string,
  snapshots: RowSnapshot[]
): Promise<void> {
  if (snapshots.length === 0) return;
  await requireRole(ROW_EDITORS);
  const supabase = await createClient();

  const { error } = await supabase.from("rows").insert(
    snapshots.map((s) => ({
      id: s.id,
      project_id: projectId,
      drawing_id: s.drawingId,
      label: s.label,
      phase_id: s.phaseId,
      ...s.geometry,
    }))
  );
  if (error) throw error;

  const materialRows = snapshots.flatMap((s) =>
    s.materials.map((m) => ({
      row_id: s.id,
      material_id: m.materialId,
      required_qty: m.requiredQty,
    }))
  );
  if (materialRows.length > 0) {
    const { error: materialsError } = await supabase
      .from("row_materials")
      .insert(materialRows);
    if (materialsError) throw materialsError;
  }

  revalidateProjectTabs(projectId);
}

export async function upsertRowMaterialQty(
  rowId: string,
  materialId: string,
  projectId: string,
  requiredQty: number
): Promise<void> {
  await requireRole(ROW_EDITORS);
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

// Reads the current required_qty for a specific set of (row, material)
// pairs — 0 for any pair with no existing row_materials row. Used to
// capture "before" values ahead of a bulk change, for undo.
export async function getRowMaterialQtys(
  pairs: { rowId: string; materialId: string }[]
): Promise<{ rowId: string; materialId: string; requiredQty: number }[]> {
  if (pairs.length === 0) return [];
  const supabase = await createClient();
  const rowIds = [...new Set(pairs.map((p) => p.rowId))];
  const materialIds = [...new Set(pairs.map((p) => p.materialId))];

  const { data, error } = await supabase
    .from("row_materials")
    .select("row_id, material_id, required_qty")
    .in("row_id", rowIds)
    .in("material_id", materialIds);
  if (error) throw error;

  const existing = new Map(
    data.map((row) => [`${row.row_id}:${row.material_id}`, row.required_qty])
  );
  return pairs.map((pair) => ({
    ...pair,
    requiredQty: existing.get(`${pair.rowId}:${pair.materialId}`) ?? 0,
  }));
}

/**
 * Upserts an arbitrary list of (row, material, qty) triples in one round
 * trip — not a uniform cross product like an earlier version of this
 * function, deliberately: undo needs to restore each (row, material) pair
 * to whatever its OWN "before" value was, which can differ per row, so
 * the caller expands "apply this qty to every selected row" into explicit
 * triples itself (and undo/redo pass their own captured before/after
 * triples straight through). Same RLS-scoped client and onConflict target
 * as the single-cell upsert above.
 */
export async function upsertRowMaterialQtyMany(
  projectId: string,
  entries: { rowId: string; materialId: string; requiredQty: number }[]
): Promise<void> {
  if (entries.length === 0) return;
  await requireRole(ROW_EDITORS);

  const supabase = await createClient();
  const { error } = await supabase.from("row_materials").upsert(
    entries.map((entry) => ({
      row_id: entry.rowId,
      material_id: entry.materialId,
      required_qty: Math.max(0, entry.requiredQty),
    })),
    { onConflict: "row_id,material_id" }
  );
  if (error) throw error;

  revalidateProjectTabs(projectId);
}

export async function setRowsPhase(
  projectId: string,
  rowIds: string[],
  phaseId: string | null
): Promise<void> {
  if (rowIds.length === 0) return;
  await requireRole(ROW_EDITORS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("rows")
    .update({ phase_id: phaseId })
    .in("id", rowIds);
  if (error) throw error;

  revalidateProjectTabs(projectId);
}

// Reads current phase_id for a set of rows — used to capture "before"
// values ahead of a bulk phase change, for undo.
export async function getRowPhases(
  rowIds: string[]
): Promise<{ rowId: string; phaseId: string | null }[]> {
  if (rowIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rows")
    .select("id, phase_id")
    .in("id", rowIds);
  if (error) throw error;
  return data.map((row) => ({ rowId: row.id, phaseId: row.phase_id }));
}

/**
 * Creates one or more new rows and, optionally, copies the source row's
 * current row_materials onto every copy. Two round trips (insert rows,
 * then read + insert row_materials) rather than one, since Postgres needs
 * the new rows' generated ids before row_materials can reference them.
 * Returns each new row's full data (including any copied materials) so
 * the caller can build an undo (delete these ids) / redo (re-insert this
 * exact snapshot) pair without a further round trip.
 */
export async function duplicateRows(
  projectId: string,
  drawingId: string,
  sourceRowId: string,
  newRows: { label: string; geometry: RowGeometry }[],
  copyMaterials: boolean
): Promise<RowSnapshot[]> {
  if (newRows.length === 0) return [];
  await requireRole(ROW_EDITORS);

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
    .select("id, label, x, y, w, h, phase_id");
  if (error) throw error;

  let sourceMaterials: { material_id: string; required_qty: number }[] = [];
  if (copyMaterials) {
    const { data, error: sourceError } = await supabase
      .from("row_materials")
      .select("material_id, required_qty")
      .eq("row_id", sourceRowId);
    if (sourceError) throw sourceError;
    sourceMaterials = data;

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
  return inserted.map((row) => ({
    id: row.id,
    drawingId,
    label: row.label,
    geometry: { x: row.x, y: row.y, w: row.w, h: row.h },
    phaseId: row.phase_id,
    materials: sourceMaterials.map((m) => ({
      materialId: m.material_id,
      requiredQty: m.required_qty,
    })),
  }));
}
