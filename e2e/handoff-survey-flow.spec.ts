import { expect, test, type Page } from "@playwright/test";

import {
  deleteAuthUserByEmail,
  deleteProjectCompletely,
} from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const PROJECT_NAME = `[E2E] Handoff survey ${Date.now()}`;
const PM_EMAIL = `e2e+handoff-pm-${Date.now()}@handyequip.test`;
const PM_PASSWORD = "e2e-handoff-pm-password-1!";
const AI_PROJECT_NAME = `[E2E] Handoff AI draft ${Date.now()}`;

let projectId: string | null = null;
let pmUserId: string | null = null;
let aiProjectId: string | null = null;

// react-pdf's <Image> only decodes real raster formats (PNG/JPEG) — the
// repo's one checked-in fixture is an SVG, which is fine for drawing
// uploads (those go through lib/pdf/render-drawing-file.ts's client-side
// JPEG re-encode) but daily-photos uploads (this feature and blockers/day
// logs) store the raw bytes as-is, so an SVG here would 500 the PDF route.
// Same workaround packing-slip-extract-flow.spec.ts uses: screenshot a
// real page to get real image bytes without committing a binary fixture.
async function buildSitePhoto(page: Page): Promise<Buffer> {
  const fixturePage = await page.context().newPage();
  await fixturePage.setContent(
    '<html><body style="margin:0;width:400px;height:300px;background:#8a8a8a;"></body></html>'
  );
  const buffer = await fixturePage.screenshot();
  await fixturePage.close();
  return buffer;
}

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
  if (aiProjectId) await deleteProjectCompletely(aiProjectId);
  if (pmUserId) await deleteAuthUserByEmail(PM_EMAIL);
});

