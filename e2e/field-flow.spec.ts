import path from "node:path";

import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
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
    await page.locator("textarea").fill("Bolt, 50");
    await page.getByRole("button", { name: "Add materials" }).click();
    await expect(page.locator("table").first().locator("tbody tr")).toHaveCount(
      1
    );

    await page.getByRole("link", { name: "Layout" }).click();
    await page.getByTestId("row-box-Row 1").click();
    await page.getByRole("button", { name: "Set materials" }).click();
    await page.locator('[id^="bulk-qty-"]').first().fill("50");
    await page
      .getByRole("button", { name: /Apply to 1 selected row/ })
      .click();
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
  });

  await test.step("project appears in the Field project list", async () => {
    await page.goto("/field");
    await expect(page.getByText(PROJECT_NAME)).toBeVisible();
    await page.getByText(PROJECT_NAME).click();
    await page.waitForURL(new RegExp(`/field/${projectId}$`));
  });

  await test.step("pick crew, log a material install", async () => {
    await page.locator("#crew-select").selectOption({ label: CREW_NAME });
    await page.getByText("Row 1", { exact: true }).click();
    await expect(page.getByText("0 / 50")).toBeVisible();

    await page.getByRole("button", { name: "+", exact: true }).click(); // qty 1 -> 2
    await page.getByRole("button", { name: "Log +2" }).click();
    await expect(page.getByText("Logged")).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("installs")
          .select("qty")
          .eq("row_id", (await admin.from("rows").select("id").eq("project_id", projectId!).eq("label", "Row 1").single()).data!.id);
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

  await test.step("confirm day times and close the day", async () => {
    await page.getByRole("button", { name: "Day" }).click();
    const arrivedRow = page.getByTestId("day-log-row-arrivedAt");
    await arrivedRow.getByRole("button", { name: "Mark now" }).click();
    await expect(arrivedRow.getByText(/AM|PM/)).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: "Close the day" }).click();
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
