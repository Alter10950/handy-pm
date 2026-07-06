import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const PROJECT_NAME = `[E2E] Lifecycle ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

test("stage-gate lifecycle: 8-stage stepper, checklist, complete a stage, override past incomplete items", async ({
  page,
}) => {
  const admin = createAdminClient();

  await test.step("create a project — lifecycle auto-bootstraps at Handoff", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    // All 8 stage pills render, Handoff active (others locked).
    for (const label of [
      "Handoff",
      "Scope",
      "Schedule",
      "Materials",
      "Mobilize",
      "Execute",
      "Punch",
      "Closeout",
    ]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }

    const { data: stages } = await admin
      .from("project_stages")
      .select("stage_key, status")
      .eq("project_id", projectId!);
    expect(stages).toHaveLength(8);
    expect(stages?.find((s) => s.stage_key === "handoff")?.status).toBe("active");
    expect(stages?.find((s) => s.stage_key === "scope")?.status).toBe("locked");

    const { data: items } = await admin
      .from("project_gate_items")
      .select("id, label, project_stage_id")
      .in(
        "project_stage_id",
        (
          await admin
            .from("project_stages")
            .select("id")
            .eq("project_id", projectId!)
        ).data!.map((s) => s.id)
      );
    expect(items?.length).toBe(29);
  });

  await test.step("what's next shows Handoff's own open items", async () => {
    // The same item label also renders in the checklist below, so scope
    // through the panel's own testid rather than an unscoped getByText.
    const whatsNext = page.getByTestId("whats-next-panel");
    await expect(whatsNext).toBeVisible();
    await expect(whatsNext.getByText("Site survey completed with photos")).toBeVisible();
  });

  await test.step("check off one item, confirm it persists", async () => {
    const checkbox = page.getByLabel("Existing racking condition recorded");
    await checkbox.check();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("project_gate_items")
          .select("done")
          .eq("label", "Existing racking condition recorded")
          .single();
        return data?.done;
      })
      .toBe(true);
  });

  await test.step("Complete stage is blocked while items remain open", async () => {
    await expect(page.getByRole("button", { name: "Complete stage" })).toBeDisabled();
  });

  await test.step("override the Handoff gate with a reason — advances to Scope", async () => {
    await page.getByRole("button", { name: /Override \(\d+ open\)/ }).click();
    await page
      .getByPlaceholder("Reason for override (required)")
      .fill("E2E test — advancing past incomplete items on purpose");
    await page.getByRole("button", { name: "Confirm override" }).click();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("project_stages")
          .select("status")
          .eq("project_id", projectId!)
          .eq("stage_key", "handoff")
          .single();
        return data?.status;
      })
      .toBe("overridden");

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("project_stages")
          .select("status")
          .eq("project_id", projectId!)
          .eq("stage_key", "scope")
          .single();
        return data?.status;
      })
      .toBe("active");

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("projects")
          .select("stage_key")
          .eq("id", projectId!)
          .single();
        return data?.stage_key;
      })
      .toBe("scope");
  });

  await test.step("Scope tab is now active and expanded, showing its own items", async () => {
    await page.reload();
    await page.getByRole("button", { name: "Scope", exact: true }).click();
    const checklist = page.getByTestId("gate-checklist");
    await expect(checklist.getByText("Drawing approved for install")).toBeVisible();
  });

  await test.step("Handoff's own checklist shows the override reason", async () => {
    // Only one stage's checklist is expanded at a time, so switch back to
    // Handoff to see its card (which carries override_reason), rather than
    // expecting it alongside Scope's items above.
    await page.getByRole("button", { name: "Handoff", exact: true }).click();
    const checklist = page.getByTestId("gate-checklist");
    await expect(checklist.getByText(/Overridden — E2E test/)).toBeVisible();
  });
});
