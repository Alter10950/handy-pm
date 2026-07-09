import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

// Batch 5 Sub-phase C(1): printable QR label sheet + scan-to-receive
// entry points. The camera scan itself needs BarcodeDetector + a device
// camera (not available headless), so this verifies the label sheet
// renders a QR per material and the Receiving tab exposes the scan +
// print-labels controls with a manual code fallback.

const STAMP = Date.now();
const PROJECT_NAME = `[E2E] QR ${STAMP}`;
let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

test("QR labels: label sheet renders a QR per material; receiving exposes scan + print", async ({
  page,
}) => {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .limit(1)
    .single();
  const { data: project, error } = await admin
    .from("projects")
    .insert({ org_id: org!.id, name: PROJECT_NAME, status: "active" })
    .select("id")
    .single();
  if (error) throw error;
  projectId = project.id;
  await admin.from("materials").insert([
    { project_id: projectId, name: `QR Beam ${STAMP}`, total_needed: 10, task_key: "beam" },
    { project_id: projectId, name: `QR Anchor ${STAMP}`, total_needed: 20, task_key: "anchor" },
  ]);

  await test.step("label sheet renders one QR per material", async () => {
    await page.goto(`/app/project/${projectId}/labels`);
    await expect(
      page.getByRole("heading", { name: "Material labels" })
    ).toBeVisible();
    // One label card per material, each embedding a QR as inline SVG.
    await expect(page.getByTestId("qr-label")).toHaveCount(2);
    await expect(
      page.getByTestId("qr-label").first().locator("svg")
    ).toBeVisible();
    await expect(page.getByText(`QR Beam ${STAMP}`)).toBeVisible();
  });

  await test.step("receiving tab exposes scan + print-labels controls", async () => {
    await page.goto(`/app/project/${projectId}/receiving`);
    await expect(page.getByTestId("scan-to-receive")).toBeVisible();
    await expect(page.getByRole("link", { name: "Print labels" })).toBeVisible();
  });

  await test.step("manual code entry in the scanner jumps to that material", async () => {
    const { data: materials } = await admin
      .from("materials")
      .select("id, name")
      .eq("project_id", projectId!)
      .ilike("name", "%Anchor%");
    const anchorId = materials![0].id;

    await page.getByTestId("scan-to-receive").click();
    // Camera won't open headless; the manual code box is the fallback path.
    await page.getByPlaceholder("…or paste a code").fill(anchorId);
    await page.getByRole("button", { name: "Go" }).click();

    // The scanned material's row is highlighted (scrolled into view).
    await expect(
      page.locator(`tr[data-material-id="${anchorId}"]`)
    ).toHaveClass(/bg-brand-subtle/, { timeout: 5000 });
  });
});
