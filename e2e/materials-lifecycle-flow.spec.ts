import path from "node:path";

import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const FIXTURE_PATH = path.join(__dirname, "fixtures/test-drawing.svg");
const PROJECT_NAME = `[E2E] Materials lifecycle ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

test("materials lifecycle: receiving check-in, reorder list, richer identity fields, row readiness, scheduler warning", async ({
  page,
}) => {
  const admin = createAdminClient();

  await test.step("create project, draw a row, add a material", async () => {
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

    const stageBox = (await page
      .locator('img[alt="Layout drawing"]')
      .boundingBox())!;
    await page.mouse.move(
      stageBox.x + stageBox.width * 0.1,
      stageBox.y + stageBox.height * 0.1
    );
    await page.mouse.down();
    await page.mouse.move(
      stageBox.x + stageBox.width * 0.4,
      stageBox.y + stageBox.height * 0.3,
      { steps: 5 }
    );
    await page.mouse.up();
    await expect(page.getByText("Row 1", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Materials" }).click();
    await page
      .getByRole("button", { name: /Paste from packing slip/i })
      .click();
    await page.locator("textarea").fill("Test Beam, 100");
    await page.getByRole("button", { name: "Add materials" }).click();
    await expect(page.locator('[data-testid^="material-row-"]')).toHaveCount(1);
  });

  await test.step("materials grid: richer identity fields save", async () => {
    const { data: material } = await admin
      .from("materials")
      .select("id")
      .eq("project_id", projectId!)
      .eq("name", "Test Beam")
      .single();

    await page.getByTestId(`material-profile-${material!.id}`).fill("36SQ10");
    await page.getByTestId(`material-profile-${material!.id}`).blur();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("materials")
          .select("profile")
          .eq("id", material!.id)
          .single();
        return data?.profile;
      })
      .toBe("36SQ10");

    await page
      .getByTestId(`material-condition-${material!.id}`)
      .selectOption("used");
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("materials")
          .select("condition")
          .eq("id", material!.id)
          .single();
        return data?.condition;
      })
      .toBe("used");
  });

  await test.step("receiving: log a shortfall, then a partial receipt, reorder list reflects it", async () => {
    await page.getByRole("link", { name: "Receiving" }).click();
    // total_needed=100, received=0 (paste sets received=total_needed
    // normally, but this line was never re-received) — actually paste
    // sets received=100 too, so start by checking the reorder list is
    // empty, then create a real shortfall by editing received down.
    await expect(page.getByText("Reorder list (0)")).toBeVisible();

    const { data: material } = await admin
      .from("materials")
      .select("id")
      .eq("project_id", projectId!)
      .eq("name", "Test Beam")
      .single();
    const { error } = await admin
      .from("materials")
      .update({ received: 40 })
      .eq("id", material!.id);
    if (error) throw error;
    await page.reload();

    await expect(page.getByText("Reorder list (1)")).toBeVisible();
    await expect(page.getByText("60 to order")).toBeVisible();

    // Log a "received" check-in for the shortfall — bumps materials.received.
    await page.getByLabel("Receipt status").selectOption("received");
    await page.locator('input[placeholder="qty"]').fill("60");
    await page.getByRole("button", { name: "Log" }).click();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("materials")
          .select("received")
          .eq("id", material!.id)
          .single();
        return data?.received;
      })
      .toBe(100);

    // Log a "damaged" flag — lands in the open-flags block (Sub-phase E
    // reworked the old static "Flagged: …" text into per-flag rows with a
    // Resolve control, since open flags now block the Materials gate).
    await page.getByLabel("Receipt status").selectOption("damaged");
    await page.locator('input[placeholder="qty"]').fill("3");
    await page.getByRole("button", { name: "Log" }).click();
    await expect(page.getByText(/^Open flags/)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("damaged × 3")).toBeVisible();

    // Resolving the flag clears the open-flags block (the flag row itself
    // stays in the history log forever).
    await page.locator('[data-testid^="resolve-flag-"]').click();
    await expect(page.getByText(/^Open flags/)).toHaveCount(0, {
      timeout: 10_000,
    });

    // The expandable History log has both prior check-ins, newest first.
    const history = page.getByTestId(`material-history-${material!.id}`);
    await expect(history.getByText("History (2)")).toBeVisible();
    await history.locator("summary").click();
    await expect(history.getByText("damaged")).toBeVisible();
    await expect(history.getByText("received")).toBeVisible();
  });

  await test.step("row readiness: toggle inputs, drawing shows a readiness dot, defaults to blocked", async () => {
    await page.getByRole("link", { name: "Layout" }).click();
    await page.getByTestId("row-box-Row 1").click();
    await page.getByRole("button", { name: "Readiness" }).click();

    // A fresh row defaults to blocked (materials_ready/area_accessible
    // both false) — row_progress's own precedence.
    await expect(page.getByText("blocked", { exact: true })).toBeVisible();

    await page.getByLabel("Materials ready").check();
    await page.getByLabel("Area accessible").check();
    await page.getByLabel("Drawing approved").check();

    const { data: rowRecord } = await admin
      .from("rows")
      .select("id")
      .eq("project_id", projectId!)
      .eq("label", "Row 1")
      .single();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("rows")
          .select("materials_ready, area_accessible, drawing_approved")
          .eq("id", rowRecord!.id)
          .single();
        return data;
      })
      .toEqual({
        materials_ready: true,
        area_accessible: true,
        drawing_approved: true,
      });
  });

  await test.step("scheduler warns before assigning a row it thinks is still blocked", async () => {
    const { data: project } = await admin
      .from("projects")
      .select("org_id")
      .eq("id", projectId!)
      .single();
    const { data: crew, error: crewError } = await admin
      .from("crews")
      .insert({
        org_id: project!.org_id,
        name: `[E2E] Materials lifecycle crew ${Date.now()}`,
      })
      .select("id")
      .single();
    if (crewError) throw crewError;

    // Force this row back to blocked for a clean, deterministic warning
    // check, independent of the previous step's own timing (no crew is
    // assigned yet either, so readiness_status would be 'partial' at
    // best regardless — forcing materials_ready false guarantees 'blocked'
    // specifically, which is what the warning message names).
    const { data: rowRecord } = await admin
      .from("rows")
      .select("id")
      .eq("project_id", projectId!)
      .eq("label", "Row 1")
      .single();
    await admin
      .from("rows")
      .update({ materials_ready: false })
      .eq("id", rowRecord!.id);

    await page.goto(`/scheduler/${projectId}`);
    // "+ Assign crew" only renders on days already in the built schedule.
    await page.getByRole("button", { name: "Build schedule" }).click();
    await page.getByRole("button", { name: "Generate days" }).click();
    await page.getByRole("button", { name: "Save schedule" }).click();
    await expect(page.getByText(/scheduled days?/)).toBeVisible({
      timeout: 10_000,
    });

    await page.getByText("+ Assign crew").first().click();
    await page.getByText("Specific rows").click();
    // Not an exact-text match: a blocked row's own button is prefixed
    // with a "⚠ " warning icon (row-command-panel/assign-crew-form's own
    // visual flag for this exact scenario), so its accessible name is
    // "⚠ Row 1", not "Row 1".
    await page.getByRole("button", { name: /Row 1/ }).click();

    // handleSubmit calls window.confirm() with no preceding await (unlike
    // the calendar's assignOrMove, which awaits checkDoubleBooking first)
    // — a synchronous dialog like this blocks click() from resolving at
    // all until the dialog is handled, so Promise.all([waitForEvent,
    // click()]) (the calendar's own pattern, for an async-gap dialog)
    // would deadlock here: click() never resolves without dismiss(), and
    // dismiss() never runs without click() resolving first. A page.once
    // listener reacts independently of click()'s own promise instead.
    let dialogMessage = "";
    page.once("dialog", (dialog) => {
      dialogMessage = dialog.message();
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect
      .poll(() => dialogMessage, { timeout: 10_000 })
      .toContain("blocked");

    await admin.from("crews").delete().eq("id", crew!.id);
  });
});
