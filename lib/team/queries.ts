import { cache } from "react";

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
// Wrapped in React `cache()` (Step 2b perf): the Projects and Dashboard
// pages each reach this three-plus times per render (directly, via
// listPmCandidates, and via listActiveProjectsForDashboard). cache()
// collapses those into ONE execution per request. And instead of an auth
// round-trip PER member (getUserById — the N+1 that made those pages
// slow), it now pulls the whole org's emails in ONE paginated listUsers()
// call and joins in memory.
export const listTeamMembers = cache(async (): Promise<TeamMember[]> => {
  const supabase = await createClient();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, crew_id, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (profiles.length === 0) return [];

  const admin = createAdminClient();
  // One call, not one-per-member. perPage covers any realistic org; a
  // second page is only paged in if the instance genuinely exceeds it.
  const usersById = new Map<
    string,
    { email?: string; banned_until?: string | null }
  >();
  let page = 1;
  const perPage = 1000;
  // Only page while a full page comes back (avoids an extra empty request
  // for the common single-page case).
  for (;;) {
    const { data, error: usersError } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (usersError) throw usersError;
    for (const u of data.users) {
      usersById.set(u.id, {
        email: u.email,
        banned_until: (u as { banned_until?: string | null }).banned_until,
      });
    }
    if (data.users.length < perPage) break;
    page += 1;
  }

  return profiles.map((profile) => {
    const u = usersById.get(profile.id);
    return {
      id: profile.id,
      email: u?.email ?? "(unknown)",
      fullName: profile.full_name,
      role: profile.role,
      crewId: profile.crew_id,
      isActive: isUserActive(u?.banned_until),
      createdAt: profile.created_at,
    };
  });
});

export interface PmCandidate {
  id: string;
  label: string;
}

// Owner/pm-role members, active only — the pool "PM of record" can be
// assigned to (Batch 4 Sub-phase B). Deactivated accounts are excluded
// so a project can't be handed to someone who can't sign back in.
export async function listPmCandidates(): Promise<PmCandidate[]> {
  const members = await listTeamMembers();
  return members
    .filter((m) => m.isActive && (m.role === "owner" || m.role === "pm"))
    .map((m) => ({ id: m.id, label: m.fullName || m.email }));
}
