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
