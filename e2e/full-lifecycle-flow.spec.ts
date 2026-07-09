import { expect, test, type Page } from "@playwright/test";

import {
  deleteAuthUserByEmail,
  deleteProjectCompletely,
} from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

// Sub-phase J's integration walk: one project from creation through
// every gate to closeout — including one stage override, one blocked
// crew dispatch, and one approved change order. Each stage transition
// is asserted against the DB, not just the UI.

const PROJECT_NAME = `[E2E] Full lifecycle ${Date.now()}`;
const CREW_NAME = `[E2E] Lifecycle crew ${Date.now()}`;
const PM_EMAIL = `e2e+lifecycle-pm-${Date.now()}@handyequip.test`;
const PM_PASSWORD = "e2e-lifecycle-pm-1!";

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

async function expectStageStatus(
  stageKey:
    | "handoff"
    | "scope"
    | "schedule"
    | "materials"
    | "mobilize"
    | "execute"
    | "punch"
    | "closeout",
  status: string,
  timeoutMs = 10_000
) {
  const admin = createAdminClient();
  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("project_stages")
          .select("status")
          .eq("project_id", projectId!)
          .eq("stage_key", stageKey)
          .single();
        return data?.status;
      },
      { timeout: timeoutMs }
    )
    .toBe(status);
}

async function tickAllOpenItems(page: Page) {
  // Tick every unchecked checkbox in the ACTIVE stage's checklist.
  const checklist = page.getByTestId("gate-checklist");
  const boxes = checklist.getByRole("checkbox");
  const count = await boxes.count();
  for (let i = 0; i < count; i++) {
    const box = boxes.nth(i);
    if (!(await box.isChecked())) {
      await box.check();
      // Each tick is its own server round-trip; give it a beat so the
      // next check targets settled state.
      await page.waitForTimeout(250);
    }
  }
}

async function completeActiveStage(page: Page) {
  const checklist = page.getByTestId("gate-checklist");
  await expect(
    checklist.getByRole("button", { name: "Complete stage" })
  ).toBeEnabled({ timeout: 10_000 });
  await checklist.getByRole("button", { name: "Complete stage" }).click();
}

