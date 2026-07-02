function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Playwright loads .env.local automatically via playwright.config.ts's dotenv import.`
    );
  }
  return value;
}

export const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
export const SUPABASE_ANON_KEY = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
export const SUPABASE_SERVICE_ROLE_KEY = requireEnv(
  "SUPABASE_SERVICE_ROLE_KEY"
);
export const SEED_OWNER_EMAIL =
  process.env.SEED_OWNER_EMAIL || "qa+owner@handyequip.test";
