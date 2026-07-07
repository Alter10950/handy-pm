import { createClient } from "@/lib/supabase/server";

export * from "@/lib/handoff/shared";

export async function getHandoffSurvey(projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("handoff_surveys")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getSignedHandoffPhotoUrls(
  paths: string[]
): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const supabase = await createClient();
  const entries = await Promise.all(
    paths.map(async (path) => {
      const { data, error } = await supabase.storage
        .from("daily-photos")
        .createSignedUrl(path, 3600);
      if (error) throw error;
      return [path, data.signedUrl] as const;
    })
  );
  return Object.fromEntries(entries);
}
