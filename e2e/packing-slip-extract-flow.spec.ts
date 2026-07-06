import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";

const FIXTURE_DRAWING = path.join(__dirname, "fixtures/test-drawing.svg");
const PROJECT_NAME = `[E2E] Packing slip extract ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

// Every cell in the review table is a real <input>, and an <input>'s
// current value is never part of its innerText/textContent (there's no
// text node — the value is rendered by the browser's own form-control
// widget) — allInnerTexts() on these rows silently returns empty strings.
// Read each row's actual field values via inputValue() instead.
async function readReviewRows(table: Locator): Promise<
  { code: string; description: string; size: string; qty: string }[]
> {
  const rows = table.locator("tbody tr");
  const count = await rows.count();
  const result: { code: string; description: string; size: string; qty: string }[] =
    [];
  for (let i = 0; i < count; i++) {
    const inputs = rows.nth(i).locator("input");
    const [code, description, size, qty] = await Promise.all([
      inputs.nth(0).inputValue(),
      inputs.nth(1).inputValue(),
      inputs.nth(2).inputValue(),
      inputs.nth(3).inputValue(),
    ]);
    result.push({ code, description, size, qty });
  }
  return result;
}

async function createProjectOnMaterialsTab(page: Page): Promise<string> {
  await page.goto("/app");
  await page.getByRole("button", { name: "+ New project" }).click();
  await page.locator("#name").fill(PROJECT_NAME);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/app\/project\/[^/]+$/);
  const id = /\/app\/project\/([^/]+)$/.exec(page.url())![1];
  await page.getByRole("link", { name: "Materials" }).click();
  return id;
}

// Renders a small synthetic packing slip (two line items sharing one
// product code but different sizes, plus a non-material freight line) as a
// screenshot, so the live-extraction test has real image bytes to send to
// the vision model without committing a binary fixture to the repo.
async function buildPackingSlipImage(page: Page): Promise<Buffer> {
  const fixturePage = await page.context().newPage();
  await fixturePage.setContent(`
    <html>
      <body style="margin:0;width:700px;height:400px;background:#ffffff;
        font-family:monospace;color:#000000;padding:24px;box-sizing:border-box;">
        <div style="font-weight:bold;font-size:24px;">ACME RACKING SUPPLY</div>
        <div style="font-size:18px;">Packing Slip #PS-10293</div>
        <br />
        <table style="border-collapse:collapse;font-size:18px;">
          <tr>
            <td style="padding:4px 20px 4px 0;">UPR-4224</td>
            <td style="padding:4px 20px 4px 0;">Upright Frame</td>
            <td style="padding:4px 20px 4px 0;">42"x24'</td>
            <td style="padding:4px 0;">QTY: 3</td>
          </tr>
          <tr>
            <td style="padding:4px 20px 4px 0;">36SQ10</td>
            <td style="padding:4px 20px 4px 0;">Beam</td>
            <td style="padding:4px 20px 4px 0;">144"</td>
            <td style="padding:4px 0;">QTY: 20</td>
          </tr>
          <tr>
            <td style="padding:4px 20px 4px 0;">36SQ10</td>
            <td style="padding:4px 20px 4px 0;">Beam</td>
            <td style="padding:4px 20px 4px 0;">96"</td>
            <td style="padding:4px 0;">QTY: 12</td>
          </tr>
          <tr>
            <td style="padding:4px 20px 4px 0;">WD-4246</td>
            <td style="padding:4px 20px 4px 0;">Wire Deck</td>
            <td style="padding:4px 20px 4px 0;">42"x46"</td>
            <td style="padding:4px 0;">QTY: 40</td>
          </tr>
        </table>
        <br />
        <div style="font-size:18px;">Freight charge ....................... $85.00</div>
      </body>
    </html>
  `);
  const buffer = await fixturePage.screenshot();
  await fixturePage.close();
  return buffer;
}

test("packing slip AI extraction: clear error when not configured", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.ANTHROPIC_API_KEY),
    "only relevant when no ANTHROPIC_API_KEY is configured"
  );

  projectId = await createProjectOnMaterialsTab(page);
  // Not a bare input[type="file"] locator — the Overview page's own
  // lifecycle checklist has a hidden photo-attach file input that can
  // still be in the DOM mid-navigation, making that ambiguous/racy.
  await page
    .getByTestId("packing-slip-upload-input")
    .setInputFiles(FIXTURE_DRAWING);
  await expect(page.getByTestId("packing-slip-upload-message")).toHaveText(
    /^Uploaded /,
    { timeout: 30_000 }
  );

  await page.getByTestId("extract-with-ai-fresh-upload").click();
  await expect(
    page.getByText(/ANTHROPIC_API_KEY is not configured/)
  ).toBeVisible({ timeout: 15_000 });
});

test("packing slip AI extraction: extracts line items, keeps distinct sizes, skips freight", async ({
  page,
}) => {
  test.skip(
    !process.env.ANTHROPIC_API_KEY,
    "needs a real ANTHROPIC_API_KEY to call the live extraction API"
  );
  test.setTimeout(120_000);

  projectId = await createProjectOnMaterialsTab(page);

  const slipImage = await buildPackingSlipImage(page);
  // Not a bare input[type="file"] locator — see the other test above.
  await page.getByTestId("packing-slip-upload-input").setInputFiles({
    name: "packing-slip.png",
    mimeType: "image/png",
    buffer: slipImage,
  });
  await expect(page.getByTestId("packing-slip-upload-message")).toHaveText(
    /^Uploaded /,
    { timeout: 30_000 }
  );

  await page.getByTestId("extract-with-ai-fresh-upload").click();

  const table = page.getByTestId("extract-review-table");
  await expect(table.locator("tbody tr")).toHaveCount(4, {
    timeout: 90_000,
  });

  const rows = await readReviewRows(table);
  expect(
    rows.some(
      (r) =>
        r.description.toLowerCase().includes("freight") ||
        r.code.toLowerCase().includes("freight")
    )
  ).toBe(false);

  const beamRows = rows.filter((r) => r.description.toLowerCase().includes("beam"));
  expect(beamRows).toHaveLength(2);
  expect(beamRows.some((r) => r.size.includes("144"))).toBe(true);
  expect(beamRows.some((r) => r.size.includes("96"))).toBe(true);
  // The two beam lines share one product code but differ in size — the
  // real-slip scenario this test stands in for (36SQ10 at two lengths).
  expect(new Set(beamRows.map((r) => r.size)).size).toBe(2);

  expect(
    rows.some((r) => /wire deck/i.test(r.description) && r.size.includes("46"))
  ).toBe(true);
  expect(
    rows.some((r) => /upright/i.test(r.description) && r.size.includes("24"))
  ).toBe(true);

  await page.getByRole("button", { name: /Add \d+ materials?/ }).click();
  await expect(page.getByTestId("extract-review-table")).not.toBeVisible();

  // This test's project has no rows (never visited the Layout tab), so
  // MaterialsGrid renders its "add rows first" empty state rather than a
  // table — the reconciliation card is what's always present once
  // materials exist, so it's what confirms the save actually happened.
  const reconciliationRows = page
    .getByTestId("reconciliation-table")
    .locator("tbody tr");
  await expect(reconciliationRows).toHaveCount(4);
  const savedNames = await reconciliationRows
    .locator("td:first-child")
    .evaluateAll((cells) => cells.map((el) => el.textContent ?? ""));
  expect(savedNames.some((name) => name.includes("144"))).toBe(true);
  expect(savedNames.some((name) => name.includes("96"))).toBe(true);
});
