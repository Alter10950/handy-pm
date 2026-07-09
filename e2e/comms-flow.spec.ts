import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

type StageKey =
  | "handoff"
  | "scope"
  | "schedule"
  | "materials"
  | "mobilize"
  | "execute"
  | "punch"
  | "closeout";

const PROJECT_NAME = `[E2E] Comms ${Date.now()}`;
const CREW_NAME = `[E2E] Comms crew ${Date.now()}`;
const CUSTOMER_EMAIL = "delivered@resend.dev";

let projectId: string | null = null;
let crewId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
  if (crewId) {
    const admin = createAdminClient();
    await admin.from("crews").delete().eq("id", crewId);
  }
});

async function overrideActiveStage(page: Page, reason: string) {
  await page.getByRole("button", { name: /Override \(\d+ open\)/ }).click();
  await page.getByPlaceholder("Reason for override (required)").fill(reason);
  await page.getByRole("button", { name: "Confirm override" }).click();
}

test("comms: contact+prefs, auto milestones (schedule/install/50%/phase/punch/closeout), finish-changed notice, safe customer report, manual log", async ({
  page,
}) => {
  const admin = createAdminClient();
  test.setTimeout(240_000);

  await test.step("create a project and set the customer contact on the Comms tab", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    await page.getByRole("link", { name: "Comms", exact: true }).click();
    await page.locator("#contact-name").fill("Dana Customer");
    await page.locator("#contact-email").fill(CUSTOMER_EMAIL);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  });

  await test.step("set up install data directly: drawing, phased row needing 2 units, a crew", async () => {
    const { data: org } = await admin
      .from("projects")
      .select("org_id")
      .eq("id", projectId!)
      .single();

    // A REAL storage object must back the drawing row — the Overview
    // page signs a URL for drawings[0] and a missing object throws
    // ("Object not found") into the page's error boundary.
    const storagePath = `${projectId}/comms-fixture.svg`;
    const fixtureBytes = readFileSync(
      path.join(__dirname, "fixtures/test-drawing.svg")
    );
    const { error: uploadError } = await admin.storage
      .from("drawings")
      .upload(storagePath, fixtureBytes, { contentType: "image/svg+xml" });
    if (uploadError) throw uploadError;

    const { data: drawing, error: drawingError } = await admin
      .from("drawings")
      .insert({
        project_id: projectId!,
        role: "marking",
        storage_path: storagePath,
        page_index: 0,
      })
      .select("id")
      .single();
    if (drawingError) throw drawingError;

    const { data: phase, error: phaseError } = await admin
      .from("phases")
      .insert({ project_id: projectId!, name: "North wall", color: "#22c55e" })
      .select("id")
      .single();
    if (phaseError) throw phaseError;

    const { data: row, error: rowError } = await admin
      .from("rows")
      .insert({
        project_id: projectId!,
        drawing_id: drawing.id,
        label: "Row 1",
        x: 0.1,
        y: 0.1,
        w: 0.3,
        h: 0.1,
        phase_id: phase.id,
      })
      .select("id")
      .single();
    if (rowError) throw rowError;

    const { data: material, error: materialError } = await admin
      .from("materials")
      .insert({
        project_id: projectId!,
        name: "Comms Beam",
        total_needed: 2,
        received: 2,
        labor_units: 0.1,
      })
      .select("id")
      .single();
    if (materialError) throw materialError;

    const { error: rmError } = await admin
      .from("row_materials")
      .insert({ row_id: row.id, material_id: material.id, required_qty: 2 });
    if (rmError) throw rmError;

    const { data: crew, error: crewError } = await admin
      .from("crews")
      .insert({ org_id: org!.org_id, name: CREW_NAME })
      .select("id")
      .single();
    if (crewError) throw crewError;
    crewId = crew.id;
  });

  await test.step("committing the schedule emails 'dates confirmed' and ticks 'Customer notified of schedule'", async () => {
    await page.goto(`/scheduler/${projectId}`);
    await page.getByRole("button", { name: "Build schedule" }).click();
    await page.getByRole("button", { name: "Generate days" }).click();
    await page.getByRole("button", { name: "Save schedule" }).click();
    await expect(page.getByText(/scheduled days?/)).toBeVisible({
      timeout: 20_000,
    });

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("project_comms")
          .select("id, subject, kind, channel, recipient")
          .eq("project_id", projectId!)
          .eq("kind", "milestone")
          .ilike("subject", "%install dates are confirmed%");
        return data?.length ?? 0;
      })
      .toBe(1);

    const { data: stage } = await admin
      .from("project_stages")
      .select("id")
      .eq("project_id", projectId!)
      .eq("stage_key", "schedule")
      .single();
    const { data: item } = await admin
      .from("project_gate_items")
      .select("done")
      .eq("project_stage_id", stage!.id)
      .eq("label", "Customer notified of schedule")
      .single();
    expect(item!.done).toBe(true);
  });

  await test.step("advancing past Mobilize emails 'installation has started'", async () => {
    await page.goto(`/app/project/${projectId}`);
    // Walk the lifecycle to Execute by overriding each active stage —
    // the panel auto-follows the newly active stage after each override.
    const stagesToExecute: StageKey[] = [
      "handoff",
      "scope",
      "schedule",
      "materials",
      "mobilize",
    ];
    for (const label of stagesToExecute) {
      await overrideActiveStage(page, `E2E fast-forward past ${label}`);
      await expect
        .poll(async () => {
          const { data } = await admin
            .from("project_stages")
            .select("status")
            .eq("project_id", projectId!)
            .eq("stage_key", label)
            .single();
          return data?.status;
        })
        .toBe("overridden");
    }

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("project_comms")
          .select("id")
          .eq("project_id", projectId!)
          .eq("kind", "milestone")
          .ilike("subject", "%installation has started%");
        return data?.length ?? 0;
      })
      .toBe(1);
  });

  await test.step("the first install crossing 50% emails 'over halfway there'", async () => {
    await page.goto(`/field/${projectId}`);
    await page.locator("#crew-select").selectOption({ label: CREW_NAME });
    await page.getByText("Row 1", { exact: true }).click();
    await expect(page.getByText("0 / 2")).toBeVisible();
    await page.getByRole("button", { name: "+1" }).click();

    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("project_comms")
            .select("id")
            .eq("project_id", projectId!)
            .eq("kind", "milestone")
            .ilike("subject", "%over halfway there%");
          return data?.length ?? 0;
        },
        { timeout: 20_000 }
      )
      .toBe(1);
  });

  await test.step("a changed expected finish prompts for a customer-safe reason and sends old → new", async () => {
    // A prior saved estimate with a very different forecast guarantees
    // the just-saved one differs, deterministically.
    const { error } = await admin.from("project_estimates").insert({
      project_id: projectId!,
      estimated_labor_units: 99,
      estimated_hours: 99,
      estimated_days: 12,
      forecast_finish: "2026-01-01",
    });
    if (error) throw error;

    await page.goto(`/app/project/${projectId}/estimate`);
    await page.getByRole("button", { name: "Save this estimate" }).click();
    const prompt = page.getByTestId("finish-changed-prompt");
    await expect(prompt).toBeVisible({ timeout: 10_000 });
    await expect(prompt).toContainText("2026-01-01 →");

    await prompt
      .getByLabel("Customer-facing reason")
      .fill("Material logistics");
    await prompt.getByRole("button", { name: "Notify customer" }).click();
    await expect(
      page.getByText("Customer notified of the new expected finish.")
    ).toBeVisible({ timeout: 20_000 });

    const { data: notice } = await admin
      .from("project_comms")
      .select("subject, body_snapshot")
      .eq("project_id", projectId!)
      .eq("kind", "milestone")
      .ilike("subject", "%updated expected finish%")
      .single();
    expect(notice!.body_snapshot).toContain("2026-01-01");
    expect(notice!.body_snapshot).toContain("Material logistics");
    // The internal wording never appears — the reason is the PM's own
    // customer-safe phrasing, typed by hand.
  });

  await test.step("finishing the phased row emails 'phase complete'", async () => {
    await page.goto(`/field/${projectId}`);
    await page.locator("#crew-select").selectOption({ label: CREW_NAME });
    await page.getByText("Row 1", { exact: true }).click();
    await page.getByRole("button", { name: "+1" }).click();

    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("project_comms")
            .select("id")
            .eq("project_id", projectId!)
            .eq("kind", "milestone")
            .ilike("subject", "%North wall%");
          return data?.length ?? 0;
        },
        { timeout: 20_000 }
      )
      .toBe(1);
  });

  await test.step("punch and closeout milestones fire on their stage transitions", async () => {
    await page.goto(`/app/project/${projectId}`);
    const finalStages: StageKey[] = ["execute", "punch", "closeout"];
    for (const label of finalStages) {
      await overrideActiveStage(page, `E2E fast-forward past ${label}`);
      await expect
        .poll(async () => {
          const { data } = await admin
            .from("project_stages")
            .select("status")
            .eq("project_id", projectId!)
            .eq("stage_key", label)
            .single();
          return data?.status;
        })
        .toBe("overridden");
    }

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("project_comms")
          .select("subject")
          .eq("project_id", projectId!)
          .eq("kind", "milestone");
        const subjects = (data ?? []).map((c) => c.subject ?? "");
        return {
          punch: subjects.some((s) => s.includes("punch list complete")),
          closeout: subjects.some((s) => s.includes("project closed out")),
        };
      })
      .toEqual({ punch: true, closeout: true });
  });

  await test.step("'Send update now' emails the customer-safe report — no internal data in the logged snapshot", async () => {
    await page.goto(`/app/project/${projectId}/comms`);
    await page.getByRole("button", { name: "Send update now" }).click();
    await expect(page.getByText("Update sent and logged below.")).toBeVisible({
      timeout: 20_000,
    });

    const { data: report } = await admin
      .from("project_comms")
      .select("body_snapshot, recipient")
      .eq("project_id", projectId!)
      .eq("kind", "weekly_report")
      .single();
    expect(report!.recipient).toBe(CUSTOMER_EMAIL);
    // The safety contract: % complete and plan, NEVER internal signals.
    expect(report!.body_snapshot).toContain("Complete");
    expect(report!.body_snapshot).toContain("Expected finish");
    expect(report!.body_snapshot).not.toContain("Blocker");
    expect(report!.body_snapshot).not.toContain("SPI");
    expect(report!.body_snapshot).not.toContain("to order");
    expect(report!.body_snapshot).not.toContain("shortage");
  });

  await test.step("a phone call gets logged manually and the history shows everything", async () => {
    await page
      .getByLabel("Comm summary")
      .fill("Told Dana punch is done, closeout next week");
    await page.getByRole("button", { name: "Log it" }).click();

    const history = page.getByTestId("comms-history");
    await expect(
      history.getByText("Told Dana punch is done, closeout next week")
    ).toBeVisible({
      timeout: 10_000,
    });
    // Everything above is in one place: milestones, the report, the call.
    const { data: all } = await admin
      .from("project_comms")
      .select("kind")
      .eq("project_id", projectId!);
    expect(all!.length).toBeGreaterThanOrEqual(8);
  });
});
