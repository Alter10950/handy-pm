"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

function revalidateProjectTabs(projectId: string) {
  revalidatePath(`/app/project/${projectId}`);
  revalidatePath(`/app/project/${projectId}/mark`);
  revalidatePath(`/app/project/${projectId}/materials`);
  revalidatePath(`/app/project/${projectId}/progress`);
}

// Minimal phase creation — enough for the Layout tab's "Set phase" command
// to work end to end before the full Phases sub-phase (colors on the
// drawing, legend, show/hide) lands on top of this same data.
export async function createPhase(
  projectId: string,
  name: string,
  color: string
): Promise<{ id: string }> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Phase name is required.");

  // Matches phases_write RLS exactly.
  await requireRole(["owner", "pm", "scheduler"]);

  const supabase = await createClient();
  const { data: existing, error: countError } = await supabase
    .from("phases")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (countError) throw countError;
  const nextSortOrder = (existing[0]?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("phases")
    .insert({
      project_id: projectId,
      name: trimmed,
      color,
      sort_order: nextSortOrder,
    })
    .select("id")
    .single();
  if (error) throw error;

  revalidateProjectTabs(projectId);
  return data;
}