test("handoff survey: structured intake, teardown auto-creates scope item, dual sign-off survives, PDF downloads", async ({
  page,
  browser,
}) => {
  const admin = createAdminClient();
  const { data: owner } = await admin
    .from("profiles")
    .select("id, org_id")
    .eq("role", "owner")
    .limit(1)
    .single();

  await test.step("create a pm-role user for the PM half of dual sign-off", async () => {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: PM_EMAIL,
      password: PM_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    pmUserId = created.user.id;
    const { error: profileError } = await admin
      .from("profiles")
      .update({ org_id: owner!.org_id, role: "pm" })
      .eq("id", pmUserId);
    if (profileError) throw profileError;
  });

  await test.step("create a project and open its Handoff tab", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    await page.getByRole("link", { name: "Handoff", exact: true }).click();
    await expect(page.getByText("No drawing on file yet.")).toBeVisible();
  });

  await test.step("fill and save the survey", async () => {
    await page.locator("#site_visit_date").fill("2026-07-10");
    await page
      .locator("#existing_racking_condition")
      .fill("Ridg-U-Rak, moderate rust in back corner.");
    await page.getByLabel("Teardown of existing racking is required").check();
    await page
      .getByPlaceholder(/What needs to come down/)
      .fill("Remove 3-level run along north wall.");
    await page.getByLabel("Warehouse is live/operating during install").check();
    await page.getByLabel("Forklift available onsite").check();
    await page.locator("#working_hours").fill("7am-3pm, no weekends");
    await page
      .locator("#floor_condition")
      .fill("Concrete, minor cracking near dock 3");
    await page
      .locator("#access_notes")
      .fill("Freight elevator on east side only");

    await page.getByRole("button", { name: "Save survey" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  });

  await test.step("survey persisted, teardown auto-created a draft scope item, non-role-gated checklist items flipped", async () => {
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("handoff_surveys")
          .select("existing_racking_condition")
          .eq("project_id", projectId!)
          .maybeSingle();
        return data?.existing_racking_condition;
      })
      .toBe("Ridg-U-Rak, moderate rust in back corner.");

    const { data: survey } = await admin
      .from("handoff_surveys")
      .select("*")
      .eq("project_id", projectId!)
      .single();
    expect(survey!.teardown_required).toBe(true);
    expect(survey!.teardown_notes).toBe("Remove 3-level run along north wall.");
    expect(survey!.constraints).toMatchObject({
      liveWarehouse: true,
      forkliftOnsite: true,
      permitsNeeded: false,
      workingHours: "7am-3pm, no weekends",
      floorCondition: "Concrete, minor cracking near dock 3",
      accessNotes: "Freight elevator on east side only",
    });

    const { data: scopeItem } = await admin
      .from("scope_items")
      .select("work_type, description, source")
      .eq("project_id", projectId!)
      .eq("source", "handoff")
      .maybeSingle();
    expect(scopeItem?.work_type).toBe("teardown");
    expect(scopeItem?.description).toBe("Remove 3-level run along north wall.");

    const { data: stage } = await admin
      .from("project_stages")
      .select("id")
      .eq("project_id", projectId!)
      .eq("stage_key", "handoff")
      .single();
    const { data: items } = await admin
      .from("project_gate_items")
      .select("label, done")
      .eq("project_stage_id", stage!.id);
    const doneLabels = new Set(
      (items ?? []).filter((i) => i.done).map((i) => i.label)
    );
    expect(doneLabels.has("Site survey completed with photos")).toBe(false); // no photo yet
    expect(doneLabels.has("Existing racking condition recorded")).toBe(true);
    expect(
      doneLabels.has("Teardown scope confirmed (yes/no) and documented")
    ).toBe(true);
    expect(doneLabels.has("Site constraints recorded")).toBe(true);
  });

  await test.step("upload a site photo", async () => {
    const photo = await buildSitePhoto(page);
    await page.getByTestId("handoff-photo-upload-input").setInputFiles({
      name: "site-photo.png",
      mimeType: "image/png",
      buffer: photo,
    });
    await expect(page.locator('img[alt="Site photo"]')).toBeVisible({
      timeout: 15_000,
    });

    await expect
      .poll(async () => {
        const { data: stage } = await admin
          .from("project_stages")
          .select("id")
          .eq("project_id", projectId!)
          .eq("stage_key", "handoff")
          .single();
        const { data: item } = await admin
          .from("project_gate_items")
          .select("done")
          .eq("project_stage_id", stage!.id)
          .eq("label", "Site survey completed with photos")
          .single();
        return item?.done;
      })
      .toBe(true);
  });

  await test.step("remove the photo — clears the DB array and deletes the storage object, not just the reference", async () => {
    const { data: beforeRemove } = await admin
      .from("handoff_surveys")
      .select("photo_paths")
      .eq("project_id", projectId!)
      .single();
    const removedPath = beforeRemove!.photo_paths[0];

    await page.getByRole("button", { name: "Remove photo" }).click();
    await expect(page.locator('img[alt="Site photo"]')).toHaveCount(0);

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("handoff_surveys")
          .select("photo_paths")
          .eq("project_id", projectId!)
          .single();
        return data?.photo_paths.length;
      })
      .toBe(0);

    const { data: stillThere } = await admin.storage
      .from("daily-photos")
      .list(removedPath.split("/").slice(0, -1).join("/"));
    expect((stillThere ?? []).some((f) => removedPath.endsWith(f.name))).toBe(
      false
    );

    // Re-upload so the rest of this flow (which asserts exactly one
    // photo survives sign-off) still has a photo to work with.
    const photo = await buildSitePhoto(page);
    await page.getByTestId("handoff-photo-upload-input").setInputFiles({
      name: "site-photo-2.png",
      mimeType: "image/png",
      buffer: photo,
    });
    await expect(page.locator('img[alt="Site photo"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  await test.step("estimator (owner) signs off", async () => {
    await page.getByRole("button", { name: "Sign as estimator" }).click();
    await expect(page.getByText(/Signed .* \(you\)/)).toBeVisible();
  });

  await test.step("teardown/constraints data survives the estimator sign-off — upsert doesn't clobber other columns", async () => {
    const { data: survey } = await admin
      .from("handoff_surveys")
      .select("*")
      .eq("project_id", projectId!)
      .single();
    expect(survey!.estimator_signoff_user_id).toBe(owner!.id);
    expect(survey!.estimator_signed_at).toBeTruthy();
    expect(survey!.teardown_required).toBe(true);
    expect(survey!.teardown_notes).toBe("Remove 3-level run along north wall.");
    expect(survey!.existing_racking_condition).toBe(
      "Ridg-U-Rak, moderate rust in back corner."
    );
    expect(survey!.photo_paths.length).toBe(1);
  });

  await test.step("a real PM signs off in a separate session — checklist item flips too (requires_signoff_role='pm')", async () => {
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
  });

  await test.step("PM sign-off persisted without clobbering prior data, and its role-gated checklist item flipped", async () => {
    const { data: survey } = await admin
      .from("handoff_surveys")
      .select("*")
      .eq("project_id", projectId!)
      .single();
    expect(survey!.pm_signoff_user_id).toBe(pmUserId);
    expect(survey!.pm_signed_at).toBeTruthy();
    expect(survey!.estimator_signoff_user_id).toBe(owner!.id);
    expect(survey!.teardown_notes).toBe("Remove 3-level run along north wall.");

    const { data: stage } = await admin
      .from("project_stages")
      .select("id")
      .eq("project_id", projectId!)
      .eq("stage_key", "handoff")
      .single();
    const { data: items } = await admin
      .from("project_gate_items")
      .select("label, done")
      .eq("project_stage_id", stage!.id);
    const doneLabels = new Set(
      (items ?? []).filter((i) => i.done).map((i) => i.label)
    );
    expect(doneLabels.has("Estimator sign-off")).toBe(true);
    expect(doneLabels.has("PM sign-off")).toBe(true);
  });

  await test.step("download the handoff PDF", async () => {
    const response = await page.request.get(
      `/api/projects/${projectId}/handoff-survey-pdf`
    );
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    const buffer = await response.body();
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });
});

