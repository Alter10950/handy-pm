import { test as setup, expect } from "@playwright/test";

import { SEED_OWNER_EMAIL, SEED_OWNER_PASSWORD } from "./helpers/env";

const authFile = "e2e/.auth/owner.json";

// Signs in through the real login form — email+password auth doesn't need
// the admin-generated token_hash dance the old magic-link flow required,
// so this now also exercises the actual sign-in UI a real user goes
// through, not just a backdoor into a session.
setup("authenticate as seeded owner", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(SEED_OWNER_EMAIL);
  await page.getByLabel("Password").fill(SEED_OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("/app");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
