import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/lib/supabase/database.types";
import { requireSupabaseEnv } from "@/lib/supabase/env";

/**
 * Server Supabase client for Server Components, Route Handlers, and Server
 * Actions. Reads/writes the session via the request's cookies, so calling it
 * always touches `next/headers` cookies() first — which forces the calling
 * route segment to render dynamically instead of being statically generated
 * at build time.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    requireSupabaseEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireSupabaseEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component render — safe to ignore since
            // middleware refreshes the session on every request.
          }
        },
      },
    }
  );
}
