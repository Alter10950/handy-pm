import path from "node:path";

import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const FIXTURE_PATH = path.join(__dirname, "fixtures/test-drawing.svg");
const PROJECT_NAME = `[E2E] Multi-page flow ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

test("multi-page drawings: first upload auto-marks, second page is view-only, switching the marking page works", async ({
  page,
}) => {
  const admin = createAdminClient();

  await test.step("create a project and upload the first page", async () => {
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
    await page.getByTestId("drawing-upload-input").setInputFiles(FIXTURE_PATH);
    await expect(page.getByText(/uploaded\.$/)).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step("first page auto-becomes the marking page", async () => {
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("projects")
          .select("mark_drawing_id")
          .eq("id", projectId!)
          .single();
        return data?.mark_drawing_id ?? null;
      })
      .not.toBeNull();

    const { data: drawing } = await admin
      .from("drawings")
      .select("role")
      .eq("project_id", projectId!)
      .single();
    expect(drawing!.role).toBe("marking");
  });

  await test.step("upload a second page — it's view-only by default", async () => {
    await page.getByRole("button", { name: "Add more pages" }).click();
    // Not a bare input[type="file"] locator — sub-phase G's drawing
    // versioning panel added a second file input (its own "Upload new
    // version" control) to this same page, making that ambiguous.
    await page.getByTestId("drawing-upload-input").setInputFiles(FIXTURE_PATH);
    await expect(page.getByText(/uploaded\.$/)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Page 2" }).click();
    await expect(page.getByText("View-only reference page")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Set as marking page" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "▦ Auto rows" })
    ).toBeDisabled();
  });

  await test.step("drawing on the reference page does nothing", async () => {
    const stageBox = (await page
      .locator('img[alt="Layout drawing"]')
      .boundingBox())!;
    await page.mouse.move(
      stageBox.x + stageBox.width * 0.2,
      stageBox.y + stageBox.height * 0.2
    );
    await page.mouse.down();
    await page.mouse.move(
      stageBox.x + stageBox.width * 0.4,
      stageBox.y + stageBox.height * 0.4,
      { steps: 5 }
    );
    await page.mouse.up();

    const { count } = await admin
      .from("rows")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId!);
    expect(count).toBe(0);
  });

  await test.step("zoom and fullscreen still work on the reference page", async () => {
    const zoomLabel = page.locator("span.tabular-nums");
    const before = await zoomLabel.innerText();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(zoomLabel).not.toHaveText(before);
    await page.getByRole("button", { name: "Fullscreen" }).click();
    await expect(
      page.getByRole("button", { name: "Exit fullscreen" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Exit fullscreen" }).click();
  });

  await test.step("switch the marking page to page 2", async () => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" && res.url().endsWith("/mark")
      ),
      page.getByRole("button", { name: "Set as marking page" }).click(),
    ]);
    expect(response.ok()).toBeTruthy();
    await expect(page.getByText("★ This is the marking page")).toBeVisible({
      timeout: 10_000,
    });

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("drawings")
          .select("role")
          .eq("project_id", projectId!)
          .eq("page_index", 1)
          .single();
        return data?.role;
      })
      .toBe("marking");

    // Exactly one marking page — page 1 must have flipped back to reference.
    const { data: page1 } = await admin
      .from("drawings")
      .select("role")
      .eq("project_id", projectId!)
      .eq("page_index", 0)
      .single();
    expect(page1!.role).toBe("reference");
  });
});
