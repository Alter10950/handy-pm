"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { PhotoPhase, PhotoSource } from "@/lib/supabase/database.types";

// Matches share_tokens_write / approved_photos_write RLS exactly.
const PORTAL_EDITORS = ["owner", "pm"] as const;

export async function createShareToken(
  projectId: string,
  expiresInDays: number | null
): Promise<void> {
  await requireRole(PORTAL_EDITORS);
  const supabase = await createClient();
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const { error } = await supabase
    .from("share_tokens")
    .insert({ project_id: projectId, expires_at: expiresAt });
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}/portal`);
}

export async function revokeShareToken(
  tokenId: string,
  projectId: string
): Promise<void> {
  await requireRole(PORTAL_EDITORS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("share_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId);
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}/portal`);
}

export async function approvePhoto(
  projectId: string,
  storagePath: string,
  source: PhotoSource,
  caption: string | null,
  phase: PhotoPhase = "during"
): Promise<void> {
  const { userId } = await requireRole(PORTAL_EDITORS);
  const supabase = await createClient();
  const base = {
    project_id: projectId,
    storage_path: storagePath,
    source,
    caption: caption?.trim() || null,
    approved_by: userId,
  };
  const conflict = { onConflict: "project_id,storage_path" };
  const withPhase = await supabase
    .from("approved_photos")
    .upsert({ ...base, phase }, conflict);
  if (withPhase.error) {
    // phase column lands with the Phase 14 migration — retry without it
    // so approvals keep working pre-push (everything defaults 'during').
    if (!/phase/.test(withPhase.error.message)) throw withPhase.error;
    const { error } = await supabase
      .from("approved_photos")
      .upsert(base, conflict);
    if (error) throw error;
  }

  revalidatePath(`/app/project/${projectId}/portal`);
}

export async function unapprovePhoto(
  photoId: string,
  projectId: string
): Promise<void> {
  await requireRole(PORTAL_EDITORS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("approved_photos")
    .delete()
    .eq("id", photoId);
  if (error) throw error;

  revalidatePath(`/app/project/${projectId}/portal`);
}
