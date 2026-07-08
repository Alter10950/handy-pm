"use server";

import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export interface ProjectSearchHit {
  id: string;
  name: string;
  status: string;
}

// Global search backing the ⌘K palette (Phase 16). RLS scopes to the
// caller's org; ilike is plenty at this fleet size (dozens of projects,
// not millions). Capped so the palette stays snappy.
export async function searchProjects(
  query: string
): Promise<ProjectSearchHit[]> {
  await requireOrg();
  const q = query.trim();
  const supabase = await createClient();
  let builder = supabase
    .from("projects")
    .select("id, name, status")
    .order("created_at", { ascending: false })
    .limit(8);
  if (q) builder = builder.ilike("name", `%${q}%`);
  const { data, error } = await builder;
  if (error) throw error;
  return data;
}
