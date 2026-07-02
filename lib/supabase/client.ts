import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/supabase/database.types";
import { requireBrowserSupabaseEnv } from "@/lib/supabase/env";

/**
 * Browser Supabase client. Only construct this inside event handlers or
 * effects — never at module scope — so it's never evaluated during SSR/build.
 *
 * Reads `process.env.NEXT_PUBLIC_X` via static dot-notation directly
 * (rather than through a name-parameterized helper) so Next.js's bundler
 * can inline the values into the browser bundle at build time — see
 * lib/supabase/env.ts's docstring for why the bracket-indexed form
 * silently breaks this.
 */
export function createClient() {
  return createBrowserClient<Database>(
    requireBrowserSupabaseEnv(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      "NEXT_PUBLIC_SUPABASE_URL"
    ),
    requireBrowserSupabaseEnv(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    )
  );
}
