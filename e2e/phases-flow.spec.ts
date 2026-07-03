import path from "node:path";

import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";

const FIXTURE_PATH = path.join(__dirname, "fixtures/test-drawing.svg");
const PROJECT_NAME = `[E2E] Phases flow ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

test("phases: color on the drawing, legend show/hide, filter Materials and Progress", async ({
  page,
}) => {
  await test.step("set up a project with 2 rows and materials", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    await page.getByRole("link", { name: "Layout" }).click();
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH);
    await expect(page.getByText(/uploaded\.$/)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: /Auto rows/ }).click();
    await page.locator("#row-count").fill("2");
    await page.locator("#row-orientation").selectOption("vertical");
    await page.getByRole("button", { name: "Next → drag box" }).click();
    await expect(page.getByText("Auto-create rows")).not.toBeVisible();
    const stageBox = (await page
      .locator('img[alt="Layout drawing"]')
      .boundingBox())!;
    await page.mouse.move(
      stageBox.x + stageBox.width * 0.05,
      stageBox.y + stageBox.height * 0.05
    );
    await page.mouse.down();
    await page.mouse.move(
      stageBox.x + stageBox.width * 0.95,
      stageBox.y + stageBox.height * 0.95,
      { steps: 5 }
    );
    await page.mouse.up();
    await expect(page.getByText("Row 1", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Materials" }).click();
    await page
      .getByRole("button", { name: /Paste from packing slip/i })
      .click();
    await page.locator("textarea").fill("Anchor, 100");
    await page.getByRole("button", { name: "Add materials" }).click();
    await expect(page.locator("table").first().locator("tbody tr")).toHaveCount(
      1
    );
    await page.getByRole("link", { name: "Layout" }).click();
  });

  await test.step("assign Row 1 to a new phase and confirm it colors on the drawing", async () => {
    await page.getByTestId("row-box-Row 1").click();
    await page.getByRole("button", { name: "Set phase" }).click();
    await page.getByRole("button", { name: "+ New phase" }).click();
    await page.getByPlaceholder("Phase name (e.g. Phase 2)").fill("Rough-in");
    await page.getByRole("button", { name: "Create & assign" }).click();

    await expect(page.getByText("Phases:")).toBeVisible({ timeout: 10_000 });
    const legendEntry = page.getByRole("button", { name: "Rough-in" });
    await expect(legendEntry).toBeVisible();

    const row1Box = page.getByTestId("row-box-Row 1");
    await expect
      .poll(
        async () =>
          row1Box.evaluate(
            (el) => getComputedStyle(el).borderColor
          ),
        { timeout: 10_000 }
      )
      .not.toBe("rgb(255, 255, 255)"); // no longer the default border-white/50
  });

  await test.step("hide the phase and confirm Row 1 disappears from the drawing", async () => {
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("button", { name: "Rough-in" }).click();
    await expect(page.getByTestId("row-box-Row 1")).not.toBeVisible();
    await expect(page.getByTestId("row-box-Row 2")).toBeVisible();

    // Un-hide for the rest of the test.
    await page.getByRole("button", { name: "Rough-in" }).click();
    await expect(page.getByTestId("row-box-Row 1")).toBeVisible();
  });

  await test.step("filter Materials by phase", async () => {
    await page.getByRole("link", { name: "Materials" }).click();
    await page.locator("#phase-filter").selectOption({ label: "Rough-in" });
    // Only Row 1 (in the phase) should render on the reference drawing now.
    await expect(page.getByText("Row 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Row 2", { exact: true })).not.toBeVisible();
  });

  await test.step("filter Progress by phase", async () => {
    await page.getByRole("link", { name: "Progress" }).click();
    // Wait for the Progress tab itself to render before touching its phase
    // filter — the Materials tab has its own, identically-labeled "Filter
    // by phase" select, and a click that outruns the client-side
    // navigation can land on that stale one instead.
    await expect(page.getByText("Overall complete")).toBeVisible();
    await page
      .getByLabel("Filter by phase")
      .selectOption({ label: "Rough-in" });
    await expect(page.getByText("Rough-in complete")).toBeVisible();
    await expect(page.getByText("1 rows")).toBeVisible();
  });
});
