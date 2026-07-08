import { expect, test } from "@playwright/test";

import {
  deleteAuthUserByEmail,
  deleteProjectCompletely,
} from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const PROJECT_NAME = `[E2E] PM record ${Date.now()}`;
const SECOND_PROJECT_NAME = `[E2E] PM record other ${Date.now()}`;
const PM_EMAIL = `e2e+pm-record-${Date.now()}@handyequip.test`;
const PM_PASSWORD = "e2e-pm-record-password-1!";

let projectId: string | null = null;
let secondProjectId: string | null = null;
let newPmUserId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
  if (secondProjectId) await deleteProjectCompletely(secondProjectId);
  if (newPmUserId) await deleteAuthUserByEmail(PM_EMAIL);
});

test("PM of record: defaults to creator, shows everywhere, reassignment logs an audit row and notifies", async ({
  page,
}) => {
  const admin = createAdminClient();

  const { data: owner } = await admin
    .from("profiles")
    .select("id, org_id")
    .eq("role", "owner")
    .limit(1)
    .single();

  await test.step("create a PM candidate to reassign to", async () => {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: PM_EMAIL,
      password: PM_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    newPmUserId = created.user.id;
    const { error: profileError } = await admin
      .from("profiles")
      .update({ org_id: owner!.org_id, role: "pm" })
      .eq("id", newPmUserId);
    if (profileError) throw profileError;
  });

  await test.step("new project defaults its PM to the creator", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    // No interaction with #pm_user_id — confirms the default-to-self
    // value is what actually submits.
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("projects")
          .select("pm_user_id")
          .eq("id", projectId!)
          .single();
        return data?.pm_user_id;
      })
      .toBe(owner!.id);
  });

  await test.step("PM shows on the Overview page", async () => {
    await expect(page.getByText("PM of record")).toBeVisible();
  });

  await test.step("PM shows on the project card", async () => {
    await page.goto("/app");
    const card = page.locator("a").filter({ hasText: PROJECT_NAME });
    // Redesigned card shows the PM as icon + name (no "PM:" prefix) and
    // an explicit warning state when unassigned — so assert the absence
    // of the warning plus the presence of the owner's label.
    await expect(card.getByText("No PM assigned")).toHaveCount(0);
    await expect(card.getByText(/@|E2E Owner/i)).toBeVisible();
  });

  await test.step("reassign the PM — updates DB, logs history, notifies the new PM", async () => {
    await page.goto(`/app/project/${projectId}`);
    await page.getByRole("button", { name: "Reassign" }).click();
    await page.getByLabel("Reassign PM").selectOption(newPmUserId!);
    await page.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("projects")
          .select("pm_user_id")
          .eq("id", projectId!)
          .single();
        return data?.pm_user_id;
      })
      .toBe(newPmUserId);

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("project_pm_history")
          .select("previous_pm_user_id, new_pm_user_id, changed_by")
          .eq("project_id", projectId!)
          .maybeSingle();
        return data;
      })
      .toEqual({
        previous_pm_user_id: owner!.id,
        new_pm_user_id: newPmUserId,
        changed_by: owner!.id,
      });

    // The owner performed the reassignment and was also the previous PM
    // — they shouldn't notify themselves. Only the incoming PM should
    // get a notification here.
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("notifications")
          .select("id")
          .eq("user_id", newPmUserId!)
          .eq("kind", "pm_reassigned")
          .contains("payload", { projectId, isNewPm: true });
        return data?.length ?? 0;
      })
      .toBeGreaterThanOrEqual(1);

    const { data: ownerSelfNotifications } = await admin
      .from("notifications")
      .select("id")
      .eq("user_id", owner!.id)
      .eq("kind", "pm_reassigned")
      .contains("payload", { projectId });
    expect(ownerSelfNotifications?.length ?? 0).toBe(0);
  });

  await test.step('"My projects only" filter hides projects not assigned to the viewer', async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(SECOND_PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    secondProjectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    await page.goto("/app");
    await expect(page.getByText(PROJECT_NAME)).toBeVisible();
    await expect(page.getByText(SECOND_PROJECT_NAME)).toBeVisible();

    await page.getByLabel("My projects only").check();
    await expect(page.getByText(SECOND_PROJECT_NAME)).toBeVisible();
    await expect(page.getByText(PROJECT_NAME)).not.toBeVisible();
  });

  await test.step("dashboard's project list shows the PM column", async () => {
    await page.goto("/app/dashboard");
    const row = page.locator("tr").filter({ hasText: SECOND_PROJECT_NAME });
    await expect(row).toBeVisible();
    // Second project defaulted to the owner (creator) — should render a
    // real name, not the "Unassigned" warning state.
    await expect(row.getByText("Unassigned")).toHaveCount(0);
  });
});
