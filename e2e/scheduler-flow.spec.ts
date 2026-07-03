import path from "node:path";

import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const FIXTURE_PATH = path.join(__dirname, "fixtures/test-drawing.svg");
const PROJECT_NAME = `[E2E] Scheduler flow ${Date.now()}`;
const CREW_NAME = `[E2E] Scheduler crew ${Date.now()}`;

let projectId: string | null = null;
let crewId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
  if (crewId) {
    const admin = createAdminClient();
    await admin.from("crews").delete().eq("id", crewId);
  }
});

test("scheduler: create crew, build schedule, generate targets, assign crew to a day", async ({
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
    await page.getByTestId("row-box-Row 1").click({ modifiers: ["Shift"] });
    await page.getByTestId("row-box-Row 2").click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "Set materials" }).click();
    await page.locator('[id^="bulk-qty-"]').first().fill("50");
    await page
      .getByRole("button", { name: /Apply to 2 selected rows/ })
      .click();
    await expect(page.getByText("Applied to 2 rows.")).toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step("create a crew with a member", async () => {
    await page.goto("/scheduler");
    await page.getByRole("button", { name: "+ New crew" }).click();
    await page.getByPlaceholder("Crew name").fill(CREW_NAME);
    await page.getByRole("button", { name: "Create crew" }).click();
    await expect(page.getByText(CREW_NAME)).toBeVisible({ timeout: 10_000 });

    const { data } = await admin
      .from("crews")
      .select("id")
      .eq("name", CREW_NAME)
      .single();
    crewId = data!.id;

    await page
      .locator("div", { hasText: CREW_NAME })
      .first()
      .getByPlaceholder("Add crew member")
      .fill("Alex");
    await page
      .locator("div", { hasText: CREW_NAME })
      .first()
      .getByRole("button", { name: "Add" })
      .click();
    // Not exact: true — the member pill's "Alex" and its "×" remove button
    // share one <span>, so no single element's own text is exactly "Alex".
    await expect(page.getByText("Alex")).toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step("open the project in the scheduler", async () => {
    await page.getByText(PROJECT_NAME).click();
    await page.waitForURL(new RegExp(`/scheduler/${projectId}$`));
  });

  await test.step("build a schedule and generate targets", async () => {
    await page.getByRole("button", { name: "Build schedule" }).click();
    await page.getByRole("button", { name: "Generate days" }).click();
    await page.getByRole("button", { name: "Save schedule" }).click();
    await expect(page.getByText(/scheduled days?/)).toBeVisible({
      timeout: 10_000,
    });

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("project_schedule")
          .select("work_date")
          .eq("project_id", projectId!);
        return data?.length ?? 0;
      })
      .toBeGreaterThan(0);

    await page
      .getByRole("button", { name: "Generate targets from today forward" })
      .click();
    await expect(page.getByText(/Targets set for/)).toBeVisible({
      timeout: 10_000,
    });
    // The week view's own re-render (via router.refresh()) isn't awaited by
    // the button handler, so it can lag a beat behind the toast — confirm
    // today's row actually shows a target, not just that the action's own
    // "done" message appeared.
    await expect(page.getByText(/^0 \/ \d+$/)).toBeVisible({
      timeout: 10_000,
    });

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("targets")
          .select("target_qty")
          .eq("project_id", projectId!);
        return data?.length ?? 0;
      })
      .toBeGreaterThan(0);
  });

  await test.step("assign the crew to today and verify it shows in the week view", async () => {
    await page.getByText("+ Assign crew").first().click();
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByText(CREW_NAME).last()).toBeVisible({
      timeout: 10_000,
    });

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("assignments")
          .select("id")
          .eq("project_id", projectId!)
          .eq("crew_id", crewId!);
        return data?.length ?? 0;
      })
      .toBe(1);
  });

  await test.step("unassign the crew", async () => {
    await page.getByRole("button", { name: "Unassign" }).click();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("assignments")
          .select("id")
          .eq("project_id", projectId!)
          .eq("crew_id", crewId!);
        return data?.length ?? 0;
      })
      .toBe(0);
  });
});
