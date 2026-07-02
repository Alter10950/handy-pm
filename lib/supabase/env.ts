type SupabaseEnvVar =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY";

/**
 * Reads a required Supabase env var lazily (call-time, not module-load-time)
 * so importing this module never throws during `next build`'s static
 * rendering pass for routes that don't actually construct a client.
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
