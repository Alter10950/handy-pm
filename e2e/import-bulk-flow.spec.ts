import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const PROJECT_NAME = `[E2E] Import bulk ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

async function drawRow(
  page: import("@playwright/test").Page,
  box: { x: number; y: number; w: number; h: number }
) {
  // Zoom/pan's "fit to screen" recomputes in a useEffect after mount, so a
  // bounding-box read immediately after a fast client-side navigation can
  // race it and catch the image at a stale size. "Fit to screen" itself
  // recomputes synchronously in its own click handler, so clicking it here
  // is a deterministic way to force a fresh, settled fit before reading
  // the box for pointer math — sidesteps the effect-timing question
  // entirely rather than guessing how long to wait for it.
  await page.getByRole("button", { name: "Fit to screen" }).click();
  const stageBox = (await page
    .locator('img[alt="Layout drawing"]')
    .boundingBox())!;
  await page.mouse.move(
    stageBox.x + stageBox.width * box.x,
    stageBox.y + stageBox.height * box.y
  );
  await page.mouse.down();
  await page.mouse.move(
    stageBox.x + stageBox.width * (box.x + box.w),
    stageBox.y + stageBox.height * (box.y + box.h),
    { steps: 5 }
  );
  await page.mouse.up();
}

test("import/bulk: CSV materials + row-assignment import, bulk select/condition/delete, duplicate range", async ({
  page,
}) => {
  const admin = createAdminClient();

  await test.step("create project, upload a drawing, draw Row 1", async () => {
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

    await drawRow(page, { x: 0.05, y: 0.05, w: 0.1, h: 0.1 });
    await expect(page.getByText("Row 1", { exact: true })).toBeVisible();
  });

  await test.step("import a materials CSV — headers auto-map, preview all OK", async () => {
    await page.getByRole("link", { name: "Materials", exact: true }).click();
    await page.getByRole("button", { name: "⬆ Import from file" }).click();
    await page.getByTestId("import-file-input").setInputFiles({
      name: "materials.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Name,Total needed,Condition\nImported Beam,40,used\nImported Anchor,120,new\n"
      ),
    });
    const preview = page.getByTestId("import-preview-table");
    await expect(preview.getByText("OK")).toHaveCount(2);
    await page.getByRole("button", { name: "Import 2 materials" }).click();
    await expect(page.locator('[data-testid^="material-row-"]')).toHaveCount(2);
  });

  let beamId = "";
  let anchorId = "";

  await test.step("import a row-assignments CSV — resolves row/material by name", async () => {
    const { data: beam } = await admin
      .from("materials")
      .select("id")
      .eq("project_id", projectId!)
      .eq("name", "Imported Beam")
      .single();
    const { data: anchor } = await admin
      .from("materials")
      .select("id")
      .eq("project_id", projectId!)
      .eq("name", "Imported Anchor")
      .single();
    beamId = beam!.id;
    anchorId = anchor!.id;

    await page.getByRole("button", { name: "⬆ Import from file" }).click();
    await page.getByTestId("import-mode-assignments").click();
    await page.getByTestId("import-file-input").setInputFiles({
      name: "assignments.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Row,Material,Qty\nRow 1,Imported Beam,15\n"),
    });
    const preview = page.getByTestId("import-preview-table");
    await expect(preview.getByText("OK")).toHaveCount(1);
    await page.getByRole("button", { name: "Import 1 assignment" }).click();

    const { data: rowRecord } = await admin
      .from("rows")
      .select("id")
      .eq("project_id", projectId!)
      .eq("label", "Row 1")
      .single();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("row_materials")
          .select("required_qty")
          .eq("row_id", rowRecord!.id)
          .eq("material_id", beamId)
          .maybeSingle();
        return data?.required_qty;
      })
      .toBe(15);
  });

  await test.step("bulk select: set condition, then delete one", async () => {
    await page.getByTestId(`material-select-${beamId}`).check();
    await page.getByTestId(`material-select-${anchorId}`).check();
    await expect(page.getByText("2 selected")).toBeVisible();

    await page.getByLabel("Set condition for selected").selectOption("used");
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("materials")
          .select("condition")
          .eq("id", anchorId)
          .single();
        return data?.condition;
      })
      .toBe("used");

    // Narrow the selection to just one material before deleting, so the
    // assertions stay tied to a single, unambiguous row.
    await page.getByTestId(`material-select-${anchorId}`).uncheck();
    await expect(page.getByText("1 selected")).toBeVisible();

    // Design pass v3 F2: destructive actions use a delayed commit with an
    // undo toast instead of a confirm dialog. First delete → Undo brings
    // the row back and the DB row survives.
    await page.getByRole("button", { name: "Delete 1" }).click();
    await expect(page.locator('[data-testid^="material-row-"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator('[data-testid^="material-row-"]')).toHaveCount(2);
    const { count: afterUndo } = await admin
      .from("materials")
      .select("id", { count: "exact", head: true })
      .eq("id", beamId);
    expect(afterUndo).toBe(1);

    // Second delete, left alone → commits to the DB after the grace window.
    await page.getByTestId(`material-select-${beamId}`).check();
    await expect(page.getByText("1 selected")).toBeVisible();
    await page.getByRole("button", { name: "Delete 1" }).click();
    await expect(page.locator('[data-testid^="material-row-"]')).toHaveCount(1);
    await expect
      .poll(
        async () => {
          const { count } = await admin
            .from("materials")
            .select("id", { count: "exact", head: true })
            .eq("id", beamId);
          return count;
        },
        { timeout: 15_000 }
      )
      .toBe(0);
  });

  await test.step("duplicate range: select 2 rows, duplicate as a block", async () => {
    await page.getByRole("link", { name: "Layout", exact: true }).click();
    // Unlike the first draw (naturally preceded by an "uploaded." wait),
    // this navigation has no async checkpoint of its own — wait for the
    // existing row to render so the image has fully loaded and zoom/fit
    // has settled before computing a bounding box off it.
    // Scope to the marking canvas' row box — "Row 1" as bare text also
    // matches the materials grid's per-row column header, which can still
    // be in the DOM mid-navigation (design pass v3 D3 added more columns).
    await expect(page.getByTestId("row-box-Row 1")).toBeVisible();
    await drawRow(page, { x: 0.2, y: 0.05, w: 0.1, h: 0.1 });
    await expect(page.getByTestId("row-box-Row 2")).toBeVisible();

    await page.getByTestId("row-box-Row 1").click();
    await page.getByTestId("row-box-Row 2").click({ modifiers: ["Shift"] });
    await expect(page.getByText("2 rows selected")).toBeVisible();

    await page.getByRole("button", { name: "Duplicate range ×N" }).click();
    await page.getByRole("button", { name: /Duplicate ×\d+/ }).click();

    await expect(page.getByText("4 rows on this page")).toBeVisible({
      timeout: 10_000,
    });
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("rows")
          .select("id")
          .eq("project_id", projectId!);
        return data?.length;
      })
      .toBe(4);
  });
});
