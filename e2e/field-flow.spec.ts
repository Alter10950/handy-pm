import path from "node:path";

import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { clearDispatchGate } from "./helpers/gates";
import { createAdminClient } from "./helpers/supabase-admin";

const FIXTURE_PATH = path.join(__dirname, "fixtures/test-drawing.svg");
const PROJECT_NAME = `[E2E] Field flow ${Date.now()}`;
const CREW_NAME = `[E2E] Crew ${Date.now()}`;

// Mobile-first feature — test at a phone-sized viewport (this is the
// primary shape it'll actually be used at, not incidental).
test.use({ viewport: { width: 390, height: 844 } });

let projectId: string | null = null;
let crewId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
  if (crewId) {
    const admin = createAdminClient();
    await admin.from("crews").delete().eq("id", crewId);
  }
});

test("field: pick project, select crew, log materials, report a blocker, offline queue, close the day", async ({
  page,
}) => {
  const admin = createAdminClient();

  await test.step("set up a project with a row and required materials", async () => {
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

    await page.getByRole("button", { name: /Auto rows/ }).click();
    await page.locator("#row-count").fill("2");
    await page.locator("#row-orientation").selectOption("vertical");
    await page.getByRole("button", { name: "Next → drag box" }).click();
    await expect(page.getByText("Auto-create rows")).not.toBeVisible();
    const layoutImage = page.locator('img[alt="Layout drawing"]');
    // On this suite's narrow mobile viewport, the drawing-version panel
    // (added in Batch 3 sub-phase G) pushes the stage further down the
    // page than before — scroll it fully into view first so a 0.05..0.95
    // drag actually lands on the canvas instead of partly below the fold.
    await layoutImage.scrollIntoViewIfNeeded();
    const stageBox = (await layoutImage.boundingBox())!;
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

    await page.getByRole("link", { name: "Materials", exact: true }).click();
    await page
      .getByRole("button", { name: /Paste from packing slip/i })
      .click();
    await page.locator("textarea").fill("Bolt, 50");
    await page.getByRole("button", { name: "Add materials" }).click();
    await expect(page.locator("table").first().locator("tbody tr")).toHaveCount(
      1
    );

    await page.getByRole("link", { name: "Layout", exact: true }).click();
    await page.getByTestId("row-box-Row 1").click();
    await page.getByRole("button", { name: "Set materials" }).click();
    await page.locator('[id^="bulk-qty-"]').first().fill("50");
    await page.getByRole("button", { name: /Apply to 1 selected row/ }).click();
    await expect(page.getByText("Applied to 1 row.")).toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step("create a test crew directly (no crew-management UI yet — Sub-phase C)", async () => {
    const { data: org } = await admin
      .from("projects")
      .select("org_id")
      .eq("id", projectId!)
      .single();
    const { data, error } = await admin
      .from("crews")
      .insert({ org_id: org!.org_id, name: CREW_NAME })
      .select("id")
      .single();
    if (error) throw error;
    crewId = data.id;

    // Sub-phase E's Mobilize lock would show this crew "Not cleared for
    // install" instead of the working UI (materials were never verified
    // in this spec) — clearing it is material-gate-flow.spec.ts's
    // subject, not this test's.
    await clearDispatchGate(projectId!);
  });

  await test.step("project appears in the Field project list", async () => {
    await page.goto("/field");
    await expect(
      page.locator("#main-content").getByText(PROJECT_NAME)
    ).toBeVisible();
    await page.locator("#main-content").getByText(PROJECT_NAME).click();
    await page.waitForURL(new RegExp(`/field/${projectId}$`));
  });

  await test.step("pick crew, log a material install", async () => {
    await page.locator("#crew-select").selectOption({ label: CREW_NAME });
    await page.getByText("Row 1", { exact: true }).click();
    await expect(page.getByText("0 / 50")).toBeVisible();

    // Accessible name is "Increase quantity" (an aria-label added in the
    // Sub-phase I accessibility pass), not the raw "+" glyph it displays.
    await page.getByRole("button", { name: "Increase quantity" }).click(); // qty 1 -> 2
    await page.getByRole("button", { name: "Log +2" }).click();
    await expect(page.getByText("Logged")).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("installs")
          .select("qty")
          .eq(
            "row_id",
            (
              await admin
                .from("rows")
                .select("id")
                .eq("project_id", projectId!)
                .eq("label", "Row 1")
                .single()
            ).data!.id
          );
        return data?.reduce((sum, row) => sum + row.qty, 0) ?? 0;
      })
      .toBe(2);
  });

  await test.step("report a blocker", async () => {
    await page.getByRole("button", { name: "← Rows" }).click();
    await page.getByRole("button", { name: "Report a blocker" }).click();
    await page.getByRole("button", { name: "Missing material" }).click();
    await page.locator("textarea").fill("Short on anchors");
    await page.getByRole("button", { name: "Submit blocker" }).click();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("blockers")
          .select("code, note")
          .eq("project_id", projectId!);
        return data?.length ?? 0;
      })
      .toBe(1);
  });

  await test.step("offline queue: a delta logged offline queues, then drains on reconnect", async () => {
    await page.getByText("Row 1", { exact: true }).click();
    await page.context().setOffline(true);

    await page.getByRole("button", { name: "Log +1" }).click();
    await expect(page.getByText("Queued — will sync")).toBeVisible();
    await expect(page.getByText(/1 update.*pending sync/)).toBeVisible();

    await page.context().setOffline(false);
    await expect(page.getByText(/pending sync/)).not.toBeVisible({
      timeout: 10_000,
    });

    await expect
      .poll(async () => {
        const { data: row } = await admin
          .from("rows")
          .select("id")
          .eq("project_id", projectId!)
          .eq("label", "Row 1")
          .single();
        const { data } = await admin
          .from("installs")
          .select("qty")
          .eq("row_id", row!.id);
        return data?.reduce((sum, r) => sum + r.qty, 0) ?? 0;
      })
      .toBe(3); // the earlier +2 plus this +1
  });

  await test.step("confirm day times, attach a photo, review the day summary, then close", async () => {
    await page.getByRole("button", { name: "Day" }).click();
    const arrivedRow = page.getByTestId("day-log-row-arrivedAt");
    await arrivedRow.getByRole("button", { name: "Mark now" }).click();
    await expect(arrivedRow.getByText(/AM|PM/)).toBeVisible({
      timeout: 10_000,
    });

    // End-of-day photo — distinct from a blocker's photo (general
    // documentation, not tied to a reported problem). Synthetic in-memory
    // image, same technique as the packing-slip/logo upload tests.
    const photoPage = await page.context().newPage();
    await photoPage.setContent(
      `<html><body style="margin:0;width:100px;height:100px;background:#3a3a3a;"></body></html>`
    );
    const photoBuffer = await photoPage.screenshot();
    await photoPage.close();
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
      name: "end-of-day.png",
      mimeType: "image/png",
      buffer: photoBuffer,
    });
    await expect(
      page.getByRole("button", { name: "Remove photo" })
    ).toBeVisible({ timeout: 15_000 });

    // "Close the day" opens a review screen first (edit/resume before
    // final submit) — it must NOT close immediately, and must show an
    // accurate summary of what was actually logged today (3 total: the
    // +2 from earlier, plus the +1 logged while offline), plus the photo
    // just attached.
    await page.getByRole("button", { name: "Close the day" }).click();
    await expect(
      page.getByRole("heading", { name: "Review today & close" })
    ).toBeVisible();
    await expect(page.getByText("Row 1 — Bolt")).toBeVisible();
    await expect(page.getByText("+3 ea")).toBeVisible();
    await expect(page.getByText("1 reported today.")).toBeVisible();
    await expect(page.getByAltText("End-of-day")).toBeVisible();

    // Can still back out to edit before finalizing.
    await page.getByRole("button", { name: "← Back to edit" }).click();
    await expect(
      page.getByRole("button", { name: "Close the day" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Close the day" }).click();
    await page.getByRole("button", { name: "Confirm & close day" }).click();
    await expect(page.getByText(/Day closed/)).toBeVisible({
      timeout: 10_000,
    });

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("day_logs")
          .select("departed_at")
          .eq("project_id", projectId!)
          .eq("crew_id", crewId!)
          .single();
        return data?.departed_at ?? null;
      })
      .not.toBeNull();
  });
});

