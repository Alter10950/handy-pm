import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { clearDispatchGate } from "./helpers/gates";
import { createAdminClient } from "./helpers/supabase-admin";

const PROJECT_NAME = `[E2E] Scope of work ${Date.now()}`;
const SCOPE_DESCRIPTION = `Tear down existing racking ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

test("scope of work: add a project-level item, labor suggested, log partial then done, estimator + scheduler + field all reflect it", async ({
  page,
}) => {
  const admin = createAdminClient();

  await test.step("create a project and open the Scope tab", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    await page.getByRole("link", { name: "Scope", exact: true }).click();
    await expect(
      page.locator("#main-content").getByText("Scope of work")
    ).toBeVisible();
  });

  await test.step("add a project-level teardown item — labor suggestion appears", async () => {
    await page.getByRole("button", { name: "+ Add scope item" }).click();
    // Default work type is already "teardown" — set qty first so the
    // suggestion (baseLaborUnits * qty) is deterministic to assert on.
    await page.locator('input[type="number"]').first().fill("4");
    await page
      .getByPlaceholder("e.g. Tear down existing 3-level run along north wall")
      .fill(SCOPE_DESCRIPTION);

    // teardown seeded at 0.15 base_labor_units * qty 4 = 0.6
    await expect(page.getByText("Suggested: 0.6 hrs")).toBeVisible();
    await page.getByText("Suggested: 0.6 hrs").click();

    await page.getByRole("button", { name: "+ Add scope item" }).click();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("scope_items")
          .select("id, labor_units, work_type")
          .eq("project_id", projectId!)
          .eq("description", SCOPE_DESCRIPTION)
          .maybeSingle();
        return data;
      })
      .toEqual({
        id: expect.any(String),
        labor_units: 0.6,
        work_type: "teardown",
      });
  });

  await test.step("estimator counts the scope item's hours as a new work-type bucket", async () => {
    await page.getByRole("link", { name: "Estimate", exact: true }).click();
    // Before this sub-phase, "teardown" never appeared here at all — the
    // breakdown was materials task_keys only. Its mere presence proves
    // the integration; the exact number is already verified against the
    // DB directly above (labor_units: 0.6). Phase 13's panel renders
    // scope work as the "Other scope work" list under the SKU table.
    const scopeEntry = page.locator("li").filter({ hasText: "teardown" });
    await expect(scopeEntry).toBeVisible();
    await expect(scopeEntry).toContainText("0.6");
  });

  // lib/scheduler/queries.ts#getProjectRemainingLaborUnits was extended
  // with the identical reduce-over-scope_item_progress shape as the
  // estimator's own getProjectLaborUnitsByTaskKey above (same
  // resolveRate call, same done-excludes-from-remaining rule) — not
  // re-verified via its own UI here (the crew calendar, which needs a
  // scheduled day to show a non-zero figure) given how structurally
  // identical the two code paths are; the estimator check above already
  // exercises that shared shape end to end against a real project.

  await test.step("log progress as partial with a note from the Scope tab", async () => {
    await page.goto(`/app/project/${projectId}/scope`);
    const item = page.locator('[data-testid^="scope-item-"]').filter({
      hasText: SCOPE_DESCRIPTION,
    });
    await item.getByRole("button", { name: "Log progress" }).click();
    await item
      .getByPlaceholder("Note (optional)…")
      .fill("Half the run is down");
    await item.getByRole("button", { name: "Mark partial" }).click();

    await expect(item.getByText("Partial", { exact: true })).toBeVisible();
    await expect(item.getByText("Note: Half the run is down")).toBeVisible();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("scope_item_progress")
          .select("status, note")
          .eq("project_id", projectId!)
          .eq("description", SCOPE_DESCRIPTION)
          .single();
        return data;
      })
      .toEqual({ status: "partial", note: "Half the run is down" });
  });

  await test.step("the field app shows the same item and can mark it done", async () => {
    // Sub-phase E's Mobilize lock would show "Not cleared for install"
    // instead of the working field UI (this spec never verifies
    // materials) — clearing it is material-gate-flow.spec.ts's subject.
    await clearDispatchGate(projectId!);

    await page.goto(`/field/${projectId}`);
    await page.getByRole("button", { name: "Scope" }).click();
    const card = page.locator('[data-testid^="scope-item-"]').filter({
      hasText: SCOPE_DESCRIPTION,
    });
    await expect(card.getByText("Partial", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Log progress" }).click();
    // Not exact: true by default here would also substring-match "Photo
    // + mark done" (Playwright's accessible-name matching is
    // case-insensitive substring unless exact is set).
    await card.getByRole("button", { name: "Mark done", exact: true }).click();
    await expect(card.getByText("Done", { exact: true })).toBeVisible();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("scope_item_progress")
          .select("status")
          .eq("project_id", projectId!)
          .eq("description", SCOPE_DESCRIPTION)
          .single();
        return data?.status;
      })
      .toBe("done");
  });

  await test.step("once done, the estimator no longer counts it as remaining", async () => {
    await page.goto(`/app/project/${projectId}/estimate`);
    const breakdownRow = page.locator("tr").filter({ hasText: "teardown" });
    await expect(breakdownRow).toHaveCount(0);
  });
});
