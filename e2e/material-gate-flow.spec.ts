import { expect, test } from "@playwright/test";

import { deleteAuthUserByEmail, deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const PROJECT_NAME = `[E2E] Material gate ${Date.now()}`;
const CREW_NAME = `[E2E] Material gate crew ${Date.now()}`;
const PM_EMAIL = `e2e+material-gate-pm-${Date.now()}@handyequip.test`;
const PM_PASSWORD = "e2e-material-gate-pm-1!";

let projectId: string | null = null;
let crewId: string | null = null;
let pmUserId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
  if (crewId) {
    const admin = createAdminClient();
    await admin.from("crews").delete().eq("id", crewId);
  }
  if (pmUserId) await deleteAuthUserByEmail(PM_EMAIL);
});

test("material gate: blocks dispatch/field/stage-completion until the BOM is verified; flags notify + hit the reorder list; override surfaces on the dashboard", async ({
  page,
}) => {
  const admin = createAdminClient();
  test.setTimeout(120_000);

  await test.step("create a project with a two-line BOM", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    await page.getByRole("link", { name: "Materials" }).click();
    await page.getByRole("button", { name: /Paste from packing slip/i }).click();
    await page.locator("textarea").fill("Beam, 10\nAnchor, 20");
    await page.getByRole("button", { name: "Add materials" }).click();
    await expect(page.locator("table").first().locator("tbody tr")).toHaveCount(2);

    // The paste-from-packing-slip flow assumes the pasted list IS what
    // shipped (received = needed) — this test needs the opposite: a BOM
    // that's loaded but not yet received, the state a real job is in
    // between ordering and the truck showing up.
    const { error } = await admin
      .from("materials")
      .update({ received: 0 })
      .eq("project_id", projectId);
    if (error) throw error;
  });

  await test.step("fast-forward the lifecycle to the Materials stage", async () => {
    // Handoff/scope/schedule are other specs' subjects — override them the
    // way an owner racing to test this gate would, with a reason (which
    // the dashboard's override list should later surface).
    const { error: overrideError } = await admin
      .from("project_stages")
      .update({
        status: "overridden",
        override_reason: "E2E fast-forward to Materials",
        completed_at: new Date().toISOString(),
      })
      .eq("project_id", projectId!)
      .in("stage_key", ["handoff", "scope", "schedule"]);
    if (overrideError) throw overrideError;

    const { error: activateError } = await admin
      .from("project_stages")
      .update({ status: "active" })
      .eq("project_id", projectId!)
      .eq("stage_key", "materials");
    if (activateError) throw activateError;

    const { error: projectError } = await admin
      .from("projects")
      .update({ stage_key: "materials" })
      .eq("id", projectId!);
    if (projectError) throw projectError;
  });

  await test.step("hand-ticking every checklist item can NOT complete the Materials stage — the server re-verifies computed readiness", async () => {
    const { data: stage } = await admin
      .from("project_stages")
      .select("id")
      .eq("project_id", projectId!)
      .eq("stage_key", "materials")
      .single();
    const { error } = await admin
      .from("project_gate_items")
      .update({ done: true, done_at: new Date().toISOString() })
      .eq("project_stage_id", stage!.id);
    if (error) throw error;

    await page.goto(`/app/project/${projectId}`);
    await page.getByRole("button", { name: "Materials", exact: true }).click();
    const checklist = page.getByTestId("gate-checklist");
    await checklist.getByRole("button", { name: "Complete stage" }).click();
    await expect(
      checklist.getByText(/Materials aren't verified yet/)
    ).toBeVisible();

    const { data: after } = await admin
      .from("project_stages")
      .select("status")
      .eq("id", stage!.id)
      .single();
    expect(after!.status).toBe("active");
  });

  await test.step("crew dispatch is hard-blocked while Mobilize is locked", async () => {
    const { data: org } = await admin
      .from("projects")
      .select("org_id")
      .eq("id", projectId!)
      .single();
    const { data: crew, error } = await admin
      .from("crews")
      .insert({ org_id: org!.org_id, name: CREW_NAME, size: 2 })
      .select("id")
      .single();
    if (error) throw error;
    crewId = crew.id;

    await page.goto(`/scheduler/${projectId}`);
    await expect(page.getByTestId("dispatch-gate-banner")).toBeVisible();

    await page.getByRole("button", { name: "Build schedule" }).click();
    await page.getByRole("button", { name: "Generate days" }).click();
    await page.getByRole("button", { name: "Save schedule" }).click();
    await expect(page.getByText(/scheduled days?/)).toBeVisible({ timeout: 10_000 });

    await page.getByText("+ Assign crew").first().click();
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByTestId("assign-crew-error")).toContainText(
      "Not cleared for crew dispatch"
    );

    const { data: assignments } = await admin
      .from("assignments")
      .select("id")
      .eq("project_id", projectId!);
    expect(assignments?.length ?? 0).toBe(0);
  });

  await test.step("the field app shows crews 'Not cleared for install'", async () => {
    await page.goto(`/field/${projectId}`);
    await expect(page.getByTestId("not-cleared-panel")).toBeVisible();
    await expect(page.getByText("Not cleared for install")).toBeVisible();
    // The working UI is genuinely withheld, not just bannered over.
    await expect(page.locator("#crew-select")).toHaveCount(0);
  });

  await test.step("give the project a real PM (not the flagger) so the flag notification has a recipient", async () => {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: PM_EMAIL,
      password: PM_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    pmUserId = created.user.id;
    const { data: org } = await admin
      .from("projects")
      .select("org_id")
      .eq("id", projectId!)
      .single();
    const { error: profileError } = await admin
      .from("profiles")
      .update({ org_id: org!.org_id, role: "pm" })
      .eq("id", pmUserId);
    if (profileError) throw profileError;
    const { error: pmError } = await admin
      .from("projects")
      .update({ pm_user_id: pmUserId })
      .eq("id", projectId!);
    if (pmError) throw pmError;
  });

  await test.step("verification worksheet: confirm the Beam line in one tap", async () => {
    await page.goto(`/app/project/${projectId}/receiving`);
    await expect(page.getByTestId("materials-gate-card")).toContainText(
      "Materials gate: not ready"
    );
    await page.getByRole("link", { name: "Open verification worksheet" }).click();
    await page.waitForURL(/\/receiving\/verify$/);
    await expect(page.getByTestId("readiness-summary")).toContainText("0% received");

    const beamLine = page
      .locator('[data-testid^="worksheet-line-"]')
      .filter({ hasText: "Beam" });
    // Qty prefills with the full outstanding amount (10) — the common
    // "whole delivery arrived and checks out" case is one tap.
    await beamLine.getByRole("button", { name: "✓ Received + verified" }).click();
    await expect(beamLine.getByText("Fully received and verified.")).toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step("worksheet: confirm 15 Anchors, flag 5 short — PM notified, reorder list updated", async () => {
    const anchorLine = page
      .locator('[data-testid^="worksheet-line-"]')
      .filter({ hasText: "Anchor" });
    await anchorLine.getByLabel("Quantity for Anchor").fill("15");
    await anchorLine.getByRole("button", { name: "✓ Received + verified" }).click();
    await expect(anchorLine.getByText("15 verified")).toBeVisible({ timeout: 10_000 });

    await anchorLine.getByRole("button", { name: "Flag problem" }).click();
    await anchorLine.getByRole("button", { name: "Short", exact: true }).click();
    await anchorLine.getByLabel("Flagged quantity for Anchor").fill("5");
    await anchorLine
      .getByPlaceholder("what's wrong? (optional)")
      .fill("Box came up 5 light");
    await anchorLine.getByRole("button", { name: "Log flag" }).click();
    await expect(anchorLine.getByText("5 flagged")).toBeVisible({ timeout: 10_000 });

    // Same-day PM notification, in-app, immediately.
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("notifications")
          .select("id")
          .eq("user_id", pmUserId!)
          .eq("kind", "material_flagged")
          .contains("payload", { projectId, flagStatus: "short" });
        return data?.length ?? 0;
      })
      .toBe(1);

    // The 5 never-received units are on the reorder list via to_order —
    // flags never received-bump, so one reorder truth, no double count.
    await page.goto(`/app/project/${projectId}/receiving`);
    await expect(page.getByTestId("materials-gate-card")).toContainText(
      "5 flagged open"
    );
    const reorderCard = page
      .locator("div")
      .filter({ hasText: /^Reorder list/ })
      .first();
    await expect(reorderCard.getByText("Anchor")).toBeVisible();
    await expect(reorderCard.getByText("5 to order")).toBeVisible();
  });

  await test.step("resolve the flag, receive the replacement — gate goes green and auto-ticks its checklist", async () => {
    await page
      .locator('[data-testid^="resolve-flag-"]')
      .first()
      .click();
    await expect(page.getByText("Open flags")).toHaveCount(0, { timeout: 10_000 });

    await page.getByRole("link", { name: "Open verification worksheet" }).click();
    await page.waitForURL(/\/receiving\/verify$/);
    const anchorLine = page
      .locator('[data-testid^="worksheet-line-"]')
      .filter({ hasText: "Anchor" });
    await anchorLine.getByRole("button", { name: "✓ Received + verified" }).click();
    await expect(anchorLine.getByText("Fully received and verified.")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("readiness-summary")).toContainText(
      "Materials gate: green"
    );
  });

  await test.step("Materials stage now completes for real — Mobilize unlocks", async () => {
    await page.goto(`/app/project/${projectId}`);
    await page.getByRole("button", { name: "Materials", exact: true }).click();
    const checklist = page.getByTestId("gate-checklist");
    await checklist.getByRole("button", { name: "Complete stage" }).click();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("project_stages")
          .select("status")
          .eq("project_id", projectId!)
          .eq("stage_key", "mobilize")
          .single();
        return data?.status;
      })
      .toBe("active");
  });

  await test.step("dispatch now works: the same assignment that was blocked succeeds", async () => {
    await page.goto(`/scheduler/${projectId}`);
    await expect(page.getByTestId("dispatch-gate-banner")).toHaveCount(0);
    await page.getByText("+ Assign crew").first().click();
    await page.getByRole("button", { name: "Assign", exact: true }).click();

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

  await test.step("the field app is cleared for install again", async () => {
    await page.goto(`/field/${projectId}`);
    await expect(page.getByTestId("not-cleared-panel")).toHaveCount(0);
    await expect(page.locator("#crew-select")).toBeVisible();
  });

  await test.step("the dashboard surfaces the overridden gates (who/why), keeping overrides accountable", async () => {
    await page.goto("/app/dashboard");
    const overrideList = page.getByTestId("gate-override-list");
    await expect(
      overrideList.locator("li").filter({ hasText: PROJECT_NAME }).first()
    ).toBeVisible();
    await expect(
      overrideList.getByText("E2E fast-forward to Materials").first()
    ).toBeVisible();
  });
});
