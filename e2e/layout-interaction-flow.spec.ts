import path from "node:path";

import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const FIXTURE_PATH = path.join(__dirname, "fixtures/test-drawing.svg");
const PROJECT_NAME = `[E2E] Layout interaction ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

// row-workspace.spec.ts already covers draw-on-empty-drag, click-select +
// handle resize (eventually-consistent via admin polling), and undo/redo —
// this spec is scoped to what the modeless-interaction rework specifically
// changed: no mode-toggle buttons, middle-mouse/space pan taking priority
// over row interaction, shift-drag marquee, click/Esc deselect, and — the
// actual bug fix — zero visual snap-back on move/resize.
test("layout editor: modeless interaction, pan priority, marquee, no snap-back", async ({
  page,
}) => {
  const admin = createAdminClient();

  await test.step("create project, upload drawing, draw three rows", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    await page.getByRole("link", { name: "Layout" }).click();
    // Not a bare input[type="file"] locator — the Overview page's own
    // lifecycle checklist has a hidden photo-attach file input that can
    // still be in the DOM mid-navigation, making that ambiguous/racy.
    await page.getByTestId("drawing-upload-input").setInputFiles(FIXTURE_PATH);
    await expect(page.getByText(/uploaded\.$/)).toBeVisible({
      timeout: 30_000,
    });

    // No mode-toggle buttons anywhere in the toolbar — drawing is always
    // available via a plain drag, not gated behind a "Draw" tool.
    await expect(
      page.getByRole("button", { name: "Pan mode" })
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Draw/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit mode" })).toHaveCount(
      0
    );
    await expect(
      page.getByRole("button", { name: "Select mode" })
    ).toHaveCount(0);

    const layoutImage = page.locator('img[alt="Layout drawing"]');
    await layoutImage.scrollIntoViewIfNeeded();
    const stageBox = (await layoutImage.boundingBox())!;

    async function drawRow(x0: number, y0: number, x1: number, y1: number) {
      await page.mouse.move(stageBox.x + x0 * stageBox.width, stageBox.y + y0 * stageBox.height);
      await page.mouse.down();
      await page.mouse.move(stageBox.x + x1 * stageBox.width, stageBox.y + y1 * stageBox.height, {
        steps: 5,
      });
      await page.mouse.up();
    }

    await drawRow(0.05, 0.05, 0.25, 0.2);
    await expect(page.getByText("Row 1", { exact: true })).toBeVisible();
    await drawRow(0.35, 0.05, 0.55, 0.2);
    await expect(page.getByText("Row 2", { exact: true })).toBeVisible();
    await drawRow(0.05, 0.3, 0.55, 0.45);
    await expect(page.getByText("Row 3", { exact: true })).toBeVisible();
  });

  await test.step("plain click on empty space deselects", async () => {
    await page.getByTestId("row-box-Row 1").click();
    await expect(page.getByText("1 row selected")).toBeVisible();

    // Relative to the drawing image itself, not the outer viewport — the
    // fit-to-screen zoom doesn't necessarily fill the whole viewport
    // (letterboxing on one axis), so a point "at 90% of the viewport"
    // can land outside the actual (scaled, transformed) stage entirely.
    // x=0.75/y=0.6 is empty: the three rows drawn above only occupy up
    // to x=0.55, y=0.45.
    const emptySpaceImage = page.locator('img[alt="Layout drawing"]');
    await emptySpaceImage.scrollIntoViewIfNeeded();
    const stageBox = (await emptySpaceImage.boundingBox())!;
    await page.mouse.click(
      stageBox.x + stageBox.width * 0.75,
      stageBox.y + stageBox.height * 0.6
    );
    await expect(page.getByText("1 row selected")).not.toBeVisible();
  });

  await test.step("Escape deselects", async () => {
    await page.getByTestId("row-box-Row 1").click();
    await expect(page.getByText("1 row selected")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("1 row selected")).not.toBeVisible();
  });

  await test.step("shift-drag marquee selects multiple rows at once", async () => {
    const marqueeImage = page.locator('img[alt="Layout drawing"]');
    await marqueeImage.scrollIntoViewIfNeeded();
    const stageBox = (await marqueeImage.boundingBox())!;
    // Covers Row 1 and Row 2 (both in the 0.05-0.55 x-range, 0.05-0.2
    // y-range) but not Row 3 (y starts at 0.3).
    await page.mouse.move(
      stageBox.x + 0.02 * stageBox.width,
      stageBox.y + 0.02 * stageBox.height
    );
    await page.keyboard.down("Shift");
    await page.mouse.down();
    await page.mouse.move(
      stageBox.x + 0.6 * stageBox.width,
      stageBox.y + 0.25 * stageBox.height,
      { steps: 8 }
    );
    await page.mouse.up();
    await page.keyboard.up("Shift");

    await expect(page.getByText("2 rows selected")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("middle-mouse-button pan over a row moves the canvas, not the row", async () => {
    const { data: geometryBefore } = await admin
      .from("rows")
      .select("x, y, w, h")
      .eq("project_id", projectId!)
      .eq("label", "Row 1")
      .single();

    const rowBoxBefore = (await page
      .getByTestId("row-box-Row 1")
      .boundingBox())!;
    const centerX = rowBoxBefore.x + rowBoxBefore.width / 2;
    const centerY = rowBoxBefore.y + rowBoxBefore.height / 2;

    await page.mouse.move(centerX, centerY);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(centerX + 80, centerY + 60, { steps: 8 });
    await page.mouse.up({ button: "middle" });

    // The row's underlying geometry is untouched — only the view panned.
    const { data: geometryAfter } = await admin
      .from("rows")
      .select("x, y, w, h")
      .eq("project_id", projectId!)
      .eq("label", "Row 1")
      .single();
    expect(geometryAfter).toEqual(geometryBefore);

    // But its on-screen position DID shift, by (about) the drag distance —
    // proving the canvas panned rather than the middle-click being a no-op.
    const rowBoxAfter = (await page
      .getByTestId("row-box-Row 1")
      .boundingBox())!;
    expect(rowBoxAfter.x - rowBoxBefore.x).toBeGreaterThan(40);
    expect(rowBoxAfter.y - rowBoxBefore.y).toBeGreaterThan(20);
  });

  await test.step("dragging a selected row's body shows zero snap-back: the dropped position is correct immediately, and stays correct once persisted", async () => {
    const { data: geometryBefore } = await admin
      .from("rows")
      .select("x, y")
      .eq("project_id", projectId!)
      .eq("label", "Row 3")
      .single();

    await page.getByTestId("row-box-Row 3").click();
    const rowBox = (await page.getByTestId("row-box-Row 3").boundingBox())!;
    const startX = rowBox.x + rowBox.width / 2;
    const startY = rowBox.y + rowBox.height / 2;
    const dropX = startX + 50;
    const dropY = startY + 35;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(dropX, dropY, { steps: 8 });
    await page.mouse.up();

    // Immediately after drop — no explicit wait, no poll — the row must
    // already be showing the dropped position. The bug this replaces:
    // draftGeometries was cleared as soon as pointerUp fired, so the row
    // would render from the still-stale `rows` prop for one frame (a
    // visible snap back to the origin) before jumping to the new spot
    // once the persist + router.refresh() round trip landed.
    const immediateBox = (await page
      .getByTestId("row-box-Row 3")
      .boundingBox())!;
    const movedX = immediateBox.x - rowBox.x;
    const movedY = immediateBox.y - rowBox.y;
    expect(movedX).toBeGreaterThan(30);
    expect(movedY).toBeGreaterThan(15);

    // Now wait for the write to actually land server-side (x/y genuinely
    // changed from what they were before this drag), and confirm the row
    // is STILL exactly where it was immediately after drop — no further
    // jump once the round trip completes.
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("rows")
          .select("x, y")
          .eq("project_id", projectId!)
          .eq("label", "Row 3")
          .single();
        return data;
      })
      .not.toEqual(geometryBefore);

    const settledBox = (await page
      .getByTestId("row-box-Row 3")
      .boundingBox())!;
    expect(Math.abs(settledBox.x - immediateBox.x)).toBeLessThan(2);
    expect(Math.abs(settledBox.y - immediateBox.y)).toBeLessThan(2);
  });
});
