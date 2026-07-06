import { expect, test } from "@playwright/test";

import { deleteAuthUserByEmail, deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const TEST_ITEM_LABEL = `[E2E] Template item ${Date.now()}`;
const RENAMED_LABEL = `${TEST_ITEM_LABEL} renamed`;
const TEMPLATE_PROJECT_NAME = `[E2E] Template test project ${Date.now()}`;
const NAG_PROJECT_NAME = `[E2E] Nag test project ${Date.now()}`;
const PM_EMAIL = `e2e+gate-template-pm-${Date.now()}@handyequip.test`;
const PM_PASSWORD = "e2e-pm-password-1!";

let templateItemId: string | null = null;
let templateProjectId: string | null = null;
let nagProjectId: string | null = null;
let pmUserId: string | null = null;

test.afterAll(async () => {
  const admin = createAdminClient();
  if (templateItemId) {
    await admin.from("gate_template_items").delete().eq("id", templateItemId);
  }
  if (templateProjectId) await deleteProjectCompletely(templateProjectId);
  if (nagProjectId) await deleteProjectCompletely(nagProjectId);
  if (pmUserId) await deleteAuthUserByEmail(PM_EMAIL);
});

test("owner can add/edit/remove a checklist template item; new projects copy it; PM sees it read-only", async ({
  page,
  browser,
}) => {
  const admin = createAdminClient();

  await test.step("owner adds a new item to Mobilize", async () => {
    await page.goto("/app/settings");
    await expect(page.getByText("Project checklist template")).toBeVisible();

    const mobilizeCard = page.getByTestId("template-stage-mobilize");
    await mobilizeCard.getByPlaceholder("Add a checklist item…").fill(TEST_ITEM_LABEL);
    await mobilizeCard.getByRole("button", { name: "+ Add" }).click();

    // Resolve the new row's id from the DB first — Playwright has no
    // "find by current input value" locator (that's a Testing Library
    // API, not Playwright's), so every other step targets this row via
    // its own data-testid instead.
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("gate_template_items")
          .select("id")
          .eq("label", TEST_ITEM_LABEL)
          .maybeSingle();
        templateItemId = data?.id ?? null;
        return templateItemId;
      })
      .not.toBeNull();

    await expect(page.getByTestId(`template-item-${templateItemId}`)).toBeVisible();
  });

  await test.step("owner toggles Photo required and renames it", async () => {
    const row = page.getByTestId(`template-item-${templateItemId}`);
    await row.getByRole("checkbox").check();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("gate_template_items")
          .select("requires_photo")
          .eq("id", templateItemId!)
          .single();
        return data?.requires_photo;
      })
      .toBe(true);

    const labelInput = row.getByLabel("Item label");
    await labelInput.fill(RENAMED_LABEL);
    await labelInput.blur();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("gate_template_items")
          .select("label")
          .eq("id", templateItemId!)
          .single();
        return data?.label;
      })
      .toBe(RENAMED_LABEL);
  });

  await test.step("a brand-new project copies the renamed item", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(TEMPLATE_PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    templateProjectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("project_gate_items")
          .select("id")
          .eq("label", RENAMED_LABEL);
        return data?.length ?? 0;
      })
      .toBeGreaterThanOrEqual(1);
  });

  await test.step("PM role sees the template read-only — no edit controls", async () => {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: PM_EMAIL,
      password: PM_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    pmUserId = created.user.id;

    const { data: org } = await admin
      .from("organizations")
      .select("id")
      .limit(1)
      .single();
    const { error: profileError } = await admin
      .from("profiles")
      .update({ org_id: org!.id, role: "pm" })
      .eq("id", pmUserId);
    if (profileError) throw profileError;

    const context = await browser.newContext();
    const pmPage = await context.newPage();
    await pmPage.goto("/login");
    await pmPage.getByLabel("Work email").fill(PM_EMAIL);
    await pmPage.getByLabel("Password").fill(PM_PASSWORD);
    await pmPage.getByRole("button", { name: "Sign in" }).click();
    await pmPage.waitForURL("/app");

    await pmPage.goto("/app/settings");
    const mobilizeCard = pmPage.getByTestId("template-stage-mobilize");
    await expect(mobilizeCard.getByText(RENAMED_LABEL)).toBeVisible();
    await expect(mobilizeCard.getByPlaceholder("Add a checklist item…")).toHaveCount(0);
    await expect(mobilizeCard.getByRole("button", { name: /Remove/ })).toHaveCount(0);

    await context.close();
  });

  await test.step("owner removes the test item — cleans up the shared template", async () => {
    // The previous step's "create project" navigated the shared `page`
    // away to that project's Overview — back to Settings first.
    await page.goto("/app/settings");
    const row = page.getByTestId(`template-item-${templateItemId}`);
    await row.getByRole("button", { name: /Remove/ }).click();

    const removedItemId = templateItemId;
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("gate_template_items")
          .select("id")
          .eq("id", removedItemId!)
          .maybeSingle();
        return data;
      })
      .toBeNull();
    templateItemId = null;
  });
});