test("full lifecycle: creation → every gate → closeout, with one override, one blocked dispatch, one approved CO", async ({
  page,
  browser,
}) => {
  const admin = createAdminClient();
  test.setTimeout(300_000);

  await test.step("create the project, the PM user, and the customer contact", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

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
      .eq("id", projectId)
      .single();
    await admin
      .from("profiles")
      .update({ org_id: org!.org_id, role: "pm" })
      .eq("id", pmUserId);
    const { data: crew } = await admin
      .from("crews")
      .insert({ org_id: org!.org_id, name: CREW_NAME })
      .select("id")
      .single();
    crewId = crew!.id;

    await page.getByRole("link", { name: "Comms", exact: true }).click();
    await page.locator("#contact-name").fill("Lifecycle Customer");
    await page.locator("#contact-email").fill("delivered@resend.dev");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  });

  await test.step("HANDOFF completes legitimately: survey + photo + dual sign-off", async () => {
    await page.goto(`/app/project/${projectId}/handoff`);
    await page.locator("#site_visit_date").fill("2026-07-01");
    await page
      .locator("#existing_racking_condition")
      .fill("Empty warehouse, clean slab.");
    await page.getByRole("button", { name: "Save survey" }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

    // Photo (ticks the requires_photo item).
    const fixturePage = await page.context().newPage();
    await fixturePage.setContent(
      '<html><body style="margin:0;width:200px;height:150px;background:#777;"></body></html>'
    );
    const photo = await fixturePage.screenshot();
    await fixturePage.close();
    await page.getByTestId("handoff-photo-upload-input").setInputFiles({
      name: "site.png",
      mimeType: "image/png",
      buffer: photo,
    });
    await expect(page.locator('img[alt="Site photo"]')).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "Sign as estimator" }).click();
    await expect(page.getByText(/Signed .* \(you\)/)).toBeVisible();

    // The PM sign-off item carries requires_signoff_role='pm' — a real
    // pm-role user signs in their own session.
    const pmContext = await browser.newContext();
    const pmPage = await pmContext.newPage();
    await pmPage.goto("/login");
    await pmPage.getByLabel("Work email").fill(PM_EMAIL);
    await pmPage.getByLabel("Password").fill(PM_PASSWORD);
    await pmPage.getByRole("button", { name: "Sign in" }).click();
    await pmPage.waitForURL("/app");
    await pmPage.goto(`/app/project/${projectId}/handoff`);
    await pmPage.getByRole("button", { name: "Sign as PM" }).click();
    await expect(pmPage.getByText(/Signed .* \(you\)/)).toBeVisible();
    await pmContext.close();

    await page.goto(`/app/project/${projectId}`);
    await completeActiveStage(page);
    await expectStageStatus("handoff", "complete");
    await expectStageStatus("scope", "active");
  });

  await test.step("SCOPE is the override path — skipped with a logged reason", async () => {
    await page.reload();
    const checklist = page.getByTestId("gate-checklist");
    await checklist
      .getByRole("button", { name: /Override \(\d+ open\)/ })
      .click();
    await checklist
      .getByPlaceholder("Reason for override (required)")
      .fill("Scope captured in the signed quote — lifecycle walk override");
    await checklist.getByRole("button", { name: "Confirm override" }).click();
    await expectStageStatus("scope", "overridden");
    await expectStageStatus("schedule", "active");
  });

  await test.step("SCHEDULE: commit dates (capacity + customer-notified auto-tick), hand-tick crew, complete", async () => {
    await page.goto(`/scheduler/${projectId}`);
    await page.getByRole("button", { name: "Build schedule" }).click();
    await page.getByRole("button", { name: "Generate days" }).click();
    await page.getByRole("button", { name: "Save schedule" }).click();
    await expect(page.getByText(/scheduled days?/)).toBeVisible({
      timeout: 20_000,
    });

    // "Crew assigned" is hand-ticked at the planning stage — actual
    // dispatch is deliberately blocked until Mobilize unlocks (ADR-042);
    // the checklist item means "crew identified," the assignment itself
    // is the dispatch act.
    await page.goto(`/app/project/${projectId}`);
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await tickAllOpenItems(page);
    await completeActiveStage(page);
    await expectStageStatus("schedule", "complete");
    await expectStageStatus("materials", "active");
  });

  await test.step("MATERIALS: load BOM; dispatch is BLOCKED while Mobilize is locked", async () => {
    await page.goto(`/app/project/${projectId}/materials`);
    await page
      .getByRole("button", { name: /Paste from packing slip/i })
      .click();
    await page.locator("textarea").fill("Lifecycle Beam, 4");
    await page.getByRole("button", { name: "Add materials" }).click();
    await expect(page.locator("table").first().locator("tbody tr")).toHaveCount(
      1
    );
    // Paste assumes received=needed; reset to not-yet-received so the
    // verification gate has real work to do.
    await admin
      .from("materials")
      .update({ received: 0 })
      .eq("project_id", projectId!);

    // The blocked-mobilization path: try to dispatch the crew now.
    await page.goto(`/scheduler/${projectId}`);
    await expect(page.getByTestId("dispatch-gate-banner")).toBeVisible();
    await page.getByText("+ Assign crew").first().click();
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByTestId("assign-crew-error")).toContainText(
      "Not cleared for crew dispatch"
    );
    const { data: assignments } = await admin
      .from("assignments")
      .select("id")
      .eq("project_id", projectId!);
    expect(assignments).toHaveLength(0);
  });

  await test.step("MATERIALS: verify the BOM on the worksheet, tick staged, complete — server recompute passes", async () => {
    await page.goto(`/app/project/${projectId}/receiving/verify`);
    const line = page
      .locator('[data-testid^="worksheet-line-"]')
      .filter({ hasText: "Lifecycle Beam" });
    await line.getByRole("button", { name: "✓ Received + verified" }).click();
    await expect(line.getByText("Fully received and verified.")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("readiness-summary")).toContainText(
      "Materials gate: green"
    );

    await page.goto(`/app/project/${projectId}`);
    await page.getByRole("button", { name: "Materials", exact: true }).click();
    await tickAllOpenItems(page); // "Material staged/ready" stays manual by design
    await completeActiveStage(page);
    await expectStageStatus("materials", "complete");
    await expectStageStatus("mobilize", "active");
  });

  await test.step("dispatch now succeeds — the same assignment that was blocked", async () => {
    await page.goto(`/scheduler/${projectId}`);
    await expect(page.getByTestId("dispatch-gate-banner")).toHaveCount(0);
    await page.getByText("+ Assign crew").first().click();
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("assignments")
          .select("id")
          .eq("project_id", projectId!);
        return data?.length ?? 0;
      })
      .toBe(1);
  });

  await test.step("MOBILIZE completes; EXECUTE gets an approved change order mid-flight", async () => {
    await page.goto(`/app/project/${projectId}`);
    await page.getByRole("button", { name: "Mobilize", exact: true }).click();
    await tickAllOpenItems(page);
    await completeActiveStage(page);
    await expectStageStatus("mobilize", "complete");
    await expectStageStatus("execute", "active");

    // One approved CO while executing.
    await page.goto(`/app/project/${projectId}/change-orders`);
    await page.getByRole("button", { name: "+ New change order" }).click();
    await page.locator("#co-title").fill("Add end-of-row protectors");
    await page.getByRole("button", { name: "Create change order" }).click();
    await page.waitForURL(/\/change-orders\/[^/]+$/);
    await page.getByRole("button", { name: "Material", exact: true }).click();
    await page.getByLabel("Line description").fill("End Protector");
    await page.getByLabel("Line quantity").fill("8");
    await page.getByRole("button", { name: "+ Add line" }).click();
    await expect(page.getByTestId("co-line-list").locator("li")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Record approval manually" })
      .click();
    await page.getByLabel("Approver name").fill("Lifecycle Customer");
    await page.getByRole("button", { name: "Record approval" }).click();
    await expect(page.getByTestId("co-status-badge")).toHaveText("Approved", {
      timeout: 10_000,
    });

    const { data: coMaterial } = await admin
      .from("materials")
      .select("id")
      .eq("project_id", projectId!)
      .eq("name", "End Protector")
      .maybeSingle();
    expect(coMaterial).not.toBeNull();
  });

  await test.step("EXECUTE and PUNCH complete; CLOSEOUT generates the autopsy and finishes the walk", async () => {
    await page.goto(`/app/project/${projectId}`);
    await page.getByRole("button", { name: "Execute", exact: true }).click();
    await tickAllOpenItems(page);
    await completeActiveStage(page);
    await expectStageStatus("execute", "complete");

    await page.getByRole("button", { name: "Punch", exact: true }).click();
    await tickAllOpenItems(page);
    await completeActiveStage(page);
    await expectStageStatus("punch", "complete");
    await expectStageStatus("closeout", "active");

    // Autopsy from the Progress tab auto-ticks its closeout item.
    await page.goto(`/app/project/${projectId}/progress`);
    await page.getByRole("button", { name: "Generate autopsy" }).click();
    await expect(page.getByText("Autopsy generated from actuals.")).toBeVisible(
      {
        timeout: 20_000,
      }
    );

    await page.goto(`/app/project/${projectId}`);
    await page.getByRole("button", { name: "Closeout", exact: true }).click();
    await tickAllOpenItems(page);
    await completeActiveStage(page);
    await expectStageStatus("closeout", "complete");

    // The whole walk holds in the DB: every stage decided, one override.
    const { data: stages } = await admin
      .from("project_stages")
      .select("stage_key, status")
      .eq("project_id", projectId!);
    const byKey = Object.fromEntries(
      stages!.map((s) => [s.stage_key, s.status])
    );
    expect(byKey).toEqual({
      handoff: "complete",
      scope: "overridden",
      schedule: "complete",
      materials: "complete",
      mobilize: "complete",
      execute: "complete",
      punch: "complete",
      closeout: "complete",
    });
    const { data: project } = await admin
      .from("projects")
      .select("stage_key")
      .eq("id", projectId!)
      .single();
    expect(project!.stage_key).toBe("closeout");
  });
});
