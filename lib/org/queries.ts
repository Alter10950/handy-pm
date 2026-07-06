import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export async function getOrgSettings(): Promise<Tables<"organizations"> | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.org_id) return null;

  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", profile.org_id)
    .single();
  if (error) throw error;
  return data;
}

export async function getSignedOrgLogoUrl(
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("org-logos")
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
