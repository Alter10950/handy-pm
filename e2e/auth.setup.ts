import { test as setup } from "@playwright/test";

import { SEED_OWNER_EMAIL } from "./helpers/env";
import { createAdminClient } from "./helpers/supabase-admin";

const authFile = "e2e/.auth/owner.json";

// Signs in as the seeded owner WITHOUT depending on receiving a real
// email: admin.generateLink produces a one-time token_hash server-side,
// and the browser exchanges it via the app's real /auth/callback route
// (extended to accept token_hash, not just the PKCE `code` shape) — same
// code path a real magic-link click would hit, same cookies get set.
setup("authenticate as seeded owner", async ({ page }) => {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: SEED_OWNER_EMAIL,
  });
  if (error) throw error;

  const { hashed_token: tokenHash, verification_type: type } = data.properties;

  await page.goto(
    `/auth/callback?token_hash=${tokenHash}&type=${type}&next=/app`
  );
  await page.waitForURL("/app");

  await page.context().storageState({ path: authFile });
});
