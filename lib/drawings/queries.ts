import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

// Every version ever uploaded for one page, newest first — sub-phase 0's
// drawing_versions table had no application code reading it until this
// sub-phase (see docs/DECISIONS.md ADR-034).
export async function listDrawingVersions(
  projectId: string,
  pageIndex: number
): Promise<Tables<"drawing_versions">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drawing_versions")
    .select("*")
    .eq("project_id", projectId)
    .eq("page_index", pageIndex)
    .order("version", { ascending: false });
  if (error) throw error;
  return data;
}

// One query for every page's full version history, keyed by page_index —
// used by the marking workspace so every page tab can show its own version
// badge/warning without a per-tab round trip.
export async function listDrawingVersionsByProject(
  projectId: string
): Promise<Map<number, Tables<"drawing_versions">[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drawing_versions")
    .select("*")
    .eq("project_id", projectId)
    .order("version", { ascending: false });
  if (error) throw error;

  const byPage = new Map<number, Tables<"drawing_versions">[]>();
  for (const version of data) {
    const versions = byPage.get(version.page_index) ?? [];
    versions.push(version);
    byPage.set(version.page_index, versions);
  }
  return byPage;
}
