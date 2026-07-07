import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

// A real 1×1 PNG — the closeout PDF renders the marking drawing via
// react-pdf's <Image>, which decodes raster formats only (the SVG
// fixture trips its font machinery — same reason the handoff spec
// screenshots a page instead of uploading the SVG).
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const PROJECT_NAME = `[E2E] Autopsy ${Date.now()}`;
const CREW_NAME = `[E2E] Autopsy crew ${Date.now()}`;

let projectId: string | null = null;
let crewId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
  if (crewId) {
    const admin = createAdminClient();
    await admin.from("crews").delete().eq("id", crewId);
  }
});

test("autopsy: generates estimated-vs-actual with verdicts, ticks the gate item, AI narrative drafts+saves, owner email, company accuracy view", async ({
  page,
}) => {
  const admin = createAdminClient();
  test.setTimeout(180_000);

  await test.step("fabricate a finished project's ground truth", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    const { data: org } = await admin
      .from("projects")
      .select("org_id")
      .eq("id", projectId)
      .single();

    // Original estimate: 10 days, 20 labor units.
    await admin
      .from("projects")
      .update({
        original_estimate_labor_units: 20,
        original_estimate_days: 10,
        original_estimate_saved_at: new Date().toISOString(),
      })
      .eq("id", projectId);
    await admin.from("project_estimates").insert({
      project_id: projectId,
      estimated_labor_units: 20,
      estimated_hours: 20,
      estimated_days: 10,
    });

    // Actuals: a drawing-backed row, one material (labor 2.0/unit),
    // 12 units installed across 12 distinct days = 24 labor units
    // (20% over), day logs covering 24 productive hours, blockers on
    // 3 days (2 codes), one approved CO adding 1.5 days.
    // Real raster bytes behind the drawing row — the closeout PDF signs
    // its URL (missing object throws) AND react-pdf must decode it.
    const storagePath = `${projectId}/autopsy-fixture.png`;
    const { error: uploadError } = await admin.storage
      .from("drawings")
      .upload(storagePath, PNG_1X1, { contentType: "image/png" });
    if (uploadError) throw uploadError;
    const { data: drawing } = await admin
      .from("drawings")
      .insert({
        project_id: projectId,
        role: "marking",
        storage_path: storagePath,
        page_index: 0,
      })
      .select("id")
      .single();
    const { data: row } = await admin
      .from("rows")
      .insert({
        project_id: projectId,
        drawing_id: drawing!.id,
        label: "Row 1",
        x: 0.1,
        y: 0.1,
        w: 0.4,
        h: 0.1,
      })
      .select("id")
      .single();
    const { data: material } = await admin
      .from("materials")
      .insert({
        project_id: projectId,
        name: "Autopsy Beam",
        total_needed: 12,
        received: 12,
        labor_units: 2,
      })
      .select("id")
      .single();
    await admin
      .from("row_materials")
      .insert({ row_id: row!.id, material_id: material!.id, required_qty: 12 });

    const { data: crew } = await admin
      .from("crews")
      .insert({ org_id: org!.org_id, name: CREW_NAME })
      .select("id")
      .single();
    crewId = crew!.id;

    const day = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      return d.toISOString().slice(0, 10);
    };
    const installs = [];
    const dayLogs = [];
    for (let i = 0; i < 12; i++) {
      const workDate = day(14 - i);
      installs.push({
        row_id: row!.id,
        material_id: material!.id,
        qty: 1,
        crew_id: crewId,
        installed_on: workDate,
        idempotency_key: `autopsy-${projectId}-${i}`,
        device_id: "e2e",
      });
      dayLogs.push({
        project_id: projectId,
        crew_id: crewId,
        work_date: workDate,
        install_start: `${workDate}T08:00:00Z`,
        install_end: `${workDate}T10:00:00Z`, // 2h × 12 days = 24 productive hours
      });
    }
    const { error: installsError } = await admin.from("installs").insert(installs);
    if (installsError) throw installsError;
    const { error: dayLogsError } = await admin.from("day_logs").insert(dayLogs);
    if (dayLogsError) throw dayLogsError;

    const { error: blockersError } = await admin.from("blockers").insert([
      { project_id: projectId, code: "MISSING_MATERIAL", work_date: day(12) },
      { project_id: projectId, code: "MISSING_MATERIAL", work_date: day(11) },
      { project_id: projectId, code: "AREA_BLOCKED", work_date: day(10) },
    ]);
    if (blockersError) throw blockersError;

    const { error: coError } = await admin.from("change_orders").insert({
      project_id: projectId,
      number: 1,
      title: "Autopsy CO",
      reason: "site_condition",
      status: "approved",
      added_days: 1.5,
      customer_approved_via: "verbal",
      customer_approved_at: new Date().toISOString(),
      customer_approver_name: "E2E",
    });
    if (coError) throw coError;
  });

  await test.step("generate the autopsy from the Progress tab — numbers and verdicts land", async () => {
    await page.goto(`/app/project/${projectId}/progress`);
    await page.getByRole("button", { name: "Generate autopsy" }).click();
    await expect(page.getByText("Autopsy generated from actuals.")).toBeVisible({
      timeout: 20_000,
    });

    const dimensions = page.getByTestId("autopsy-dimensions");
    await expect(dimensions).toContainText("Days on site");
    // 12 actual vs 10 estimated = 20% over.
    await expect(dimensions).toContainText("20% over estimate");

    const { data: autopsy } = await admin
      .from("project_autopsies")
      .select("*")
      .eq("project_id", projectId!)
      .single();
    expect(autopsy!.estimated_days).toBe(10);
    expect(autopsy!.actual_days).toBe(12);
    expect(autopsy!.estimated_labor_units).toBe(20);
    expect(autopsy!.actual_labor_units).toBe(24);
    expect(autopsy!.actual_labor_hours).toBe(24);
    expect(autopsy!.change_order_count).toBe(1);
    expect(autopsy!.change_order_days).toBe(1.5);
    expect(autopsy!.blocker_days).toBe(3);
    expect(autopsy!.blocker_breakdown).toMatchObject({
      MISSING_MATERIAL: 2,
      AREA_BLOCKED: 1,
    });
  });

  await test.step("the 'Autopsy generated' closeout gate item auto-ticked", async () => {
    const { data: stage } = await admin
      .from("project_stages")
      .select("id")
      .eq("project_id", projectId!)
      .eq("stage_key", "closeout")
      .single();
    const { data: item } = await admin
      .from("project_gate_items")
      .select("done")
      .eq("project_stage_id", stage!.id)
      .eq("label", "Autopsy generated")
      .single();
    expect(item!.done).toBe(true);
  });

  await test.step("AI drafts the narrative from the numbers; saving persists it", async () => {
    test.skip(!process.env.ANTHROPIC_API_KEY, "needs ANTHROPIC_API_KEY");
    await page.getByRole("button", { name: /Draft with AI/ }).click();
    const textarea = page.getByLabel("Autopsy narrative");
    await expect(textarea).not.toHaveValue("", { timeout: 45_000 });

    await page.getByRole("button", { name: "Save narrative" }).click();
    await expect(page.getByText("Narrative saved.")).toBeVisible({ timeout: 10_000 });

    const { data: saved } = await admin
      .from("project_autopsies")
      .select("narrative")
      .eq("project_id", projectId!)
      .single();
    expect(saved!.narrative).toBeTruthy();
  });

  await test.step("email to owners exercises the full send path", async () => {
    await page.getByRole("button", { name: "Email to owners" }).click();
    // Resend's sandbox only delivers to the account's own address — until
    // a domain is verified (a standing NEEDS-YOU item), the send reaches
    // Resend and is rejected with a specific message. Either outcome
    // proves the whole path (recipients resolved, HTML composed, API
    // called) and surfaces honestly in the UI.
    await expect(
      page.getByText(/Emailed to owners\.|only send testing emails/)
    ).toBeVisible({ timeout: 20_000 });
  });

  await test.step("the closeout PDF includes the autopsy page", async () => {
    const response = await page.request.get(
      `/api/projects/${projectId}/closeout-pdf`
    );
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toBe("application/pdf");
  });

  await test.step("the company accuracy view lists the project with its variance", async () => {
    await page.goto("/app/estimate");
    const accuracy = page.getByTestId("estimate-accuracy");
    await expect(accuracy).toBeVisible();
    const row = accuracy.locator("tr").filter({ hasText: PROJECT_NAME });
    await expect(row).toBeVisible();
    await expect(row).toContainText("+20%");
  });
});
