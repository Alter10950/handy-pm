import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
const BASE = "http://localhost:3010";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: proj } = await sb.from("projects").select("id").ilike("name","%bingo%").limit(1).single();
const pid = proj.id;

const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: "e2e/.auth/owner.json" });
const page = await ctx.newPage();
// warm the base origin so subsequent same-origin fetches work
await page.goto(BASE + "/app", { waitUntil: "domcontentloaded" });

const routes = [
  ["Projects", "/app"],
  ["Overview", `/app/project/${pid}`],
  ["Layout", `/app/project/${pid}/mark`],
  ["Materials", `/app/project/${pid}/materials`],
  ["Receiving", `/app/project/${pid}/receiving`],
  ["ScheduleBoard", "/scheduler/board"],
  ["Dashboard", "/app/dashboard"],
  ["Field", "/field"],
];

async function timeRoute(path) {
  const samples = [];
  for (let i = 0; i < 4; i++) {
    const t = await page.evaluate(async (u) => {
      const start = performance.now();
      const res = await fetch(u, { cache: "no-store" });
      const firstByte = performance.now() - start;
      const buf = await res.arrayBuffer();
      return { ttfb: Math.round(firstByte), total: Math.round(performance.now()-start), bytes: buf.byteLength, status: res.status };
    }, BASE + path);
    samples.push(t);
  }
  const s = samples.slice(1); // drop first (compile/warm)
  const med = (k) => s.map(x=>x[k]).sort((a,b)=>a-b)[Math.floor(s.length/2)];
  return { ttfb: med("ttfb"), total: med("total"), kb: Math.round(samples[0].bytes/1024), status: samples[0].status };
}

console.log("screen\tTTFB\tTotal\tHTMLkb\tstatus");
for (const [name, path] of routes) {
  const r = await timeRoute(path);
  console.log(`${name}\t${r.ttfb}\t${r.total}\t${r.kb}\t${r.status}`);
}
await browser.close();
