import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseEnv } from "@/lib/supabase/env";

/**
 * Admin Supabase client using the service role key, which bypasses Row Level
 * Security. Server-only — never import this from a Client Component, and
 * never send SUPABASE_SERVICE_ROLE_KEY to the browser. Not yet used in
 * Phase 1; reserved for trusted backend operations in later phases.
 */
export function createAdminClient() {
  return createSupabaseClient(
    requireSupabaseEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireSupabaseEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
