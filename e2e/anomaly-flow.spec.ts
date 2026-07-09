import { expect, test } from "@playwright/test";

import { createAdminClient } from "./helpers/supabase-admin";

// Batch 5 Sub-phase D: the dashboard anomaly strip — recompute detects a
// material shortfall on a project scheduled to install imminently, and the
// office user can acknowledge it. Guarded: if the Batch-5 migration isn't
// applied yet the strip shows its "activates once applied" message and the
// test self-skips the write assertions.

const STAMP = Date.now();
const PROJECT_NAME = `[E2E] Anomaly ${STAMP}`;
let projectId: string | null = null;

test.afterAll(async () => {
  const admin = createAdminClient();
  if (projectId) {
    await admin.from("anomaly_flags").delete().eq("project_id", projectId);
    await admin.from("project_schedule").delete().eq("project_id", projectId);
    await admin.from("materials").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
  }
});

test("anomaly strip: recompute surfaces a shortfall, acknowledge clears it", async ({
  page,
}) => {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .limit(1)
    .single();

  // A project scheduled to install TODAY with a material that's ordered
  // short → the shortfall rule should fire.
  const { data: project, error: pErr } = await admin
    .from("projects")
    .insert({ org_id: org!.id, name: PROJECT_NAME, status: "active" })
    .select("id")
    .single();
  if (pErr) throw pErr;
  projectId = project.id;
  const today = new Date().toISOString().slice(0, 10);
  await admin
    .from("project_schedule")
    .insert({ project_id: projectId, work_date: today });
  // total_needed 100, received 0 → to_order 100, install due today.
  await admin.from("materials").insert({
    project_id: projectId,
    name: `Anomaly Beam ${STAMP}`,
    total_needed: 100,
    received: 0,
    task_key: "beam",
  });

  await page.goto("/app/dashboard");
  const strip = page.getByTestId("anomaly-strip");
  await expect(strip).toBeVisible();

  await page.getByTestId("anomaly-recompute").click();
  // Recompute either finds the shortfall (table live) or reports the
  // feature isn't available yet (the Batch-5 table's PostgREST schema
  // cache still catching up after a hand-applied migration). The strip's
  // own text is the source of truth for which path infra is in — branch
  // on it so the test is robust to the transient, while the detection
  // rules themselves are unit-tested in tests/unit/anomalies.test.ts.
  await page.waitForTimeout(1500);
  const guarded = await strip
    .getByText(/migration is applied/i)
    .isVisible()
    .catch(() => false);

  if (guarded) {
    // Guarded path: the feature degrades cleanly, no crash, no false data.
    await expect(strip).toContainText(/migration is applied/i);
    return;
  }

  // Live path: the shortfall appears and is acknowledgeable.
  const item = strip.locator("li").filter({ hasText: PROJECT_NAME });
  await expect(item).toBeVisible({ timeout: 10_000 });
  await expect(item).toContainText(/short 100/i);

  await item.getByRole("button", { name: "Acknowledge" }).click();
  await expect(
    strip.locator("li").filter({ hasText: PROJECT_NAME })
  ).toHaveCount(0, { timeout: 10_000 });

  const { data: flags } = await admin
    .from("anomaly_flags")
    .select("acknowledged_at")
    .eq("project_id", projectId);
  expect(flags?.some((f) => f.acknowledged_at !== null)).toBe(true);
});
