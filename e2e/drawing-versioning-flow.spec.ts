import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";

const PROJECT_NAME = `[E2E] Drawing versioning ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

test("drawing versioning: first upload auto-approves, a new version needs approval, warning banner, history log", async ({
  page,
}) => {
  const versionBadge = page.getByTestId("drawing-version-badge");

  await test.step("create project and upload the first drawing", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    await page.getByRole("link", { name: "Layout", exact: true }).click();
    // Not a bare input[type="file"] locator — the Overview page's own
    // lifecycle checklist has a hidden photo-attach file input that can
    // still be in the DOM mid-navigation, making that ambiguous/racy.
    await page
      .getByTestId("drawing-upload-input")
      .setInputFiles("e2e/fixtures/test-drawing.svg");
    await expect(page.getByText(/uploaded\.$/)).toBeVisible({
      timeout: 30_000,
    });

    // A brand-new page's first version is auto-approved (nothing yet to
    // review against) — no warning banner, badge reads "Approved."
    await expect(versionBadge).toHaveText("v1");
    await expect(page.getByText("Approved for install")).toBeVisible();
    await expect(page.getByText("Pending approval")).toHaveCount(0);
    await expect(
      page.getByText(/hasn.t been approved for install yet/)
    ).toHaveCount(0);
  });

  await test.step("uploading a new version supersedes v1 and needs approval", async () => {
    await page.getByRole("button", { name: "Upload new version" }).click();
    await page
      .getByTestId("drawing-version-upload-input")
      .setInputFiles("e2e/fixtures/test-drawing.svg");

    await expect(versionBadge).toHaveText("v2", { timeout: 15_000 });
    await expect(page.getByText("Pending approval")).toBeVisible();
    await expect(
      page.getByText(/hasn.t been approved for install yet/)
    ).toBeVisible();
  });

  await test.step("approving the latest version clears the warning", async () => {
    await page.getByRole("button", { name: "Approve for install" }).click();
    await expect(page.getByText("Approved for install")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText(/hasn.t been approved for install yet/)
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Approve for install" })
    ).toHaveCount(0);
  });

  await test.step("version history shows both versions", async () => {
    const history = page.locator('[data-testid^="drawing-history-"]');
    await expect(history.getByText("Version history (2)")).toBeVisible();
    await history.locator("summary").click();

    // String assertions on the raw text, not further getByText() locators —
    // "v1"/"v2" already collide with the badge above, so matching inside
    // this one already-scoped element avoids re-introducing that ambiguity.
    const text = await history.innerText();
    expect(text).toContain("v2");
    expect(text).toMatch(/v1.*superseded/);
  });
});
