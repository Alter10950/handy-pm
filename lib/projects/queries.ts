import { createClient } from "@/lib/supabase/server";
import type { Tables, Views } from "@/lib/supabase/database.types";

/**
 * Read-only data access for the Projects area. Every query relies on RLS
 * to scope results to the caller's org — nothing here filters by org_id
 * manually. Server-only (uses the cookie-based server Supabase client).
 */

export async function listProjectsWithProgress(): Promise<
  Views<"project_progress">[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_progress")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getProject(
  id: string
): Promise<Tables<"projects"> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProjectProgress(
  id: string
): Promise<Views<"project_progress"> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_progress")
    .select("*")
    .eq("project_id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listDrawings(
  projectId: string
): Promise<Tables<"drawings">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drawings")
    .select("*")
    .eq("project_id", projectId)
    .order("page_index", { ascending: true });
  if (error) throw error;
  return data;
}

export async function listMaterials(
  projectId: string
): Promise<Tables<"materials">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("materials")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function listPackingSlips(
  projectId: string
): Promise<Tables<"packing_slips">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("packing_slips")
    .select("*")
    .eq("project_id", projectId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function listRows(projectId: string): Promise<Tables<"rows">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rows")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function listRowMaterials(
  rowIds: string[]
): Promise<Tables<"row_materials">[]> {
  if (rowIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("row_materials")
    .select("*")
    .in("row_id", rowIds);
  if (error) throw error;
  return data;
}

export async function listRowProgress(
  projectId: string
): Promise<Views<"row_progress">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("row_progress")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at");
  if (error) throw error;
  return data;
}

export async function listMaterialReconciliation(
  projectId: string
): Promise<Views<"material_reconciliation">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("material_reconciliation")
    .select("*")
    .eq("project_id", projectId);
  if (error) throw error;
  return data;
}

export async function getSignedDrawingUrl(
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("drawings")
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function getSignedPackingSlipUrl(
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("packing-slips")
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
