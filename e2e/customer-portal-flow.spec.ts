import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const PROJECT_NAME = `[E2E] Customer portal ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

test("customer portal: generate a link, approve a photo, public page shows only safe data, revoke invalidates it", async ({
  page,
}) => {
  const admin = createAdminClient();

  await test.step("create a project", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];
  });

  await test.step("seed a day-log update + photo, and a material shortage that must never leak", async () => {
    // A tiny synthetic image via a throwaway page's own screenshot — same
    // technique as team-settings-flow.spec.ts's logo upload — uploaded
    // directly to storage (not through a file-input UI, since this test
    // seeds field data the way an admin script would, not through Field).
    const imagePage = await page.context().newPage();
    await imagePage.setContent(
      `<html><body style="margin:0;width:200px;height:200px;background:#22c55e;"></body></html>`
    );
    const buffer = await imagePage.screenshot();
    await imagePage.close();

    const photoPath = `${projectId}/e2e-day-log-photo.png`;
    const { error: uploadError } = await admin.storage
      .from("daily-photos")
      .upload(photoPath, buffer, { contentType: "image/png" });
    if (uploadError) throw uploadError;

    const { error: dayLogError } = await admin.from("day_logs").insert({
      project_id: projectId!,
      work_date: new Date().toISOString().slice(0, 10),
      note: "Finished installing the first two rows today.",
      photo_paths: [photoPath],
    });
    if (dayLogError) throw dayLogError;

    // Never allowed to reach the portal — asserted absent later.
    const { error: materialError } = await admin.from("materials").insert({
      project_id: projectId!,
      name: "Secret Shortage Beam",
      total_needed: 100,
      received: 10,
    });
    if (materialError) throw materialError;
  });

  await test.step("generate a share link from the Portal tab", async () => {
    await page.getByRole("link", { name: "Portal" }).click();
    await page.getByRole("button", { name: "+ Generate link" }).click();
    // Scoped to the token's own row, not a bare getByText("active") — the
    // project header's own status pill also renders "Active" (properly
    // capitalized there, unlike this badge's lowercase text + CSS
    // `capitalize`), so an unscoped match would be ambiguous/wrong.
    const tokenRow = page.locator("li").filter({ hasText: "/portal/" });
    await expect(tokenRow.getByText("active", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step("approve the day-log photo for customer visibility", async () => {
    await expect(page.getByText(/Day log —/)).toBeVisible();
    await page.getByRole("button", { name: "Show to customer" }).click();
    await expect(page.getByText("Visible to customer")).toBeVisible({
      timeout: 10_000,
    });
  });

  let token = "";

  await test.step("public portal page shows only safe data", async () => {
    const { data } = await admin
      .from("share_tokens")
      .select("token")
      .eq("project_id", projectId!)
      .single();
    token = data!.token;

    await page.goto(`/portal/${token}`);
    await expect(page.getByRole("heading", { name: PROJECT_NAME })).toBeVisible();
    await expect(page.getByText("In progress")).toBeVisible();
    await expect(
      page.getByText("Finished installing the first two rows today.")
    ).toBeVisible();
    await expect(page.getByRole("img", { name: /photo/i })).toBeVisible();

    // Never leaks: material names, shortage figures, internal terminology.
    await expect(page.getByText("Secret Shortage Beam")).toHaveCount(0);
    await expect(page.getByText(/to order/i)).toHaveCount(0);
    await expect(page.getByText(/reconciliation/i)).toHaveCount(0);
  });

  await test.step("revoking the link makes it show the friendly invalid page", async () => {
    await page.goto(`/app/project/${projectId}/portal`);

    // ShareLinkPanel's handleRevoke calls window.confirm() synchronously,
    // no preceding await — the same dialog shape documented in ADR-034;
    // register the listener before the click rather than Promise.all-ing
    // it with the click itself.
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Revoke" }).click();
    // The badge's own text node is the lowercase status string ("revoked")
    // — a plain CSS `capitalize` class renders it visually as "Revoked"
    // but doesn't change the actual DOM text content getByText matches.
    const tokenRow = page.locator("li").filter({ hasText: "/portal/" });
    await expect(tokenRow.getByText("revoked", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    await page.goto(`/portal/${token}`);
    await expect(
      page.getByRole("heading", { name: "This link is no longer valid" })
    ).toBeVisible();
  });
});
