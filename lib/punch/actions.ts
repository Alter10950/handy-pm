"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

function migrationPendingError(error: { code?: string; message: string }): Error {
  if (error.code === "PGRST205" || /punch_items/.test(error.message)) {
    return new Error(
      "The punch list isn't enabled yet — the Phase 14 database migration is pending."
    );
  }
  return new Error(error.message);
}

// Crew raises punch items from the field walkthrough; office too.
export async function createPunchItem(
  projectId: string,
  input: { title: string; detail?: string; rowId?: string | null; photoPath?: string | null }
) {
  const title = input.title.trim();
  if (!title) throw new Error("A punch item needs a title.");
  await requireRole(["owner", "pm", "scheduler", "crew"]);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("punch_items").insert({
    project_id: projectId,
    row_id: input.rowId ?? null,
    title,
    detail: input.detail?.trim() || null,
    photo_path: input.photoPath ?? null,
    created_by: user?.id ?? null,
  });
  if (error) throw migrationPendingError(error);

  revalidatePath(`/app/project/${projectId}/progress`);
  revalidatePath(`/field/${projectId}`);
}

export async function setPunchItemStatus(
  projectId: string,
  punchItemId: string,
  status: "open" | "done"
) {
  await requireRole(["owner", "pm", "scheduler", "crew"]);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("punch_items")
    .update(
      status === "done"
        ? { status, resolved_by: user?.id ?? null, resolved_at: new Date().toISOString() }
        : { status, resolved_by: null, resolved_at: null }
    )
    .eq("id", punchItemId);
  if (error) throw migrationPendingError(error);

  revalidatePath(`/app/project/${projectId}/progress`);
  revalidatePath(`/field/${projectId}`);
}
