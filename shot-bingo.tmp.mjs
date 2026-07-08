import { chromium } from "@playwright/test";

const OUT = "C:/Users/aleitner/AppData/Local/Temp/claude/c--Users-aleitner-Documents-Handy-PM/525b4936-858f-44c2-b7d9-d0c1fe453040/scratchpad";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  baseURL: "http://localhost:3001",
  storageState: "e2e/.auth/owner.json",
  viewport: { width: 1440, height: 1000 },
});
const page = await ctx.newPage();

// Draft estimate with a Bingo-Warehouse-scale BOM through the real UI.
await page.goto("/app/estimate");
await page.getByRole("button", { name: "+ New estimate" }).click();
await page.locator("#name").fill("[SANITY] Bingo-scale check");
await page.getByRole("button", { name: /Create/ }).click();
await page.waitForURL(/\/app\/project\/[^/]+/);

await page.getByRole("link", { name: "Materials" }).click();
await page.getByRole("button", { name: /Paste from packing slip/i }).click();
await page.locator("textarea").fill(
  [
    '42"x288" Teardrop Upright, 700',
    '144"x6" Stepbeam, 2200',
    '96"x4" Stepbeam, 1500',
    '42"x46" Wire Deck, 3000',
    '1/2" Wedge Anchor, 2800',
  ].join("\n")
);
await page.getByRole("button", { name: "Add materials" }).click();
await page.waitForTimeout(1500);

await page.getByRole("link", { name: "Estimate" }).click();
await page.waitForLoadState("networkidle");

const fullScope = await page.getByTestId("estimate-stat-full-scope").textContent();
const days = await page.getByTestId("estimate-stat-days").textContent();
const finish = await page.getByTestId("estimate-stat-forecast-finish").textContent();
console.log("FULL SCOPE:", fullScope);
console.log("CREW-DAYS:", days);
console.log("FORECAST:", finish);

await page.screenshot({ path: `${OUT}/p13-bingo-estimate.png`, fullPage: true });

// Clean up the sanity project.
const url = page.url();
const projectId = /\/app\/project\/([^/]+)/.exec(url)[1];
console.log("PROJECT:", projectId);

await ctx.close();
await browser.close();
console.log("done");
