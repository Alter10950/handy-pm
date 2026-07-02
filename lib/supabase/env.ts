type SupabaseEnvVar =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY";

/**
 * Reads a required Supabase env var lazily (call-time, not module-load-time)
 * so importing this module never throws during `next build`'s static
 * rendering pass for routes that don't actually construct a client.
 *
 * Server-only. Next.js inlines `NEXT_PUBLIC_*` vars into the browser
 * bundle by statically replacing literal `process.env.NEXT_PUBLIC_X`
 * expressions at build time — `process.env[name]` (bracket/computed
 * access, what this function does) is not statically analyzable, so it
 * silently resolves to `undefined` in browser code. lib/supabase/client.ts
 * (the one browser consumer) must reference `process.env.NEXT_PUBLIC_X`
 * directly instead — see requireBrowserSupabaseEnv below.
 */
export function requireSupabaseEnv(name: SupabaseEnvVar): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.local.example to .env.local and fill in your Supabase project values.`
    );
  }
  return value;
}

/**
 * Validates a value already read via a static `process.env.NEXT_PUBLIC_X`
 * reference at the call site (required for Next.js's build-time inlining
 * to kick in — see requireSupabaseEnv's docstring). Safe to call from
 * browser code.
 */
export function requireBrowserSupabaseEnv(
  value: string | undefined,
  name: SupabaseEnvVar
): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.local.example to .env.local and fill in your Supabase project values.`
    );
  }
  return value;
}
