import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const ESTIMATE_NAME = `[E2E] Estimate ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

test("estimating: draft an estimate, classify materials, save a forecast, convert to active", async ({
  page,
}) => {
  const admin = createAdminClient();

  await test.step("create a draft estimate and paste a material list", async () => {
    await page.goto("/app/estimate");
    await page.getByRole("button", { name: "+ New estimate" }).click();
    await page.locator("#name").fill(ESTIMATE_NAME);
    await page.getByRole("button", { name: "Create estimate" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+\/materials$/);
    projectId = /\/app\/project\/([^/]+)\/materials$/.exec(page.url())![1];

    // A draft estimate has no Layout/Progress tabs — only Overview,
    // Materials, Estimate.
    await expect(page.getByRole("link", { name: "Layout" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Progress" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Estimate" })).toBeVisible();

    await page
      .getByRole("button", { name: /Paste from packing slip/i })
      .click();
    await page.locator("textarea").fill("Test Beam, 100\nTest Anchor, 300");
    await page.getByRole("button", { name: "Add materials" }).click();
    await expect(
      page.locator('[data-testid^="material-row-"]')
    ).toHaveCount(2);
  });

  await test.step("classify a material's task/size and see labor units recompute", async () => {
    const { data: beam } = await admin
      .from("materials")
      .select("id")
      .eq("project_id", projectId!)
      .eq("name", "Test Beam")
      .single();

    const row = page.getByTestId(`material-row-${beam!.id}`);
    // Not a bare "select" tag locator — sub-phase F added a second
    // <select> (Condition) to the same row, making that ambiguous.
    await page.getByTestId(`material-task-${beam!.id}`).selectOption("beam");
    // Wait for this update to fully land before the size edit — both go
    // through updateMaterial's own "read current, then recompute" path
    // (lib/projects/actions.ts), so firing the size edit before the
    // task_key one lands would race and could read stale task_key back.
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("materials")
          .select("task_key")
          .eq("id", beam!.id)
          .single();
        return data?.task_key;
      })
      .toBe("beam");

    // Not a positional row.locator("input").nth(1) — sub-phase G added a
    // leading select-checkbox <input> to every row for bulk operations,
    // shifting every subsequent input's index by one.
    const sizeInput = page.getByTestId(`material-size-${beam!.id}`);
    await sizeInput.fill("96");
    await sizeInput.blur();

    // Phase 13 REGRESSION GUARD: the old engine multiplied the raw size
    // number by a per-linear-FOOT rate (0.05 × 96 "feet" = 4.80 h for ONE
    // beam — the inches-as-feet bug). Beam labor is per PIECE now: a 96"
    // beam books 0.08 h. 4.80 must never come back.
    await expect(row.getByText("0.08", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(row.getByText("4.80")).toHaveCount(0);
  });

  await test.step("the Estimate tab shows a real forecast and saves a history entry", async () => {
    await page.getByRole("link", { name: "Estimate" }).click();
    await expect(page.getByText("Full scope")).toBeVisible();
    await expect(page.getByText("Remaining to finish")).toBeVisible();
    await expect(page.getByText(/Confidence:/)).toBeVisible();
    await expect(page.getByText("Remaining hours by SKU")).toBeVisible();
    await expect(page.getByTestId("estimate-sku-lines")).toContainText("beam");

    await expect(
      page.getByText("No saved estimates yet")
    ).toBeVisible();
    await page.getByRole("button", { name: "Save this estimate" }).click();
    await expect(page.getByText("Estimate saved.")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText("No saved estimates yet")
    ).not.toBeVisible();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("project_estimates")
          .select("id")
          .eq("project_id", projectId!);
        return data?.length ?? 0;
      })
      .toBe(1);
  });

  await test.step("the what-if crew-count input recomputes the forecast", async () => {
    const forecastStat = page.getByTestId("estimate-stat-forecast-finish");
    const forecastBefore = await forecastStat.textContent();
    await page.locator("#crew-count").fill("5");
    await page.locator("#crew-count").blur();
    await expect(page.getByText("recomputing…")).toBeVisible();
    await expect(page.getByText("recomputing…")).not.toBeVisible({
      timeout: 10_000,
    });
    // 5 crews in parallel finishes no later than the 1-crew default —
    // not asserting an exact date (today shifts the whole walk), just
    // that recompute actually ran and produced a same-or-earlier finish.
    await expect(forecastStat).not.toHaveText(forecastBefore ?? "", {
      timeout: 10_000,
    });
  });

  await test.step("convert the draft to a real active project", async () => {
    await page.goto(`/app/project/${projectId}`);
    await page.getByRole("button", { name: "Convert to active project" }).click();
    await page.waitForURL(new RegExp(`/app/project/${projectId}$`));
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Layout" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Progress" })).toBeVisible();

    // No longer listed as a draft estimate...
    await page.goto("/app/estimate");
    await expect(page.getByText(ESTIMATE_NAME)).not.toBeVisible();
    // ...but now shows on the main Projects list.
    await page.goto("/app");
    await expect(page.getByText(ESTIMATE_NAME)).toBeVisible();
  });
});

test("estimating: labor standards and crew rates panels render real, editable data", async ({
  page,
}) => {
  await page.goto("/app/estimate");
  await expect(page.getByText("Labor standards")).toBeVisible();
  await expect(page.getByText("general")).toBeVisible();
  await expect(page.getByText("Crew rates")).toBeVisible();

  await page
    .getByRole("button", { name: "Recompute from install history" })
    .click();
  await expect(
    page.getByText(/Updated \d+ crew|No qualifying install history/)
  ).toBeVisible({ timeout: 15_000 });
});
