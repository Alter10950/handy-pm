import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

// One timestamp for the run; names chosen so A–Z order is deterministic
// and search prefixes are unique to this run.
const RUN = Date.now();
const ALPHA = `[E2E] PPage Alpha ${RUN}`;
const ZULU = `[E2E] PPage Zulu ${RUN}`;
const DONE = `[E2E] PPage Done ${RUN}`;

let alphaId: string | null = null;
let zuluId: string | null = null;
let doneId: string | null = null;

test.afterAll(async () => {
  for (const id of [alphaId, zuluId, doneId]) {
    if (id) await deleteProjectCompletely(id);
  }
});

test("projects page: search, cards/list toggle persistence, A–Z order, completed section", async ({
  page,
}) => {
  const admin = createAdminClient();
  test.setTimeout(120_000);

  await test.step("set up two active projects and one completed", async () => {
    const { data: org } = await admin
      .from("organizations")
      .select("id")
      .limit(1)
      .single();
    const { data: created, error } = await admin
      .from("projects")
      .insert([
        { org_id: org!.id, name: ZULU, status: "active" as const },
        { org_id: org!.id, name: ALPHA, status: "active" as const },
        { org_id: org!.id, name: DONE, status: "complete" as const },
      ])
      .select("id, name");
    if (error) throw error;
    alphaId = created.find((p) => p.name === ALPHA)!.id;
    zuluId = created.find((p) => p.name === ZULU)!.id;
    doneId = created.find((p) => p.name === DONE)!.id;
  });

  await test.step("main section shows only active projects, A–Z; completed is collapsed with a count", async () => {
    await page.goto("/app");
    const active = page.getByTestId("active-projects-section");
    await expect(active.getByText(ALPHA)).toBeVisible();
    await expect(active.getByText(ZULU)).toBeVisible();
    await expect(active.getByText(DONE)).toHaveCount(0);

    // A–Z: Alpha renders before Zulu in the DOM.
    const names = await active
      .locator("h2, td a")
      .filter({ hasText: `PPage` })
      .allTextContents();
    const alphaIndex = names.findIndex((n) => n.includes("Alpha"));
    const zuluIndex = names.findIndex((n) => n.includes("Zulu"));
    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(zuluIndex).toBeGreaterThan(alphaIndex);

    // Completed: collapsed by default, counted, not visible until expanded.
    const toggle = page.getByTestId("completed-toggle");
    await expect(toggle).toContainText(/Completed \(\d+\)/);
    await expect(page.getByText(DONE)).toHaveCount(0);
    await toggle.click();
    await expect(
      page.getByTestId("completed-projects-section").getByText(DONE)
    ).toBeVisible();
    await toggle.click();
    await expect(page.getByText(DONE)).toHaveCount(0);
  });

  await test.step("search filters instantly, matches completed (auto-expanding), and clears", async () => {
    const search = page.getByTestId("projects-search");
    await search.fill("Zulu");
    await expect(page.getByText(ZULU)).toBeVisible();
    await expect(page.getByText(ALPHA)).toHaveCount(0);

    // A completed match auto-expands the bottom section.
    await search.fill(`PPage Done ${RUN}`);
    await expect(
      page.getByTestId("completed-projects-section").getByText(DONE)
    ).toBeVisible();
    await expect(page.getByText(ALPHA)).toHaveCount(0);

    // No matches → clear-search action restores everything. (Scoped:
    // the input's × carries the same accessible name.)
    await search.fill("zzz-no-such-project");
    await expect(page.getByTestId("no-matches")).toContainText(
      "No projects match."
    );
    await page
      .getByTestId("no-matches")
      .getByRole("button", { name: "Clear search" })
      .click();
    await expect(
      page.getByTestId("active-projects-section").getByText(ALPHA)
    ).toBeVisible();

    // The × button clears too.
    await search.fill("Alpha");
    await page.getByLabel("Clear search").click();
    await expect(search).toHaveValue("");
  });

  await test.step("list view renders compact rows and persists across reload", async () => {
    await page.getByTestId("view-toggle-list").click();
    const table = page
      .getByTestId("active-projects-section")
      .getByTestId("projects-list-table");
    await expect(table).toBeVisible();
    const row = table.locator("tr").filter({ hasText: ALPHA });
    await expect(row).toBeVisible();
    await expect(row.getByText("No PM assigned")).toBeVisible();

    // Click anywhere on the row opens the project.
    await row.click();
    await page.waitForURL(new RegExp(`/app/project/${alphaId}$`));

    // Persistence: back on /app after a full reload, list view sticks.
    await page.goto("/app");
    await expect(
      page
        .getByTestId("active-projects-section")
        .getByTestId("projects-list-table")
    ).toBeVisible();
    await expect(page.getByTestId("view-toggle-list")).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // Completed section uses the table too when expanded in list view.
    await page.getByTestId("completed-toggle").click();
    await expect(
      page
        .getByTestId("completed-projects-section")
        .getByTestId("projects-list-table")
        .getByText(DONE)
    ).toBeVisible();

    // Switch back to cards and confirm that persists as well.
    await page.getByTestId("view-toggle-cards").click();
    await page.reload();
    await expect(page.getByTestId("view-toggle-cards")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(
      page
        .getByTestId("active-projects-section")
        .getByTestId("projects-list-table")
    ).toHaveCount(0);
  });
});

test.describe("projects page on a phone (390×844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("both views render without page overflow", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

    const overflowCards = await page.evaluate(
      () =>
        (document.scrollingElement?.scrollWidth ?? 0) -
        (document.scrollingElement?.clientWidth ?? 0)
    );
    expect(overflowCards).toBeLessThanOrEqual(1);

    await page.getByTestId("view-toggle-list").click();
    const overflowList = await page.evaluate(
      () =>
        (document.scrollingElement?.scrollWidth ?? 0) -
        (document.scrollingElement?.clientWidth ?? 0)
    );
    expect(overflowList).toBeLessThanOrEqual(1);

    // Leave the shared default behind for other specs.
    await page.getByTestId("view-toggle-cards").click();
  });
});
