import { createClient } from "@/lib/supabase/server";
import type { ProfileRole } from "@/lib/supabase/database.types";

export interface CallerContext {
  userId: string;
  orgId: string;
  role: ProfileRole;
}

/**
 * Resolves the caller's own org/role from the DB — never trusts anything
 * the client claims about itself — and throws a friendly error unless
 * they hold one of the allowed roles. RLS already enforces the real
 * security boundary on every table these actions touch; this is a
 * second, application-level gate so a disallowed attempt gets a clear
 * message instead of a raw Postgres RLS error, and so a future call site
 * that reaches for the service-role admin client can't accidentally skip
 * a check RLS itself wouldn't be able to catch.
 */
export async function requireRole(
  allowedRoles: readonly ProfileRole[]
): Promise<CallerContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();
  if (error) throw error;
  if (!profile.org_id) {
    throw new Error(
      "Your account isn't assigned to an organization yet. Ask an owner/PM to assign you one."
    );
  }
  if (!allowedRoles.includes(profile.role)) {
    throw new Error(
      "You don't have permission to do that — ask an owner or PM."
    );
  }
  return { userId: user.id, orgId: profile.org_id, role: profile.role };
}

/** Any signed-in, org-assigned user — no role restriction. */
export async function requireOrg(): Promise<{
  userId: string;
  orgId: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();
  if (error) throw error;
  if (!profile.org_id) {
    throw new Error(
      "Your account isn't assigned to an organization yet. Ask an owner/PM to assign you one."
    );
  }
  return { userId: user.id, orgId: profile.org_id };
}