test("handoff AI draft: not offered when ANTHROPIC_API_KEY is unconfigured", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.ANTHROPIC_API_KEY),
    "only relevant when no ANTHROPIC_API_KEY is configured"
  );

  await page.goto("/app");
  await page.getByRole("button", { name: "+ New project" }).click();
  await page.locator("#name").fill(AI_PROJECT_NAME);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/app\/project\/[^/]+$/);
  aiProjectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

  await page.getByRole("link", { name: "Handoff", exact: true }).click();
  await expect(page.getByText("Draft from rough notes")).not.toBeVisible();
});

test("handoff AI draft: drafts fields from rough notes for review, never auto-saves", async ({
  page,
}) => {
  test.skip(
    !process.env.ANTHROPIC_API_KEY,
    "needs a real ANTHROPIC_API_KEY to call the live draft API"
  );
  test.setTimeout(60_000);

  const admin = createAdminClient();

  await page.goto("/app");
  await page.getByRole("button", { name: "+ New project" }).click();
  await page.locator("#name").fill(AI_PROJECT_NAME);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/app\/project\/[^/]+$/);
  aiProjectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

  await page.getByRole("link", { name: "Handoff", exact: true }).click();
  await page
    .getByTestId("handoff-rough-notes")
    .fill(
      "Existing racking is Ridg-U-Rak, rusted badly in the back corner — " +
        "needs to come down entirely along the north wall before we start. " +
        "Warehouse stays live and operating during our install, they do have " +
        "a forklift on site we can use. Floor is concrete, some cracking near " +
        "dock 3. No mention of permits or working-hour limits."
    );
  await page.getByRole("button", { name: "Draft with AI" }).click();

  await expect(page.locator("#existing_racking_condition")).not.toHaveValue(
    "",
    {
      timeout: 30_000,
    }
  );
  await expect(
    page.getByLabel("Teardown of existing racking is required")
  ).toBeChecked();
  await expect(
    page.getByLabel("Warehouse is live/operating during install")
  ).toBeChecked();
  await expect(page.getByLabel("Forklift available onsite")).toBeChecked();
  await expect(page.locator("#floor_condition")).toHaveValue(/crack/i);

  // Drafted into local form state only — confirm nothing reached the DB
  // until an explicit Save.
  const { data: surveyBeforeSave } = await admin
    .from("handoff_surveys")
    .select("id")
    .eq("project_id", aiProjectId)
    .maybeSingle();
  expect(surveyBeforeSave).toBeNull();

  await page.getByRole("button", { name: "Save survey" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  const { data: surveyAfterSave } = await admin
    .from("handoff_surveys")
    .select("teardown_required")
    .eq("project_id", aiProjectId)
    .single();
  expect(surveyAfterSave!.teardown_required).toBe(true);
});
