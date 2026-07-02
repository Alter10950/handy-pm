import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/supabase/database.types";
import { requireSupabaseEnv } from "@/lib/supabase/env";

/**
 * Browser Supabase client. Only construct this inside event handlers or
 * effects — never at module scope — so it's never evaluated during SSR/build.
 */
export function createClient() {
  return createBrowserClient<Database>(
    requireSupabaseEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireSupabaseEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );
}
