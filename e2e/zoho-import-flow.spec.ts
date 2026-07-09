import { expect, test } from "@playwright/test";

// Batch 5 Sub-phase G: the "Import from Zoho" entry point. Without a Zoho
// connection (the default on this project) it points to Settings rather
// than dead-ending, and manual project creation is untouched. The live
// deal import + stage push-back need a real Zoho connection to verify
// (NEEDS-YOU).

test("import from Zoho: gated to a connect prompt when not connected", async ({
  page,
}) => {
  await page.goto("/app");
  await expect(page.getByTestId("import-from-zoho")).toBeVisible();
  // Manual creation is still right there.
  await expect(
    page.getByRole("button", { name: "+ New project" })
  ).toBeVisible();

  await page.getByTestId("import-from-zoho").click();
  await expect(page.getByText(/Zoho isn't connected yet/i)).toBeVisible({
    timeout: 8000,
  });
  await expect(
    page.getByRole("link", { name: "Settings → Integrations" })
  ).toBeVisible();
});