test("field: my assignments today are highlighted on the project list", async ({
  page,
}) => {
  const admin = createAdminClient();
  const projectName = `[E2E] Field assignments ${Date.now()}`;
  const crewName = `[E2E] Assignment crew ${Date.now()}`;
  let localProjectId: string | null = null;
  let localCrewId: string | null = null;

  try {
    await test.step("create an active project and a crew, assign the crew to it today", async () => {
      await page.goto("/app");
      await page.getByRole("button", { name: "+ New project" }).click();
      await page.locator("#name").fill(projectName);
      await page.getByRole("button", { name: "Create project" }).click();
      await page.waitForURL(/\/app\/project\/[^/]+$/);
      localProjectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

      const { data: org } = await admin
        .from("projects")
        .select("org_id")
        .eq("id", localProjectId)
        .single();
      const { data: crew, error } = await admin
        .from("crews")
        .insert({ org_id: org!.org_id, name: crewName })
        .select("id")
        .single();
      if (error) throw error;
      localCrewId = crew.id;

      const today = new Date().toISOString().slice(0, 10);
      const { error: assignError } = await admin.from("assignments").insert({
        project_id: localProjectId,
        crew_id: localCrewId,
        row_id: null,
        work_date: today,
      });
      if (assignError) throw assignError;
    });

    await test.step("selecting that crew on /field highlights it as today's assignment", async () => {
      await page.goto("/field");
      await page.locator("#home-crew-select").selectOption({ label: crewName });
      await expect(page.getByText("My assignments today")).toBeVisible();
      await expect(
        page.locator("#main-content").getByText(projectName)
      ).toBeVisible();
    });
  } finally {
    if (localProjectId) await deleteProjectCompletely(localProjectId);
    if (localCrewId) {
      await admin.from("crews").delete().eq("id", localCrewId);
    }
  }
});
