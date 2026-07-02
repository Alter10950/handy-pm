// Idempotent seed script for local/E2E verification. Ensures:
//   1. An organization named "Handy Equip" exists (creating it if this is
//      the very first org — see docs/DECISIONS.md for the consequence
//      that has for whoever's real first sign-in comes after this runs).
//   2. A confirmed, passwordless test user exists (SEED_OWNER_EMAIL,
//      default qa+owner@handyequip.test — the .test TLD is IANA-reserved
//      for exactly this purpose, so it can never collide with a real
//      domain).
//   3. That user's profile is set to org "Handy Equip", role "owner",
//      regardless of what the auth-bootstrap trigger initially assigned.
//
// Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in the
// environment (never hard-coded). Run with:
//   node --env-file=.env.local scripts/seed.mjs

import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Run with --env-file=.env.local or export it first.`
    );
  }
  return value;
}

const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const SEED_OWNER_EMAIL =
  process.env.SEED_OWNER_EMAIL || "qa+owner@handyequip.test";
const ORG_NAME = "Handy Equip";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function ensureOrg() {
  const { data: existing, error } = await admin
    .from("organizations")
    .select("id, name")
    .limit(1);
  if (error) throw error;

  if (existing.length > 0) {
    const org = existing[0];
    if (org.name !== ORG_NAME) {
      const { error: updateError } = await admin
        .from("organizations")
        .update({ name: ORG_NAME })
        .eq("id", org.id);
      if (updateError) throw updateError;
    }
    return { id: org.id, created: false };
  }

  const { data: created, error: insertError } = await admin
    .from("organizations")
    .insert({ name: ORG_NAME })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return { id: created.id, created: true };
}

async function findUserByEmail(email) {
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((user) => user.email === email);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
}

async function ensureUser() {
  const existing = await findUserByEmail(SEED_OWNER_EMAIL);
  if (existing) return { user: existing, created: false };

  const { data, error } = await admin.auth.admin.createUser({
    email: SEED_OWNER_EMAIL,
    email_confirm: true,
    user_metadata: { seed: true },
  });
  if (error) throw error;
  return { user: data.user, created: true };
}

async function ensureProfile(userId, orgId) {
  const { error } = await admin
    .from("profiles")
    .update({ org_id: orgId, role: "owner" })
    .eq("id", userId);
  if (error) throw error;
}

async function main() {
  const org = await ensureOrg();
  const { user, created: userCreated } = await ensureUser();
  await ensureProfile(user.id, org.id);

  console.log(
    JSON.stringify(
      {
        org: { id: org.id, name: ORG_NAME, created: org.created },
        user: { id: user.id, email: SEED_OWNER_EMAIL, created: userCreated },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
