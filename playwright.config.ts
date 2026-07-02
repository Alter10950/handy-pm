import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Playwright's own process (config + test files that talk to Supabase
// directly, e.g. e2e/auth.setup.ts) doesn't get .env.local for free the
// way Next.js does — load it explicitly. The webServer child process
// (next dev) loads it itself regardless.
loadEnv({ path: ".env.local" });

// Next.js allows only one `next dev` instance per project directory (it
// locks .next/dev/). Rather than fight that, target the same port a
// manually-started `npm run dev` would use in this project — Playwright's
// reuseExistingServer detects it's already up and skips spawning a
// second, conflicting instance. Override with E2E_PORT if 3001 is busy
// with something unrelated.
const PORT = Number(process.env.E2E_PORT) || 3001;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/owner.json",
      },
      dependencies: ["setup"],
    },
  ],

  // Runs against the real Supabase project (via .env.local), not a mock —
  // see docs/DECISIONS.md for why. next dev, not a production build, since
  // this suite verifies functional flows, not performance.
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
