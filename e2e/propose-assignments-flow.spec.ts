import { expect, test, type Page } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

// Batch 5 Sub-phase B(2): the row-assignment PROPOSAL — an even split of
// each material across the drawn rows, reviewed then applied. Pure math
// (unit-tested in tests/unit/propose-assignments.test.ts); this proves the
// end-to-end apply path writes the right row_materials.

const PROJECT_NAME = `[E2E] Propose ${Date.now()}`;
let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

async function drawRow(
  page: Page,
  box: { x: number; y: number; w: number; h: number }
) {
  await page.getByRole("button", { name: "Fit to screen" }).click();
  const stage = (await page.locator('img[alt="Layout drawing"]').boundingBox())!;
  await page.mouse.move(stage.x + stage.width * box.x, stage.y + stage.height * box.y);
  await page.mouse.down();
  await page.mouse.move(
    stage.x + stage.width * (box.x + box.w),
    stage.y + stage.height * (box.y + box.h),
    { steps: 5 }
  );
  await page.mouse.up();
}

test("propose quantities: even-split each material across drawn rows, review, apply", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const admin = createAdminClient();

  await test.step("create project, upload drawing, draw two rows", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    await page.getByRole("link", { name: "Layout", exact: true }).click();
    await page
      .getByTestId("drawing-upload-input")
      .setInputFiles("e2e/fixtures/test-drawing.svg");
    await expect(page.getByText(/uploaded\.$/)).toBeVisible({ timeout: 30_000 });

    await drawRow(page, { x: 0.05, y: 0.05, w: 0.1, h: 0.15 });
    await expect(page.getByTestId("row-box-Row 1")).toBeVisible();
    await drawRow(page, { x: 0.3, y: 0.05, w: 0.1, h: 0.15 });
    await expect(page.getByTestId("row-box-Row 2")).toBeVisible();
  });

  await test.step("add two materials with round totals", async () => {
    await page.getByRole("link", { name: "Materials", exact: true }).click();
    await page.getByRole("button", { name: /Paste from packing slip/i }).click();
    await page.locator("textarea").fill("Beam, 12\nAnchor, 10");
    await page.getByRole("button", { name: "Add materials" }).click();
    await expect(page.locator('[data-testid^="material-row-"]')).toHaveCount(2);
  });

  await test.step("propose quantities and review the even split", async () => {
    await page.getByRole("link", { name: "Layout", exact: true }).click();
    await page.getByTestId("propose-assignments-button").click();
    const table = page.getByTestId("propose-preview-table");
    await expect(table).toBeVisible();
    // 12 over 2 rows = 6 each; 10 over 2 = 5 each.
    await expect(table.locator("tbody")).toContainText("6 each");
    await expect(table.locator("tbody")).toContainText("5 each");
    await page.getByRole("button", { name: /Apply to 2 rows/ }).click();
    await expect(table).not.toBeVisible();
  });

  await test.step("row_materials reflect the applied split", async () => {
    await expect
      .poll(async () => {
        const { data: rows } = await admin
          .from("rows")
          .select("id")
          .eq("project_id", projectId!);
        const rowIds = (rows ?? []).map((r) => r.id);
        const { data } = await admin
          .from("row_materials")
          .select("required_qty, materials!inner(name)")
          .in("row_id", rowIds);
        // Each of the 2 materials × 2 rows = 4 entries; beams 6+6, anchors 5+5.
        const total = (data ?? []).reduce(
          (sum, r) => sum + (r.required_qty as number),
          0
        );
        return { count: data?.length ?? 0, total };
      })
      .toEqual({ count: 4, total: 22 });
  });
});
