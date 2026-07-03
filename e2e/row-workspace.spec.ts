import path from "node:path";

import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const FIXTURE_PATH = path.join(__dirname, "fixtures/test-drawing.svg");
const PROJECT_NAME = `[E2E] Row workspace ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) {
    await deleteProjectCompletely(projectId);
  }
});

test("zoom accuracy, multi-select bulk quantities, duplicate row", async ({
  page,
}) => {
  await test.step("create project, upload drawing, auto-create 12 rows", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();

    await page.waitForURL(/\/app\/project\/[^/]+$/);
    const match = /\/app\/project\/([^/]+)$/.exec(page.url());
    expect(match).not.toBeNull();
    projectId = match![1];

    await page.getByRole("link", { name: "Layout" }).click();
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH);
    await expect(page.getByText(/uploaded\.$/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('img[alt="Layout drawing"]')).toBeVisible();

    await page.getByRole("button", { name: /Auto rows/ }).click();
    await page.locator("#row-count").fill("12");
    await page.locator("#row-orientation").selectOption("vertical");
    await page.getByRole("button", { name: "Next → drag box" }).click();
    await expect(page.getByText("Auto-create rows")).not.toBeVisible();

    const stageBox = await page
      .locator('img[alt="Layout drawing"]')
      .boundingBox();
    if (!stageBox) throw new Error("Stage image did not render");
    await page.mouse.move(
      stageBox.x + stageBox.width * 0.05,
      stageBox.y + stageBox.height * 0.05
    );
    await page.mouse.down();
    await page.mouse.move(
      stageBox.x + stageBox.width * 0.95,
      stageBox.y + stageBox.height * 0.95,
      { steps: 10 }
    );
    await page.mouse.up();

    for (const label of ["Row 1", "Row 6", "Row 12"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  await test.step("zoom controls report a sensible percentage and Fit re-centers", async () => {
    await expect(page.getByText(/^\d+%$/)).toBeVisible();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Fit to screen" }).click();
  });

  await test.step("drawing math stays accurate regardless of zoom level", async () => {
    // Draw one row near the viewport's center at fit-zoom, read back its
    // real normalized geometry, then zoom in (toward that same center —
    // see zoomIn's implementation) and drag over the SAME underlying
    // content region — now magnified — computed from the stage's current
    // (post-zoom) bounding rect. A fixed viewport-relative drag size would
    // *correctly* cover a smaller stage fraction once zoomed in, so that's
    // not a valid same-content comparison; converting the first row's
    // normalized box into current screen coordinates is what actually
    // tests "the same content produces the same geometry at any zoom."
    await page.getByRole("button", { name: "✏️ Draw one" }).click();

    const viewportBox1 = (await page
      .getByTestId("stage-viewport")
      .boundingBox())!;
    await page.mouse.move(
      viewportBox1.x + viewportBox1.width * 0.4,
      viewportBox1.y + viewportBox1.height * 0.4
    );
    await page.mouse.down();
    await page.mouse.move(
      viewportBox1.x + viewportBox1.width * 0.6,
      viewportBox1.y + viewportBox1.height * 0.6,
      { steps: 5 }
    );
    await page.mouse.up();
    await expect(page.getByText("Row 13", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    const admin = createAdminClient();
    const { data: row13, error: row13Error } = await admin
      .from("rows")
      .select("x, y, w, h")
      .eq("project_id", projectId!)
      .eq("label", "Row 13")
      .single();
    if (row13Error) throw row13Error;

    const zoomBefore = Number(
      (await page.getByText(/^\d+%$/).textContent())!.replace("%", "")
    );
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "Zoom in" }).click();
    }
    const zoomAfter = Number(
      (await page.getByText(/^\d+%$/).textContent())!.replace("%", "")
    );
    expect(zoomAfter).toBeGreaterThan(zoomBefore * 1.5);

    const stageBox = (await page
      .locator('img[alt="Layout drawing"]')
      .boundingBox())!;
    await page.mouse.move(
      stageBox.x + row13.x * stageBox.width,
      stageBox.y + row13.y * stageBox.height
    );
    await page.mouse.down();
    await page.mouse.move(
      stageBox.x + (row13.x + row13.w) * stageBox.width,
      stageBox.y + (row13.y + row13.h) * stageBox.height,
      { steps: 5 }
    );
    await page.mouse.up();
    await expect(page.getByText("Row 14", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    const { data: row14, error: row14Error } = await admin
      .from("rows")
      .select("x, y, w, h")
      .eq("project_id", projectId!)
      .eq("label", "Row 14")
      .single();
    if (row14Error) throw row14Error;

    const tolerance = 0.02;
    expect(Math.abs(row13.x - row14.x)).toBeLessThan(tolerance);
    expect(Math.abs(row13.y - row14.y)).toBeLessThan(tolerance);
    expect(Math.abs(row13.w - row14.w)).toBeLessThan(tolerance);
    expect(Math.abs(row13.h - row14.h)).toBeLessThan(tolerance);

    await page.getByRole("button", { name: "Fit to screen" }).click();
  });

  await test.step("add materials to bulk-assign", async () => {
    await page.getByRole("link", { name: "Materials" }).click();
    await page
      .getByRole("button", { name: /Paste from packing slip/i })
      .click();
    await page.locator("textarea").fill("Beam, 500\nUpright, 100");
    await page.getByRole("button", { name: "Add materials" }).click();
    await expect(page.locator("table").first().locator("tbody tr")).toHaveCount(
      2
    );
    await page.getByRole("link", { name: "Layout" }).click();
  });

  await test.step("select rows 2-11 and bulk-set quantities in one action", async () => {
    await page.getByRole("button", { name: "☑ Select" }).click();

    await page.getByText("Row 2", { exact: true }).click();
    await page
      .getByText("Row 11", { exact: true })
      .click({ modifiers: ["Shift"] });

    await expect(
      page.getByText("Set materials for 10 selected rows")
    ).toBeVisible();

    const qtyInputs = page.locator('[id^="bulk-qty-"]');
    await qtyInputs.nth(0).fill("140");
    await qtyInputs.nth(1).fill("20");
    await page
      .getByRole("button", { name: /Apply to 10 selected rows/ })
      .click();
    await expect(page.getByText("Applied to 10 rows.")).toBeVisible({
      timeout: 10_000,
    });

    const admin = createAdminClient();
    const { data: allRows, error } = await admin
      .from("rows")
      .select("id, label")
      .eq("project_id", projectId!)
      .in("label", ["Row 1", "Row 2", "Row 11", "Row 12"]);
    if (error) throw error;

    const byLabel = Object.fromEntries(allRows.map((r) => [r.label, r.id]));
    const { data: rowMaterials, error: rmError } = await admin
      .from("row_materials")
      .select("row_id, required_qty")
      .in("row_id", [
        byLabel["Row 1"],
        byLabel["Row 2"],
        byLabel["Row 11"],
        byLabel["Row 12"],
      ]);
    if (rmError) throw rmError;

    // Row 2 and Row 11 (the selection boundary) got both materials; Row 1
    // and Row 12 (just outside it) got none — confirms an exact boundary,
    // not an off-by-one.
    expect(
      rowMaterials.filter((rm) => rm.row_id === byLabel["Row 2"])
    ).toHaveLength(2);
    expect(
      rowMaterials.filter((rm) => rm.row_id === byLabel["Row 11"])
    ).toHaveLength(2);
    expect(
      rowMaterials.filter((rm) => rm.row_id === byLabel["Row 1"])
    ).toHaveLength(0);
    expect(
      rowMaterials.filter((rm) => rm.row_id === byLabel["Row 12"])
    ).toHaveLength(0);
  });

  await test.step("duplicate a row, copying its materials", async () => {
    await page.getByRole("button", { name: "↔ Edit" }).click();
    await page.getByText("Row 3", { exact: true }).click();
    await expect(page.getByText("Edit row")).toBeVisible();

    await page.getByRole("button", { name: "Duplicate…" }).click();
    await expect(page.getByText("Duplicate row")).toBeVisible();
    await page.locator("#duplicate-count").fill("2");
    await page.getByRole("button", { name: /Duplicate \(2\)/ }).click();

    await expect(page.getByText("Row 15", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Row 16", { exact: true })).toBeVisible();

    const admin = createAdminClient();
    const { data: newRows, error } = await admin
      .from("rows")
      .select("id, label")
      .eq("project_id", projectId!)
      .in("label", ["Row 15", "Row 16"]);
    if (error) throw error;
    expect(newRows).toHaveLength(2);

    const { data: rowMaterials, error: rmError } = await admin
      .from("row_materials")
      .select("row_id, required_qty")
      .in(
        "row_id",
        newRows.map((r) => r.id)
      );
    if (rmError) throw rmError;

    for (const row of newRows) {
      const materialsForRow = rowMaterials.filter((rm) => rm.row_id === row.id);
      expect(materialsForRow).toHaveLength(2);
      expect(
        materialsForRow.map((rm) => rm.required_qty).sort((a, b) => a - b)
      ).toEqual([20, 140]);
    }
  });

  await test.step("everything survives a reload", async () => {
    await page.reload();
    await expect(page.getByText("Row 15", { exact: true })).toBeVisible();
    await expect(page.getByText("Row 16", { exact: true })).toBeVisible();
    await expect(page.getByText("Row 13", { exact: true })).toBeVisible();
    await expect(page.getByText("Row 14", { exact: true })).toBeVisible();
  });
});
