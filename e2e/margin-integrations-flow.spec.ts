import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

// Batch 5 Sub-phase F: the integrations Settings panel (built to Connect,
// gated on credentials) and the owner-only per-project margin panel with
// manual quote entry. The quote save depends on the quote migration; the
// test tolerates either state.

const STAMP = Date.now();
const PROJECT_NAME = `[E2E] Margin ${STAMP}`;
let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

test("integrations: Settings shows QuickBooks + Zoho Connect (gated on credentials)", async ({
  page,
}) => {
  await page.goto("/app/settings");
  await expect(page.getByTestId("integration-quickbooks")).toBeVisible();
  await expect(page.getByTestId("integration-zoho")).toBeVisible();
  // Without app credentials, clicking Connect explains what's missing
  // rather than dead-ending.
  await page.getByTestId("integration-connect-quickbooks").click();
  await expect(page.getByText(/needs its app credentials/i)).toBeVisible({
    timeout: 5000,
  });
});

test("margin: owner sees the margin panel with manual quote entry", async ({
  page,
}) => {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .limit(1)
    .single();
  const { data: project, error } = await admin
    .from("projects")
    .insert({ org_id: org!.id, name: PROJECT_NAME, status: "active" })
    .select("id")
    .single();
  if (error) throw error;
  projectId = project.id;

  await page.goto(`/app/project/${projectId}/estimate`);
  await expect(page.getByText("Job cost & margin")).toBeVisible();

  const input = page.getByTestId("margin-quote-input");
  await input.fill("48000");
  await page.getByTestId("margin-quote-save").click();

  // Either the quote saved (migration applied) → the Quote stat shows it,
  // or a clear "needs the quote migration" message (guarded degrade).
  const savedOk = await page
    .getByText(/Quote saved/i)
    .isVisible({ timeout: 8000 })
    .catch(() => false);
  if (savedOk) {
    const { data } = await admin
      .from("projects")
      .select("quoted_amount")
      .eq("id", projectId!)
      .single();
    expect(Number(data?.quoted_amount)).toBe(48000);
  } else {
    await expect(page.getByText(/quote migration/i)).toBeVisible();
  }
});
