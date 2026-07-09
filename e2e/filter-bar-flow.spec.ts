import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

// Design pass v3 D2: the app-wide FilterBar — instant search, facet
// filtering, active chips, persistence across reload, saved views.
const STAMP = Date.now();
const ACTIVE_NAME = `[E2E] FB Active ${STAMP}`;
const HOLD_NAME = `[E2E] FB Hold ${STAMP}`;

const projectIds: string[] = [];

test.afterAll(async () => {
  for (const id of projectIds) await deleteProjectCompletely(id);
});

test("FilterBar: search + status facet filter, chips, persistence across reload, saved view recall", async ({
  page,
}) => {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .limit(1)
    .single();

  for (const [name, status] of [
    [ACTIVE_NAME, "active"],
    [HOLD_NAME, "on_hold"],
  ] as const) {
    const { data, error } = await admin
      .from("projects")
      .insert({ org_id: org!.id, name, status })
      .select("id")
      .single();
    if (error) throw error;
    projectIds.push(data.id);
  }

  await page.goto("/app");

  await test.step("search narrows instantly", async () => {
    await page.getByTestId("projects-search").fill(`FB Active ${STAMP}`);
    await expect(
      page.getByRole("link", {
        name: new RegExp(ACTIVE_NAME.replace(/[[\]]/g, "\\$&")),
      })
    ).toBeVisible();
    await expect(page.getByText(HOLD_NAME)).toHaveCount(0);
    await page.getByTestId("projects-search").fill(String(STAMP));
  });

  await test.step("status facet filters and shows an active chip", async () => {
    await page.getByTestId("filter-facet-status").click();
    await page.getByRole("menuitemcheckbox", { name: "On hold" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByText(HOLD_NAME)).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: new RegExp(ACTIVE_NAME.replace(/[[\]]/g, "\\$&")),
      })
    ).toHaveCount(0);
    // Active chip with the selection is visible and removable.
    await expect(
      page.getByRole("button", { name: /Status: On hold/ })
    ).toBeVisible();
  });

  await test.step("filters persist across a reload", async () => {
    await page.reload();
    await expect(page.getByTestId("projects-search")).toHaveValue(
      String(STAMP)
    );
    await expect(page.getByText(HOLD_NAME)).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: new RegExp(ACTIVE_NAME.replace(/[[\]]/g, "\\$&")),
      })
    ).toHaveCount(0);
  });

  await test.step("save the view, clear all, recall the view", async () => {
    await page.getByTestId("filter-views-projects").click();
    await page.getByTestId("filter-view-name-projects").fill("On-hold FB");
    await page.getByTestId("filter-view-save-projects").click();
    await page.keyboard.press("Escape");

    await page.getByTestId("filter-clear-projects").click();
    await expect(page.getByTestId("projects-search")).toHaveValue("");
    await expect(
      page.getByRole("link", {
        name: new RegExp(ACTIVE_NAME.replace(/[[\]]/g, "\\$&")),
      })
    ).toBeVisible();

    await page.getByTestId("filter-views-projects").click();
    await page.getByRole("button", { name: "On-hold FB", exact: true }).click();
    await expect(page.getByTestId("projects-search")).toHaveValue(
      String(STAMP)
    );
    await expect(page.getByText(HOLD_NAME)).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: new RegExp(ACTIVE_NAME.replace(/[[\]]/g, "\\$&")),
      })
    ).toHaveCount(0);
  });

  await test.step("clean slate for other specs", async () => {
    await page.getByTestId("filter-clear-projects").click();
  });
});
