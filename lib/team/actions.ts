"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ProfileRole } from "@/lib/supabase/database.types";

const ASSIGNABLE_ROLES: readonly ProfileRole[] = [
  "owner",
  "pm",
  "scheduler",
  "crew",
];

function parseRole(value: FormDataEntryValue | null): ProfileRole {
  const role = String(value ?? "");
  if (!ASSIGNABLE_ROLES.includes(role as ProfileRole)) {
    throw new Error("Invalid role.");
  }
  return role as ProfileRole;
}

/**
 * Every mutation below re-derives the caller's role from the DB, never
 * trusting anything the client claims about itself — the admin client used
 * for user creation/password resets bypasses RLS entirely, so this check is
 * the only gate standing between "any signed-in user" and "team management."
 */
async function requireOwnerOrPm(): Promise<{ userId: string; orgId: string }> {
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
    throw new Error("Your account isn't assigned to an organization yet.");
  }
  if (profile.role !== "owner" && profile.role !== "pm") {
    throw new Error("Only an owner or PM can manage team members.");
  }
  return { userId: user.id, orgId: profile.org_id };
}

export async function createTeamMember(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = parseRole(formData.get("role"));

  if (!email) throw new Error("Email is required.");
  if (password.length < 8) {
    throw new Error("Temporary password must be at least 8 characters.");
  }

  const { orgId } = await requireOwnerOrPm();

  const admin = createAdminClient();
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
  if (createError) throw createError;

  // The handle_new_user trigger already inserted a profile row (org_id
  // null, role 'crew') — overwrite it with the org/role picked here. RLS
  // would block this update (the row's pre-update org_id is null, so
  // `profiles_update`'s `using` clause never matches), which is exactly why
  // this step needs the admin client, not the caller's own session.
  const { error: profileError } = await admin
    .from("profiles")
    .update({ org_id: orgId, role, full_name: fullName || null })
    .eq("id", created.user.id);
  if (profileError) throw profileError;

  revalidatePath("/app/team");
}

export async function updateTeamMemberRole(formData: FormData) {
  const memberId = String(formData.get("member_id") ?? "");
  const role = parseRole(formData.get("role"));
  if (!memberId) throw new Error("Missing member id.");

  const { userId } = await requireOwnerOrPm();
  if (memberId === userId) {
    throw new Error("You can't change your own role here.");
  }

  // A normal role change (not a fresh org_id assignment) is exactly what
  // profiles_update's RLS policy already allows an owner/pm to do directly
  // — .select().single() turns "RLS silently matched zero rows" (wrong org,
  // or a bad id) into a thrown error instead of a no-op that looks like success.
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", memberId)
    .select("id")
    .single();
  if (error) throw error;

  revalidatePath("/app/team");
}

// updateUserById uses the admin client, which bypasses RLS entirely — so
// unlike a plain profiles update, org membership has to be checked by hand
// before ever touching auth.users, or an owner/pm could act on a user in a
// different org by guessing/knowing their id. Shared by every action below
// that goes through the admin client.
async function requireMemberInOrg(memberId: string, orgId: string) {
  const supabase = await createClient();
  const { data: target, error } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw error;
  if (!target || target.org_id !== orgId) {
    throw new Error("That team member wasn't found in your organization.");
  }
}

export async function resetTeamMemberPassword(formData: FormData) {
  const memberId = String(formData.get("member_id") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!memberId) throw new Error("Missing member id.");
  if (password.length < 8) {
    throw new Error("Temporary password must be at least 8 characters.");
  }

  const { orgId } = await requireOwnerOrPm();
  await requireMemberInOrg(memberId, orgId);

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(memberId, {
    password,
  });
  if (error) throw error;

  revalidatePath("/app/team");
}

// Deactivating never deletes anything — it sets a very long Supabase Auth
// ban (their existing profile/history stays put), reactivating clears it.
// Already-issued access tokens can keep working for up to their natural
// ~1h expiry; this blocks sign-in and token refresh from that point on,
// it isn't an instant kill-switch on an active session.
const PERMANENT_BAN_DURATION = "876000h"; // ~100 years

export async function setTeamMemberActive(formData: FormData) {
  const memberId = String(formData.get("member_id") ?? "");
  const active = formData.get("active") === "true";
  if (!memberId) throw new Error("Missing member id.");

  const { userId, orgId } = await requireOwnerOrPm();
  if (memberId === userId) {
    throw new Error("You can't deactivate your own account here.");
  }
  await requireMemberInOrg(memberId, orgId);

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(memberId, {
    ban_duration: active ? "none" : PERMANENT_BAN_DURATION,
  });
  if (error) throw error;

  revalidatePath("/app/team");
}
