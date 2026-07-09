import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { clearDispatchGate } from "./helpers/gates";
import { createAdminClient } from "./helpers/supabase-admin";

const PROJECT_A_NAME = `[E2E] Calendar A ${Date.now()}`;
const PROJECT_B_NAME = `[E2E] Calendar B ${Date.now()}`;
const CREW_NAME = `[E2E] Calendar crew ${Date.now()}`;

let projectAId: string | null = null;
let projectBId: string | null = null;
let crewId: string | null = null;

test.afterAll(async () => {
  if (projectAId) await deleteProjectCompletely(projectAId);
  if (projectBId) await deleteProjectCompletely(projectBId);
  if (crewId) {
    const admin = createAdminClient();
    await admin.from("crews").delete().eq("id", crewId);
  }
});

test("crew calendar: drag to assign, double-booking warning, remove", async ({
  page,
}) => {
  const admin = createAdminClient();

  await test.step("create two active projects and a crew", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_A_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectAId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_B_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectBId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    const { data: org } = await admin
      .from("projects")
      .select("org_id")
      .eq("id", projectAId)
      .single();
    const { data: crew, error } = await admin
      .from("crews")
      .insert({ org_id: org!.org_id, name: CREW_NAME, size: 2 })
      .select("id")
      .single();
    if (error) throw error;
    crewId = crew.id;

    // Sub-phase E's dispatch gate would reject every drag below (neither
    // project's materials were verified) — clearing it is material-gate-
    // flow.spec.ts's subject, not this test's.
    await clearDispatchGate(projectAId!);
    await clearDispatchGate(projectBId!);
  });

  await test.step("drag project A onto today's cell for the crew", async () => {
    await page.goto("/scheduler/calendar");
    const today = new Date().toISOString().slice(0, 10);

    await page
      .locator("#main-content")
      .getByText(PROJECT_A_NAME, { exact: true })
      .dragTo(page.getByTestId(`calendar-cell-${crewId}-${today}`));

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("assignments")
          .select("id")
          .eq("project_id", projectAId!)
          .eq("crew_id", crewId!)
          .eq("work_date", today);
        return data?.length ?? 0;
      })
      .toBe(1);
    await expect(
      page
        .getByTestId(`calendar-cell-${crewId}-${today}`)
        .getByText(PROJECT_A_NAME)
    ).toBeVisible();
  });

  await test.step("dragging project B onto the same cell warns about double-booking", async () => {
    const today = new Date().toISOString().slice(0, 10);

    // The drop handler is async (awaits checkDoubleBooking before ever
    // calling window.confirm), so dragTo() resolving doesn't mean the
    // dialog has appeared yet — wait for the actual dialog event
    // alongside the drag, not a fire-and-forget `page.once` racing a
    // synchronous assertion right after.
    const [dialog] = await Promise.all([
      page.waitForEvent("dialog"),
      page
        .locator("#main-content")
        .getByText(PROJECT_B_NAME, { exact: true })
        .dragTo(page.getByTestId(`calendar-cell-${crewId}-${today}`)),
    ]);
    const dialogMessage = dialog.message();
    await dialog.accept();

    expect(dialogMessage).toContain(PROJECT_A_NAME);

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("assignments")
          .select("id")
          .eq("project_id", projectBId!)
          .eq("crew_id", crewId!)
          .eq("work_date", today);
        return data?.length ?? 0;
      })
      .toBe(1);
  });

  await test.step("remove one of the assignments", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const cell = page.getByTestId(`calendar-cell-${crewId}-${today}`);
    await cell
      .getByRole("button", { name: `Remove ${PROJECT_B_NAME} assignment` })
      .click();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("assignments")
          .select("id")
          .eq("project_id", projectBId!)
          .eq("crew_id", crewId!)
          .eq("work_date", today);
        return data?.length ?? 0;
      })
      .toBe(0);
    await expect(cell.getByText(PROJECT_B_NAME)).not.toBeVisible();
    // The first assignment (project A) must survive the removal of the
    // second, unrelated one.
    await expect(cell.getByText(PROJECT_A_NAME)).toBeVisible();
  });
});