test("gate nags: an overdue item and a stalled project each notify, and surface in the bell + dashboard", async ({
  page,
}) => {
  const admin = createAdminClient();

  await test.step("set up a project with an overdue item and stale activity", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(NAG_PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    nagProjectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    const { data: org } = await admin
      .from("organizations")
      .select("id, stalled_after_days")
      .limit(1)
      .single();
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - (org!.stalled_after_days + 1));

    const { error: projectError } = await admin
      .from("projects")
      .update({ last_activity_at: staleDate.toISOString() })
      .eq("id", nagProjectId);
    if (projectError) throw projectError;

    const { data: handoffStage } = await admin
      .from("project_stages")
      .select("id")
      .eq("project_id", nagProjectId)
      .eq("stage_key", "handoff")
      .single();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const { error: itemError } = await admin
      .from("project_gate_items")
      .update({ due_date: yesterday.toISOString().slice(0, 10) })
      .eq("project_stage_id", handoffStage!.id)
      .eq("label", "Site survey completed with photos");
    if (itemError) throw itemError;
  });

  await test.step("trigger the daily cron — creates notifications for this project", async () => {
    const cronSecret = process.env.CRON_SECRET;
    const response = await page.request.get("/api/cron/reports/daily", {
      headers: cronSecret ? { authorization: `Bearer ${cronSecret}` } : {},
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.gateNags.projectsChecked).toBeGreaterThanOrEqual(1);

    // Not an exact-count check: the previous test's temp PM user is still
    // active until this file's own afterAll runs, so recipients here can
    // be the owner alone OR owner+that PM depending on run order — assert
    // both KINDS exist for this project, not how many rows there are.
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("notifications")
          .select("kind")
          .contains("payload", { projectId: nagProjectId });
        const kinds = new Set((data ?? []).map((n) => n.kind));
        return kinds.has("gate_item_overdue") && kinds.has("project_stalled");
      })
      .toBe(true);
  });

  await test.step("the bell shows the new notifications and marking one read persists", async () => {
    await page.goto("/app");
    const bellButton = page.getByRole("button", { name: /unread notifications?/ });
    await expect(bellButton).toBeVisible();
    await bellButton.click();

    // NAG_PROJECT_NAME contains literal "[E2E]" — safe as a plain-string
    // hasText filter (substring match), NOT as a constructed RegExp
    // (square brackets are regex syntax and would break the match).
    const dropdown = page.getByTestId("notification-dropdown");
    const overdueEntry = dropdown
      .locator("li")
      .filter({ hasText: NAG_PROJECT_NAME })
      .filter({ hasText: "overdue" });
    await expect(overdueEntry).toBeVisible();
    await overdueEntry.click();

    // At least one (the owner's own — the only one this browser session
    // could have clicked) is now read; not asserting a single global row,
    // for the same multi-recipient reason as the step above.
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("notifications")
          .select("id")
          .contains("payload", { projectId: nagProjectId })
          .eq("kind", "gate_item_overdue")
          .not("read_at", "is", null);
        return data?.length ?? 0;
      })
      .toBeGreaterThanOrEqual(1);
  });

  await test.step("dashboard's Needs attention section lists this project", async () => {
    await page.goto("/app/dashboard");
    const attentionList = page.getByTestId("lifecycle-attention-list");
    const projectRow = attentionList.locator("li").filter({ hasText: NAG_PROJECT_NAME });
    await expect(projectRow).toBeVisible();
    await expect(projectRow.getByText(/Stalled \d+d/)).toBeVisible();
    await expect(projectRow.getByText(/overdue/)).toBeVisible();
  });
});
