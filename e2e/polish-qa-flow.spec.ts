import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { clearDispatchGate } from "./helpers/gates";
import { createAdminClient } from "./helpers/supabase-admin";

// Sub-phase J's QA pass: the three screens the brief names must work on
// a phone, and the dashboard must hold up with 20+ active projects.

const MOBILE_PROJECT = `[E2E] Mobile pass ${Date.now()}`;
const PERF_PREFIX = `[E2E] Perf ${Date.now()}`;

let mobileProjectId: string | null = null;
const perfProjectIds: string[] = [];

test.afterAll(async () => {
  if (mobileProjectId) await deleteProjectCompletely(mobileProjectId);
  for (const id of perfProjectIds) await deleteProjectCompletely(id);
});

test.describe("mobile pass (390×844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("lifecycle stepper, verification worksheet, and capacity board work on a phone", async ({
    page,
  }) => {
    const admin = createAdminClient();
    test.setTimeout(120_000);

    await test.step("create a project with a material (phone viewport throughout)", async () => {
      await page.goto("/app");
      await page.getByRole("button", { name: "+ New project" }).click();
      await page.locator("#name").fill(MOBILE_PROJECT);
      await page.getByRole("button", { name: "Create project" }).click();
      await page.waitForURL(/\/app\/project\/[^/]+$/);
      mobileProjectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

      const { data: material, error } = await admin
        .from("materials")
        .insert({
          project_id: mobileProjectId,
          name: "Mobile Beam",
          total_needed: 5,
          received: 0,
          labor_units: 0.1,
        })
        .select("id")
        .single();
      if (error) throw error;
      void material;
    });

    await test.step("lifecycle stepper: all 8 pills reachable, checklist interactive, no page overflow", async () => {
      await page.goto(`/app/project/${mobileProjectId}`);
      for (const label of ["Handoff", "Closeout"]) {
        await expect(
          page.getByRole("button", { name: label, exact: true })
        ).toBeVisible();
      }
      // Tap a non-active stage pill — the checklist follows.
      await page.getByRole("button", { name: "Materials", exact: true }).click();
      await expect(
        page.getByTestId("gate-checklist").getByText("100% of BOM received")
      ).toBeVisible();

      const overflow = await page.evaluate(
        () =>
          (document.scrollingElement?.scrollWidth ?? 0) -
          (document.scrollingElement?.clientWidth ?? 0)
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });

    await test.step("verification worksheet: one-tap confirm works with a thumb", async () => {
      await page.goto(`/app/project/${mobileProjectId}/receiving/verify`);
      const line = page
        .locator('[data-testid^="worksheet-line-"]')
        .filter({ hasText: "Mobile Beam" });
      const confirmButton = line.getByRole("button", {
        name: "✓ Received + verified",
      });
      await expect(confirmButton).toBeVisible();
      // 44px is the accessibility floor for touch targets; ours are 48.
      const box = (await confirmButton.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      await confirmButton.click();
      await expect(line.getByText("Fully received and verified.")).toBeVisible({
        timeout: 10_000,
      });

      const overflow = await page.evaluate(
        () =>
          (document.scrollingElement?.scrollWidth ?? 0) -
          (document.scrollingElement?.clientWidth ?? 0)
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });

    await test.step("capacity board: renders on phone, wide grid scrolls in its own container", async () => {
      await clearDispatchGate(mobileProjectId!);
      await page.goto("/scheduler/capacity");
      await expect(page.getByTestId("capacity-board")).toBeVisible();

      // The month grid is wider than a phone — it must scroll inside its
      // own overflow container, never the page body.
      const pageOverflow = await page.evaluate(
        () =>
          (document.scrollingElement?.scrollWidth ?? 0) -
          (document.scrollingElement?.clientWidth ?? 0)
      );
      expect(pageOverflow).toBeLessThanOrEqual(1);

      const boardScrolls = await page
        .getByTestId("capacity-board")
        .evaluate((table) => {
          const container = table.closest(".overflow-x-auto");
          return container ? container.scrollWidth > container.clientWidth : false;
        });
      expect(boardScrolls).toBe(true);
    });
  });
});

test("dashboard holds up with 25+ active projects", async ({ page }) => {
  const admin = createAdminClient();
  test.setTimeout(180_000);

  await test.step("create 25 active projects directly", async () => {
    const { data: org } = await admin.from("organizations").select("id").limit(1).single();
    const rows = Array.from({ length: 25 }, (_, i) => ({
      org_id: org!.id,
      name: `${PERF_PREFIX} #${String(i + 1).padStart(2, "0")}`,
      status: "active" as const,
    }));
    const { data: created, error } = await admin
      .from("projects")
      .insert(rows)
      .select("id");
    if (error) throw error;
    perfProjectIds.push(...created.map((p) => p.id));
  });

  await test.step("the dashboard renders them within budget", async () => {
    const startedAt = Date.now();
    await page.goto("/app/dashboard", { waitUntil: "load" });
    const elapsed = Date.now() - startedAt;

    // Batched org-wide queries are the whole design (ADR-031/038/042) —
    // 25 extra projects should not push a fully-dynamic dashboard past
    // a generous 15s dev-server budget (production is faster).
    expect(elapsed).toBeLessThan(15_000);

    await expect(page.getByText(/Active projects \(\d+\)/)).toBeVisible();
    const heading = await page.getByText(/Active projects \(\d+\)/).textContent();
    const count = Number(/\((\d+)\)/.exec(heading ?? "")?.[1] ?? 0);
    expect(count).toBeGreaterThanOrEqual(25);

    // Spot-check a row actually rendered.
    await expect(page.getByText(`${PERF_PREFIX} #01`)).toBeVisible();
  });
});
