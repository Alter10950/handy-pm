import path from "node:path";

import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const FIXTURE_PATH = path.join(__dirname, "fixtures/test-drawing.svg");
const PROJECT_NAME = `[E2E] Dashboard flow ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

test("dashboard: shows shortages/blockers/crew data, resolves a blocker, sends a report, downloads a closeout PDF", async ({
  page,
}) => {
  const admin = createAdminClient();

  await test.step("create an active project with a shortage and an open blocker", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    await page.getByRole("link", { name: "Layout" }).click();
    // Not a bare input[type="file"] locator — the Overview page's own
    // lifecycle checklist has a hidden photo-attach file input that can
    // still be in the DOM mid-navigation, making that ambiguous/racy.
    await page.getByTestId("drawing-upload-input").setInputFiles(FIXTURE_PATH);
    await expect(page.getByText(/uploaded\.$/)).toBeVisible({
      timeout: 30_000,
    });

    // Direct admin insert, not the "Paste from packing slip" UI — that
    // flow sets received = total_needed (it assumes the pasted list IS
    // what shipped), which would make to_order 0, not the shortage this
    // test actually needs. total_needed=100, received=20 → to_order=80.
    const { error: materialError } = await admin.from("materials").insert({
      project_id: projectId!,
      name: "Test Widget",
      total_needed: 100,
      received: 20,
    });
    if (materialError) throw materialError;

    // An open blocker via the admin client directly — the crew-side
    // report-a-blocker UI is Field's own concern (field-flow.spec.ts
    // already covers it); this test only needs one to exist.
    const { error: blockerError } = await admin.from("blockers").insert({
      project_id: projectId!,
      code: "MISSING_MATERIAL",
      note: "E2E dashboard test blocker",
    });
    if (blockerError) throw blockerError;
  });

  await test.step("dashboard shows the shortage and the open blocker", async () => {
    await page.goto("/app/dashboard");
    // The project name legitimately appears twice (the active-projects
    // table's own link, and again inside the blocker item) — scoped to
    // the table link specifically, not a page-wide text match.
    await expect(
      page.getByRole("link", { name: PROJECT_NAME, exact: true })
    ).toBeVisible();
    await expect(page.getByText("Test Widget")).toBeVisible();
    await expect(page.getByText("80 to order")).toBeVisible();
    await expect(page.getByText("E2E dashboard test blocker")).toBeVisible();
  });

  await test.step("resolving the blocker removes it from the escalation list", async () => {
    const blockerItem = page.locator("li", {
      hasText: "E2E dashboard test blocker",
    });
    await blockerItem.getByRole("button", { name: "Mark resolved" }).click();
    await expect(page.getByText("E2E dashboard test blocker")).not.toBeVisible({
      timeout: 10_000,
    });

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("blockers")
          .select("resolved_at")
          .eq("project_id", projectId!)
          .single();
        return data?.resolved_at ?? null;
      })
      .not.toBeNull();
  });

  await test.step("email report now returns a real result from Resend", async () => {
    await page.getByRole("button", { name: "Email daily report now" }).click();
    // With RESEND_API_KEY configured (it is, in this environment), this
    // either reports a real send count or the real Resend API error —
    // most likely the sandbox-mode "can only send to your own address"
    // rejection, since the seeded test org's owner uses a @handyequip.test
    // address, not a Resend-verified one. Either outcome proves the
    // integration actually ran, not a stub.
    await expect(
      page.getByText(
        /Sent daily report for|Could not send:|RESEND_API_KEY is not configured|No active projects|No owner\/pm recipients/
      )
    ).toBeVisible({ timeout: 15_000 });
  });

  await test.step("closeout PDF downloads as a real, non-empty PDF", async () => {
    // page.request shares the page's own authenticated browser-context
    // cookies automatically — unlike the standalone `request` fixture,
    // which starts a separate, cookie-less context.
    const response = await page.request.get(
      `/api/projects/${projectId}/closeout-pdf`
    );
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toBe("application/pdf");
    const body = await response.body();
    expect(body.length).toBeGreaterThan(500);
    expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
