import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";

const FIXTURE_DRAWING = path.join(__dirname, "fixtures/test-drawing.svg");
const PROJECT_NAME = `[E2E] Packing slip extract ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

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
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_DRAWING);
  await expect(page.getByTestId("packing-slip-upload-message")).toHaveText(
    /^Uploaded /,
    { timeout: 30_000 }
  );

  await page.getByRole("button", { name: /Extract with AI/ }).click();
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
  await page.locator('input[type="file"]').setInputFiles({
    name: "packing-slip.png",
    mimeType: "image/png",
    buffer: slipImage,
  });
  await expect(page.getByTestId("packing-slip-upload-message")).toHaveText(
    /^Uploaded /,
    { timeout: 30_000 }
  );

  await page.getByRole("button", { name: /Extract with AI/ }).click();

  const table = page.getByTestId("extract-review-table");
  await expect(table.locator("tbody tr")).toHaveCount(4, {
    timeout: 90_000,
  });

  const rowTexts = await table.locator("tbody tr").allInnerTexts();
  const fullText = rowTexts.join(" | ").toLowerCase();
  expect(fullText).not.toContain("freight");

  const beamRows = rowTexts.filter((text) => text.toLowerCase().includes("beam"));
  expect(beamRows).toHaveLength(2);
  expect(beamRows.some((text) => text.includes("144"))).toBe(true);
  expect(beamRows.some((text) => text.includes("96"))).toBe(true);

  expect(rowTexts.some((text) => /wire deck/i.test(text) && text.includes("46"))).toBe(
    true
  );
  expect(
    rowTexts.some((text) => /upright/i.test(text) && text.includes("24"))
  ).toBe(true);

  await page.getByRole("button", { name: /Add \d+ materials?/ }).click();
  await expect(page.getByTestId("extract-review-table")).not.toBeVisible();

  const gridRows = page.locator("table").first().locator("tbody tr");
  await expect(gridRows).toHaveCount(4);
  const gridText = (await gridRows.allInnerTexts()).join(" | ").toLowerCase();
  expect(gridText).toContain("144");
  expect(gridText).toContain("96");
});
