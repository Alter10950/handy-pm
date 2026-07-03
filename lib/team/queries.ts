import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ProfileRole } from "@/lib/supabase/database.types";

export interface TeamMember {
  id: string;
  email: string;
  fullName: string | null;
  role: ProfileRole;
  createdAt: string;
}

/**
 * Team members in the caller's own org. Profile rows come from the normal
 * cookie-scoped client (RLS's `profiles_select` policy already limits this
 * to `org_id = current_org_id()`); email addresses live in `auth.users`,
 * which RLS never exposes, so each member's email is looked up individually
 * via the service-role admin client — bounded by this org's own member
 * count, never a whole-instance user dump.
 */
export async function listTeamMembers(): Promise<TeamMember[]> {
  const supabase = await createClient();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const admin = createAdminClient();
  return Promise.all(
    profiles.map(async (profile) => {
      const { data, error: userError } = await admin.auth.admin.getUserById(
        profile.id
      );
      if (userError) throw userError;
      return {
        id: profile.id,
        email: data.user?.email ?? "(unknown)",
        fullName: profile.full_name,
        role: profile.role,
        createdAt: profile.created_at,
      };
    })
  );
}
