import { expect, test } from "@playwright/test";

import { createAdminClient } from "./helpers/supabase-admin";
import { deleteProjectCompletely } from "./helpers/cleanup";

const PROJECT_NAME = `[E2E] QC punch ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

// Phase 14 tables ship dark until the migration is approved (see
// docs/BUILD-LOG.md "NEEDS ME") — skip cleanly when they're absent so
// the suite stays green pre-push and this spec self-activates post-push.
test("QC checklist and punch list: crew passes checks, raises and closes a punch item", async ({
  page,
}) => {
  const admin = createAdminClient();
  const probe = await admin.from("punch_items").select("id").limit(1);
  test.skip(
    probe.error !== null,
    "Phase 14 migration not applied yet (punch_items missing)"
  );

  await test.step("create a project with one marked row", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    // Row via admin (drawing upload isn't what this spec tests).
    const { data: drawing, error: drawingError } = await admin
      .from("drawings")
      .insert({
        project_id: projectId,
        storage_path: `${projectId}/qc-test.svg`,
        width: 800,
        height: 600,
      })
      .select("id")
      .single();
    if (drawingError) throw drawingError;
    const { error: rowError } = await admin.from("rows").insert({
      project_id: projectId,
      drawing_id: drawing.id,
      label: "Row 1",
      x: 0.1,
      y: 0.1,
      w: 0.3,
      h: 0.1,
    });
    if (rowError) throw rowError;
  });

  await test.step("pass two QC checks on the row", async () => {
    await page.goto(`/app/project/${projectId}/progress`);
    const panel = page.getByTestId("qc-punch-panel");
    await expect(panel).toBeVisible();

    await panel.getByRole("button", { name: /Row 1/ }).click();
    await panel.getByRole("button", { name: /Uprights plumb & level/ }).click();
    await expect(panel.getByText("1/6")).toBeVisible();
    await panel.getByRole("button", { name: /Anchors set & torqued/ }).click();
    await expect(panel.getByText("2/6")).toBeVisible();
    await expect(panel.getByText("In progress").first()).toBeVisible();
  });

  await test.step("raise a punch item, then close it", async () => {
    const panel = page.getByTestId("qc-punch-panel");
    await panel.getByRole("button", { name: "Add item" }).click();
    await page.getByLabel("What's wrong?").fill("Scratched end barrier");
    await page.getByRole("button", { name: "Add punch item" }).click();
    await expect(panel.getByText("Scratched end barrier")).toBeVisible();
    await expect(panel.getByText(/1 open item/)).toBeVisible();

    await panel.getByRole("button", { name: "Mark done" }).click();
    await expect(panel.getByText(/Nothing open/)).toBeVisible({
      timeout: 10_000,
    });

    // DB truth: resolved_at stamped.
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("punch_items")
          .select("status, resolved_at")
          .eq("project_id", projectId!)
          .single();
        return data?.status === "done" && data.resolved_at !== null;
      })
      .toBe(true);
  });
});
