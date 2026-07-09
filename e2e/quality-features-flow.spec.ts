import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

// Design pass v3 F2: pin-to-sidebar, project health badge, CSV export,
// and the keyboard-shortcuts sheet. (Undo toast is covered in
// import-bulk-flow.spec.ts.)

const STAMP = Date.now();
const NAME = `[E2E] QF ${STAMP}`;
let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

test("quality features: pin to sidebar, health badge, CSV export, shortcuts sheet", async ({
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
    .insert({ org_id: org!.id, name: NAME, status: "active" })
    .select("id")
    .single();
  if (error) throw error;
  projectId = project.id;

  await test.step("Projects list shows a health badge on the row", async () => {
    await page.goto("/app");
    await page.getByTestId("projects-search").fill(String(STAMP));
    // Cards view by default — the badge sits in the card.
    await expect(page.getByTestId("health-badge").first()).toBeVisible();
  });

  await test.step("pin the project — it appears under Pinned in the sidebar", async () => {
    await page.goto(`/app/project/${projectId}`);
    await expect(page.getByTestId("pin-project")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    await page.getByTestId("pin-project").click();
    await expect(page.getByTestId("pin-project")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // Only present on the desktop sidebar (lg+); this project runs Desktop
    // Chrome, so the sidebar is visible.
    await expect(
      page.getByTestId("sidebar-pinned").getByText(NAME)
    ).toBeVisible();
  });

  await test.step("pin survives a reload (localStorage), then unpins", async () => {
    await page.reload();
    await expect(
      page.getByTestId("sidebar-pinned").getByText(NAME)
    ).toBeVisible();
    await page.getByTestId("pin-project").click();
    await expect(page.getByTestId("sidebar-pinned")).toHaveCount(0);
  });

  await test.step("visited project shows under Recent", async () => {
    await expect(
      page.getByTestId("sidebar-recent").getByText(NAME)
    ).toBeVisible();
  });

  await test.step("CSV export downloads a file with the project", async () => {
    await page.goto("/app");
    await page.getByTestId("projects-search").fill(String(STAMP));
    // Wait for the filtered result to render before exporting — the button
    // serializes the CURRENT matches, so exporting mid-filter would emit a
    // header-only file.
    await expect(page.getByTestId("filter-count-projects")).toHaveText(
      /1 projects/
    );
    await expect(page.locator("#main-content").getByText(NAME)).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("projects-export-csv").click(),
    ]);
    expect(download.suggestedFilename()).toBe("projects.csv");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString("utf8");
    expect(csv).toContain(NAME);
    expect(csv).toContain("Project,Status,Complete %");
  });

  await test.step("? opens the keyboard-shortcuts sheet", async () => {
    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts-sheet")).toBeVisible();
    await expect(
      page.getByText("Keyboard shortcuts", { exact: true })
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcuts-sheet")).toHaveCount(0);
  });
});
