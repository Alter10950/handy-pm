import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ProfileRole } from "@/lib/supabase/database.types";

export interface TeamMember {
  id: string;
  email: string;
  fullName: string | null;
  role: ProfileRole;
  crewId: string | null;
  isActive: boolean;
  createdAt: string;
}

// Supabase never fully "unsets" a lifted ban — updateUserById('none') just
// resets banned_until to a value at or before now, so an expired/past ban
// date also counts as active, not just an absent one.
function isUserActive(bannedUntil: string | null | undefined): boolean {
  if (!bannedUntil) return true;
  return new Date(bannedUntil).getTime() <= Date.now();
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
    .select("id, full_name, role, crew_id, created_at")
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
        crewId: profile.crew_id,
        isActive: isUserActive(data.user?.banned_until),
        createdAt: profile.created_at,
      };
    })
  );
}
