// Step 2b perf guard. Fails the build/CI on a performance regression.
//
//   node scripts/perf-guard.mjs                 # bundle-size budget only
//   PERF_GUARD_BASE=http://localhost:3010 \
//     node --env-file=.env.local scripts/perf-guard.mjs   # + live TTFB
//
// Bundle budget catches client bloat (a Step-2b suspect); the optional
// TTFB check catches a server-side regression like the listTeamMembers
// auth-N+1 coming back — that spikes TTFB on the hot routes.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_CHUNK_KB = 1100; // largest single client chunk (uncompressed)
const TTFB_BUDGET_MS = { "/app": 900, "/app/dashboard": 1100 };

let failed = false;
function fail(msg) {
  console.error("✗ " + msg);
  failed = true;
}
function ok(msg) {
  console.log("✓ " + msg);
}

// ── bundle budget ──
try {
  const dir = ".next/static/chunks";
  const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
  let maxKb = 0;
  let maxFile = "";
  for (const f of files) {
    const kb = Math.round(statSync(join(dir, f)).size / 1024);
    if (kb > maxKb) {
      maxKb = kb;
      maxFile = f;
    }
  }
  if (maxKb > MAX_CHUNK_KB) {
    fail(`largest client chunk ${maxKb}KB (${maxFile}) exceeds ${MAX_CHUNK_KB}KB budget`);
  } else {
    ok(`largest client chunk ${maxKb}KB ≤ ${MAX_CHUNK_KB}KB (${maxFile})`);
  }
} catch (err) {
  fail(`could not read .next/static/chunks — run \`npm run build\` first (${err.message})`);
}

// ── optional live TTFB budget ──
const base = process.env.PERF_GUARD_BASE;
if (base) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    storageState: "e2e/.auth/owner.json",
  });
  const page = await ctx.newPage();
  await page.goto(base + "/app", { waitUntil: "domcontentloaded" });
  for (const [path, budget] of Object.entries(TTFB_BUDGET_MS)) {
    const samples = [];
    for (let i = 0; i < 4; i++) {
      const t = await page.evaluate(async (u) => {
        const start = performance.now();
        const res = await fetch(u, { cache: "no-store" });
        const ttfb = performance.now() - start;
        await res.arrayBuffer();
        return Math.round(ttfb);
      }, base + path);
      samples.push(t);
    }
    // median of the last 3 (drop the warm-up sample)
    const med = samples.slice(1).sort((a, b) => a - b)[1];
    if (med > budget) {
      fail(`${path} TTFB ${med}ms exceeds ${budget}ms budget`);
    } else {
      ok(`${path} TTFB ${med}ms ≤ ${budget}ms`);
    }
  }
  await browser.close();
}

process.exit(failed ? 1 : 0);
