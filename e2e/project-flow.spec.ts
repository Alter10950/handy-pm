import path from "node:path";

import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";

// Playwright compiles test files as CommonJS in this project (no "type":
// "module" in package.json — Next.js's own build has its own module
// handling, independent of this), so __dirname is available directly.
const FIXTURE_PATH = path.join(__dirname, "fixtures/test-drawing.svg");

// Unique per run so repeated/parallel CI runs never collide.
const PROJECT_NAME = `[E2E] Project flow ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) {
    await deleteProjectCompletely(projectId);
  }
});

test("create project, mark rows, assign materials, verify reconciliation", async ({
  page,
}) => {
  await test.step("create project", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.locator("#site_address").fill("100 Test Way");
    await page.getByRole("button", { name: "Create project" }).click();

    await page.waitForURL(/\/app\/project\/[^/]+$/);
    const match = /\/app\/project\/([^/]+)$/.exec(page.url());
    expect(match).not.toBeNull();
    projectId = match![1];
  });

  await test.step("upload drawing", async () => {
    await page.getByRole("link", { name: "Layout" }).click();
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH);
    await expect(page.getByText(/uploaded\.$/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('img[alt="Layout drawing"]')).toBeVisible();
  });

  await test.step("auto-create 3 rows", async () => {
    await page.getByRole("button", { name: /Auto rows/ }).click();
    await page.locator("#row-count").fill("3");
    await page.locator("#row-orientation").selectOption("vertical");
    await page.getByRole("button", { name: "Next → drag box" }).click();
    // The dialog's overlay fades out over ~100ms and can still intercept
    // pointer events mid-transition — wait for it to fully detach before
    // dragging on the stage underneath, or the drag silently lands on
    // the (invisible but still-present) backdrop instead.
    await expect(page.getByText("Auto-create rows")).not.toBeVisible();

    const stageBox = await page
      .locator('img[alt="Layout drawing"]')
      .boundingBox();
    if (!stageBox) throw new Error("Stage image did not render");

    const x1 = stageBox.x + stageBox.width * 0.05;
    const y1 = stageBox.y + stageBox.height * 0.05;
    const x2 = stageBox.x + stageBox.width * 0.95;
    const y2 = stageBox.y + stageBox.height * 0.95;

    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 10 });
    await page.mouse.up();

    await expect(page.getByText("Row 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Row 2", { exact: true })).toBeVisible();
    await expect(page.getByText("Row 3", { exact: true })).toBeVisible();
  });

  await test.step("paste material list", async () => {
    await page.getByRole("link", { name: "Materials" }).click();
    await page
      .getByRole("button", { name: /Paste from packing slip/i })
      .click();
    await page.locator("textarea").fill("Bolt, 30\nBracket, 15");
    await page.getByRole("button", { name: "Add materials" }).click();

    // Scoped to the first table: the materials grid. The Reconciliation
    // card below it also renders a <table>, so an unscoped "table tbody
    // tr" matches both and doubles the count.
    const rows = page.locator("table").first().locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator("input").nth(0)).toHaveValue("Bolt");
    await expect(rows.nth(1).locator("input").nth(0)).toHaveValue("Bracket");
  });

  await test.step("assign quantities in the grid", async () => {
    // Scoped to the first table: the materials grid. The Reconciliation
    // card below it also renders a <table>, so an unscoped "table tbody
    // tr" matches both and doubles the count.
    const rows = page.locator("table").first().locator("tbody tr");

    // Bolt (row 0): fully assign across all 3 rows (10 each = 30 = needed).
    const boltInputs = rows.nth(0).locator("input");
    for (const index of [3, 4, 5]) {
      await boltInputs.nth(index).fill("10");
      await boltInputs.nth(index).blur();
    }

    // Bracket (row 1): partially assign (only rows 1 & 2, 5 each = 10 of 15
    // needed) and drop received below needed, to exercise both the "left"
    // and "to order" flags.
    const bracketInputs = rows.nth(1).locator("input");
    await bracketInputs.nth(2).fill("5"); // received
    await bracketInputs.nth(2).blur();
    await bracketInputs.nth(3).fill("5"); // row 1 qty
    await bracketInputs.nth(3).blur();
    await bracketInputs.nth(4).fill("5"); // row 2 qty
    await bracketInputs.nth(4).blur();

    // Assigned/Left/To-order are plain read-only cells, not inputs, so
    // waiting on their text confirms the Server Action + revalidation
    // round-trip actually landed before we assert on it.
    await expect(rows.nth(0).locator("td").nth(3)).toHaveText("30", {
      timeout: 10_000,
    }); // Bolt assigned
    await expect(rows.nth(0).locator("td").nth(4)).toHaveText("0"); // Bolt left
    await expect(rows.nth(0).locator("td").nth(5)).toHaveText("0"); // Bolt to order

    await expect(rows.nth(1).locator("td").nth(3)).toHaveText("10"); // Bracket assigned
    await expect(rows.nth(1).locator("td").nth(4)).toHaveText("5"); // Bracket left
    await expect(rows.nth(1).locator("td").nth(5)).toHaveText("10"); // Bracket to order
  });

  await test.step("verify reconciliation card", async () => {
    const reconciliationRows = page
      .locator("h3", { hasText: "Reconciliation" })
      .locator("xpath=../..")
      .locator("tbody tr");

    await expect(reconciliationRows).toHaveCount(2);

    const bolt = reconciliationRows.filter({ hasText: "Bolt" });
    await expect(bolt.locator("td").nth(1)).toHaveText("0"); // installed
    await expect(bolt.locator("td").nth(2)).toHaveText("30"); // assigned
    await expect(bolt.locator("td").nth(3)).toHaveText("30"); // needed
    await expect(bolt.locator("td").nth(5)).toHaveText("0"); // to order

    const bracket = reconciliationRows.filter({ hasText: "Bracket" });
    await expect(bracket.locator("td").nth(2)).toHaveText(/^10/); // assigned (mismatch icon may follow)
    await expect(bracket.locator("td").nth(3)).toHaveText("15"); // needed
    await expect(bracket.locator("td").nth(5)).toHaveText("10"); // to order
  });

  await test.step("verify progress tab", async () => {
    await page.getByRole("link", { name: "Progress" }).click();
    await expect(page.getByText("3", { exact: true }).first()).toBeVisible(); // row count
    await expect(page.getByText("0%")).toBeVisible(); // nothing installed yet
  });
});
