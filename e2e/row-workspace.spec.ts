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

test("direct-manipulation canvas: zoom accuracy, select/copy/move/resize/rename/phase, undo/redo", async ({
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
    // Not a bare input[type="file"] locator — the Overview page's own
    // lifecycle checklist has a hidden photo-attach file input that can
    // still be in the DOM mid-navigation, making that ambiguous/racy.
    await page.getByTestId("drawing-upload-input").setInputFiles(FIXTURE_PATH);
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
    // Only a narrow strip on the left — leaves most of the drawing,
    // including its center, genuinely empty for the "draw a new row"
    // steps below (a vertical split fills the box's full height, so a
    // draw anywhere in that x-range would land on an existing row and
    // move it instead of creating a new one; the zoom-accuracy step
    // below specifically needs the *center* free, since zooming toward
    // the viewport's center pushes an off-center draw target further
    // off-center — and eventually off-screen — as zoom increases).
    await page.mouse.move(
      stageBox.x + stageBox.width * 0.05,
      stageBox.y + stageBox.height * 0.05
    );
    await page.mouse.down();
    await page.mouse.move(
      stageBox.x + stageBox.width * 0.3,
      stageBox.y + stageBox.height * 0.95,
      { steps: 10 }
    );
    await page.mouse.up();

    for (const label of ["Row 1", "Row 6", "Row 12"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  await test.step("drawing math stays accurate regardless of zoom level (plain drag on empty space draws — no tool button needed)", async () => {
    // Near the viewport's center, which is empty (rows only fill a
    // narrow strip on the left — see the setup step above) and stays
    // on-screen after zooming toward center (an off-center target would
    // move further off-center, and eventually off-screen, as zoom
    // increases).
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

    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "Zoom in" }).click();
    }

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

  await test.step("add materials", async () => {
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

  await test.step("click-select, shift-click to multi-select, set materials via command panel", async () => {
    // Click the row's own hit-target div (not its label text): the auto-
    // rows setup packs 12 columns into a narrow strip, so a row's label
    // span can be wider than the row itself and spill into a neighbor,
    // making a text-based click land on the wrong element.
    await page.getByTestId("row-box-Row 2").click();
    await expect(page.getByText("1 row selected")).toBeVisible();

    await page
      .getByTestId("row-box-Row 3")
      .click({ modifiers: ["Shift"] });
    await expect(page.getByText("2 rows selected")).toBeVisible();

    await page.getByRole("button", { name: "Set materials" }).click();
    const qtyInputs = page.locator('[id^="bulk-qty-"]');
    await qtyInputs.nth(0).fill("140");
    await qtyInputs.nth(1).fill("20");
    await page
      .getByRole("button", { name: /Apply to 2 selected rows/ })
      .click();
    await expect(page.getByText("Applied to 2 rows.")).toBeVisible({
      timeout: 10_000,
    });

    const admin = createAdminClient();
    const { data: rows, error } = await admin
      .from("rows")
      .select("id, label")
      .eq("project_id", projectId!)
      .in("label", ["Row 1", "Row 2", "Row 3"]);
    if (error) throw error;
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.id]));
    const { data: rowMaterials, error: rmError } = await admin
      .from("row_materials")
      .select("row_id")
      .in("row_id", [byLabel["Row 1"], byLabel["Row 2"], byLabel["Row 3"]]);
    if (rmError) throw rmError;
    expect(
      rowMaterials.filter((rm) => rm.row_id === byLabel["Row 2"])
    ).toHaveLength(2);
    expect(
      rowMaterials.filter((rm) => rm.row_id === byLabel["Row 3"])
    ).toHaveLength(2);
    expect(
      rowMaterials.filter((rm) => rm.row_id === byLabel["Row 1"])
    ).toHaveLength(0);

    // exact: true — the bulk-materials sub-panel has its own "Clear
    // selection" button visible at the same time, which also matches a
    // substring locator for "Clear".
    await page.getByRole("button", { name: "Clear", exact: true }).click();
  });

  await test.step("copy a row (materials included), rename it", async () => {
    await page.getByTestId("row-box-Row 2").click();
    await expect(page.getByText("1 row selected")).toBeVisible();

    const [copyResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.request().method() === "POST" && res.url().endsWith("/mark")
      ),
      page.getByRole("button", { name: "Copy" }).click(),
    ]);
    expect(copyResponse.ok()).toBeTruthy();
    await expect(page.getByText("Row 15", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    const admin = createAdminClient();
    const { data: row15, error } = await admin
      .from("rows")
      .select("id")
      .eq("project_id", projectId!)
      .eq("label", "Row 15")
      .single();
    if (error) throw error;
    const { data: row15Materials, error: rmError } = await admin
      .from("row_materials")
      .select("required_qty")
      .eq("row_id", row15.id);
    if (rmError) throw rmError;
    expect(row15Materials.map((m) => m.required_qty).sort((a, b) => a - b)).toEqual(
      [20, 140]
    );

    // Rename the copy (the just-created row auto-selects as the new
    // single selection after Copy).
    await page.getByTestId("row-box-Row 15").click();
    await page.getByRole("button", { name: "Rename" }).click();
    await page.locator("#rename-input").fill("Spare row");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Spare row", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Deselect: the 12 auto-rows columns are packed edge to edge, and a
    // selected row's resize handles extend a few pixels past its own
    // box (by design, so corner/edge handles sit exactly on the
    // border) — left selected, "Spare row"'s handles would overlap its
    // tightly-packed neighbor and intercept the next step's click.
    await page.getByRole("button", { name: "Clear", exact: true }).click();
  });

  await test.step("drag a selected row's body to move it", async () => {
    await page.getByTestId("row-box-Row 4").click();
    const box = (await page.getByTestId("row-box-Row 4").boundingBox())!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    const admin = createAdminClient();
    const { data: before, error: beforeError } = await admin
      .from("rows")
      .select("x, y")
      .eq("project_id", projectId!)
      .eq("label", "Row 4")
      .single();
    if (beforeError) throw beforeError;

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 40, centerY + 20, { steps: 5 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("rows")
          .select("x, y")
          .eq("project_id", projectId!)
          .eq("label", "Row 4")
          .single();
        return data;
      })
      .not.toEqual(before);
  });

  await test.step("drag the SE resize handle to resize a row", async () => {
    // Row 14 (created in the zoom-accuracy step) rather than one of the 12
    // auto-rows columns: those are only ~2% of the drawing's width on
    // screen, narrow enough that all 4 handles on the same edge overlap
    // (each is a 16px hit target with an 8px outward offset), so the
    // browser's hit-test at "se"'s computed center can resolve to a
    // different, overlapping handle (e.g. "s") instead. Row 14 specifically
    // (not Row 13): the zoom-accuracy step draws Row 14 directly on top of
    // Row 13 (same geometry, by design, to verify zoom math) — Row 14
    // renders later, so it's the one that actually receives clicks at that
    // shared spot.
    await page.getByTestId("row-box-Row 14").click();

    const admin = createAdminClient();
    const { data: before, error: beforeError } = await admin
      .from("rows")
      .select("x, y, w, h")
      .eq("project_id", projectId!)
      .eq("label", "Row 14")
      .single();
    if (beforeError) throw beforeError;

    const handle = page.getByTestId("resize-handle-se");
    const handleBox = (await handle.boundingBox())!;
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    const rowBoxBefore = (await page
      .getByTestId("row-box-Row 14")
      .boundingBox())!;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 30, startY + 15, { steps: 5 });
    const [resizeResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.request().method() === "POST" && res.url().endsWith("/mark")
      ),
      page.mouse.up(),
    ]);
    expect(resizeResponse.ok()).toBeTruthy();
    // The POST resolving only confirms the server committed the resize —
    // not that this page's `rows` prop (and the client-side re-render that
    // depends on it) has caught up yet. The very next step nudges this same
    // row via the keyboard, and the nudge handler recomputes its geometry
    // from that prop — if it fires first, it would silently write the
    // pre-resize w/h back out. Poll the client's own rendered box (a direct
    // signal that the re-render actually landed) rather than guessing at
    // how many network round trips that takes.
    await expect
      .poll(async () => {
        const box = await page.getByTestId("row-box-Row 14").boundingBox();
        return box?.width ?? 0;
      })
      .toBeGreaterThan(rowBoxBefore.width);

    const { data: after, error: afterError } = await admin
      .from("rows")
      .select("x, y, w, h")
      .eq("project_id", projectId!)
      .eq("label", "Row 14")
      .single();
    if (afterError) throw afterError;

    // SE handle only grows width/height, x/y (top-left corner) stay fixed.
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
    expect(after.w).toBeGreaterThan(before.w);
    expect(after.h).toBeGreaterThan(before.h);
  });

  await test.step("arrow keys nudge the selected row", async () => {
    const admin = createAdminClient();
    const { data: before, error: beforeError } = await admin
      .from("rows")
      .select("x")
      .eq("project_id", projectId!)
      .eq("label", "Row 14")
      .single();
    if (beforeError) throw beforeError;

    await page.keyboard.press("ArrowRight");

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("rows")
          .select("x")
          .eq("project_id", projectId!)
          .eq("label", "Row 14")
          .single();
        return data?.x;
      })
      .toBeGreaterThan(before.x);
  });

  await test.step("set phase (create inline)", async () => {
    await page.getByRole("button", { name: "Set phase" }).click();
    await page.getByRole("button", { name: "+ New phase" }).click();
    await page.getByPlaceholder("Phase name (e.g. Phase 2)").fill("Phase 1");
    await page.getByRole("button", { name: "Create & assign" }).click();

    const admin = createAdminClient();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("rows")
          .select("phase_id, phases(name)")
          .eq("project_id", projectId!)
          .eq("label", "Row 14")
          .single();
        return (data as unknown as { phases: { name: string } | null })
          ?.phases?.name;
      })
      .toBe("Phase 1");
  });

  await test.step("delete then undo then redo", async () => {
    await page.getByTestId("row-box-Row 6").click();
    await expect(page.getByText("1 row selected")).toBeVisible();

    const [deleteResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.request().method() === "POST" && res.url().endsWith("/mark")
      ),
      page.getByRole("button", { name: "Delete" }).click(),
    ]);
    expect(deleteResponse.ok()).toBeTruthy();
    await expect(page.getByText("Row 6", { exact: true })).not.toBeVisible({
      timeout: 10_000,
    });

    const [undoResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.request().method() === "POST" && res.url().endsWith("/mark")
      ),
      page.keyboard.press("Control+z"),
    ]);
    expect(undoResponse.ok()).toBeTruthy();
    await expect(page.getByText("Undone")).toBeVisible();
    await expect(page.getByText("Row 6", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    const [redoResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.request().method() === "POST" && res.url().endsWith("/mark")
      ),
      page.keyboard.press("Control+Shift+z"),
    ]);
    expect(redoResponse.ok()).toBeTruthy();
    await expect(page.getByText("Redone")).toBeVisible();
    await expect(page.getByText("Row 6", { exact: true })).not.toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step("everything survives a reload", async () => {
    await page.reload();
    await expect(page.getByText("Spare row", { exact: true })).toBeVisible();
    await expect(page.getByText("Row 13", { exact: true })).toBeVisible();
    await expect(page.getByText("Row 14", { exact: true })).toBeVisible();
    await expect(page.getByText("Row 6", { exact: true })).not.toBeVisible();
  });
});
