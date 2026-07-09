import { createClient } from "@supabase/supabase-js";

import type { Database } from "../../lib/supabase/database.types";
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from "./env";

// Service-role client for E2E setup/teardown (generating admin sign-in
// links, seeding, and cleaning up test data). Bypasses RLS — Node-only,
// never imported into anything that ships to the browser.
export function createAdminClient() {
  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// The seeded QA owner, resolved by email — deterministic even when stale
// owner-role profiles from prior runs linger in the shared DB (a plain
// `profiles where role='owner' limit 1` is NOT safe there). Returns the
// auth user id + org_id the E2E session actually authenticates as.
export async function getSeededOwner(): Promise<{ id: string; org_id: string }> {
  const admin = createAdminClient();
  const email = process.env.SEED_OWNER_EMAIL || "qa+owner@handyequip.test";
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`Seeded owner ${email} not found — run npm run seed.`);
  const { data: profile } = await admin
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();
  return { id: user.id, org_id: profile!.org_id as string };
}
