import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const PROJECT_A = `[E2E] Capacity A ${Date.now()}`;
const PROJECT_B = `[E2E] Capacity B ${Date.now()}`;
const PROJECT_C = `[E2E] Capacity C ${Date.now()}`;

let projectAId: string | null = null;
let projectBId: string | null = null;
let projectCId: string | null = null;

test.afterAll(async () => {
  for (const id of [projectAId, projectBId, projectCId]) {
    if (id) await deleteProjectCompletely(id);
  }
});

async function createProjectViaUi(
  page: import("@playwright/test").Page,
  name: string
): Promise<string> {
  await page.goto("/app");
  await page.getByRole("button", { name: "+ New project" }).click();
  await page.locator("#name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/app\/project\/[^/]+$/);
  return /\/app\/project\/([^/]+)$/.exec(page.url())![1];
}

test("capacity: hard block over num_crews with conflicts + feasible start, owner override logged + dashboard, board shows commitments, gate item auto-ticks", async ({
  page,
}) => {
  const admin = createAdminClient();
  test.setTimeout(150_000);

  await test.step("project A commits a schedule cleanly — its capacity gate item auto-ticks", async () => {
    projectAId = await createProjectViaUi(page, PROJECT_A);
    await page.goto(`/scheduler/${projectAId}`);
    await page.getByRole("button", { name: "Build schedule" }).click();
    await page.getByRole("button", { name: "Generate days" }).click();
    await page.getByRole("button", { name: "Save schedule" }).click();
    await expect(page.getByText(/scheduled days?/)).toBeVisible({
      timeout: 10_000,
    });

    await expect
      .poll(async () => {
        const { data: stage } = await admin
          .from("project_stages")
          .select("id")
          .eq("project_id", projectAId!)
          .eq("stage_key", "schedule")
          .single();
        const { data: item } = await admin
          .from("project_gate_items")
          .select("done")
          .eq("project_stage_id", stage!.id)
          .eq("label", "Dates committed within capacity")
          .single();
        return item?.done;
      })
      .toBe(true);
  });

  await test.step("project B fills the second crew slot on the same days (admin setup)", async () => {
    projectBId = await createProjectViaUi(page, PROJECT_B);
    const { data: aSchedule } = await admin
      .from("project_schedule")
      .select("work_date")
      .eq("project_id", projectAId!);
    const { error } = await admin.from("project_schedule").insert(
      aSchedule!.map((row) => ({
        project_id: projectBId!,
        work_date: row.work_date,
      }))
    );
    if (error) throw error;
  });

  await test.step("project C is blocked: conflicts name A and B, a feasible start is suggested, nothing saved", async () => {
    projectCId = await createProjectViaUi(page, PROJECT_C);
    await page.goto(`/scheduler/${projectCId}`);
    await page.getByRole("button", { name: "Build schedule" }).click();
    await page.getByRole("button", { name: "Generate days" }).click();
    await page.getByRole("button", { name: "Save schedule" }).click();

    const panel = page.getByTestId("capacity-conflict-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel).toContainText("Over capacity");
    await expect(panel.getByText(PROJECT_A).first()).toBeVisible();
    await expect(panel.getByText(PROJECT_B).first()).toBeVisible();
    await expect(page.getByTestId("suggested-start")).not.toBeEmpty();

    const { data: cSchedule } = await admin
      .from("project_schedule")
      .select("id")
      .eq("project_id", projectCId!);
    expect(cSchedule).toHaveLength(0);
  });

  await test.step("owner override with a reason saves the schedule and logs the override — but the gate item stays unticked", async () => {
    await page
      .getByLabel("Override reason")
      .fill("Borrowed a third crew from HE South for two weeks");
    await page.getByRole("button", { name: "Override & save anyway" }).click();
    await expect(page.getByText(/scheduled days?/)).toBeVisible({
      timeout: 10_000,
    });

    const { data: cSchedule } = await admin
      .from("project_schedule")
      .select("id")
      .eq("project_id", projectCId!);
    expect(cSchedule!.length).toBeGreaterThan(0);

    const { data: override } = await admin
      .from("capacity_overrides")
      .select("reason, conflict_dates, created_by")
      .eq("project_id", projectCId!)
      .single();
    expect(override!.reason).toContain("Borrowed a third crew");
    expect(override!.conflict_dates.length).toBeGreaterThan(0);
    expect(override!.created_by).not.toBeNull();

    // Overridden ≠ within capacity — the item deliberately stays open.
    const { data: stage } = await admin
      .from("project_stages")
      .select("id")
      .eq("project_id", projectCId!)
      .eq("stage_key", "schedule")
      .single();
    const { data: item } = await admin
      .from("project_gate_items")
      .select("done")
      .eq("project_stage_id", stage!.id)
      .eq("label", "Dates committed within capacity")
      .single();
    expect(item!.done).toBe(false);
  });

  await test.step("the dashboard surfaces the capacity override", async () => {
    await page.goto("/app/dashboard");
    const list = page.getByTestId("capacity-override-list");
    await expect(list).toBeVisible();
    await expect(list.getByText(PROJECT_C)).toBeVisible();
    await expect(list.getByText(/Borrowed a third crew/)).toBeVisible();
  });

  await test.step("the capacity board shows the over-committed month at a glance", async () => {
    // View the month the schedules actually start in — if today is the
    // last weekend of a month, a skip-weekends schedule starts next month.
    const { data: firstDay } = await admin
      .from("project_schedule")
      .select("work_date")
      .eq("project_id", projectAId!)
      .order("work_date")
      .limit(1)
      .single();
    await page.goto(
      `/scheduler/capacity?month=${firstDay!.work_date.slice(0, 7)}`
    );
    await expect(page.getByTestId("over-capacity-summary")).toBeVisible();
    const board = page.getByTestId("capacity-board");
    await expect(board.getByText(PROJECT_A).first()).toBeVisible();
    await expect(board.getByText(PROJECT_B).first()).toBeVisible();
    await expect(board.getByText(PROJECT_C).first()).toBeVisible();
  });
});
