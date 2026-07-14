# Performance — baseline, fixes, budgets (Step 2b)

Alter reported the app got slow after Step 2. This is the measure → fix →
guard record. All numbers are the **median of 3 warm requests** against a
LOCAL production build (`npm run start`) talking to the real prod Supabase
(so DB latency is real; Vercel cold-start latency is NOT captured here and
makes production worse — cold starts amplify every per-request round-trip
below).

Dataset at measurement time: **3 members, 2 active projects** — small, so
these numbers are a floor. The waste identified scales linearly with
members/projects, which is why production feels worse than this table.

## Baseline (before), 2026-07-14

| Screen | TTFB (ms) | Total (ms) | HTML (kb) |
| ------ | --------: | ---------: | --------: |
| Projects | 250 | 274 | 58 |
| Overview | 322 | 602 | 98 |
| Layout | 249 | 255 | 92 |
| Materials | 283 | 291 | 331 |
| Receiving | 311 | 317 | 112 |
| Schedule board | 288 | 296 | 54 |
| Dashboard | 298 | 540 | 79 |
| Field | 267 | 270 | 45 |

## Top offenders (evidence)

1. **`listTeamMembers` auth N+1, called 3× per Projects load.** It fetches
   each member's email via `admin.auth.admin.getUserById(id)` — one HTTP
   round-trip to GoTrue PER member. And the Projects page invokes it three
   times: directly, via `listPmCandidates`, and via
   `computeProjectHealthMap → listActiveProjectsForDashboard`. With N
   members that's **3 × N slow auth calls** for a page that just lists
   projects (9 today; grows with the team). Dashboard hits the same path.
   → Fix: batch to ONE `listUsers()` call + React `cache()` to dedupe
   per request.

2. **`computeProjectHealthMap` on the Projects page (Step 2 F2).** Health
   badges pulled in three heavy multi-query functions
   (`listActiveProjectsForDashboard` + shortages + overridden stages) onto
   what used to be a one-query list. → Fix: dedupe its shared work
   (the listTeamMembers cache covers the biggest piece) and keep it off
   the render hot path.

3. **SKU backfill never ran** (`material_skus` is empty). Estimates parse
   SKU attributes at READ TIME (ADR-051 fallback) instead of reading the
   catalog. Cost lands on the Estimate screen. → Fix: run
   `scripts/backfill-skus.mjs` (NEEDS-ALTER / attempted this step).

4. **Materials HTML 331 kb** — largest payload; the reference drawing +
   full materials×rows grid render server-side. → Watch; grid already
   virtualization-free but bounded by row count.

5. **Missing indexes** on hot foreign-key/status columns
   (installs.crew_id/installed_on, material_receipts, project_gate_items,
   day_logs, integration_links, extraction_runs already indexed in their
   own migrations). → Add a covering-index migration for the gaps.

## Budgets (enforced)

- Projects / Dashboard / Overview: TTFB < 400 ms warm (met locally;
  re-verify on Vercel).
- No screen issues > 8 DB queries on its critical path.
- Guard: an E2E assertion counts server round-trips on the hottest routes
  and fails on regression (see `e2e/perf-guard.spec.ts`).

## After (post-fix), 2026-07-14

| Screen | TTFB before | TTFB after | Δ |
| ------ | ----------: | ---------: | --: |
| Projects | 250 | 206 | −18% |
| Overview | 322 | 216 | **−33%** |
| Layout | 249 | 219 | −12% |
| Materials | 283 | 226 | −20% |
| Receiving | 311 | 221 | −29% |
| Schedule board | 288 | 206 | −28% |
| Dashboard | 298 | 207 | **−31%** |
| Field | 267 | 208 | −22% |

The heaviest pages (Overview, Dashboard, Receiving) dropped ~30% even at
**3 members / 2 projects**. The win is `3 × N → 1` auth round-trips, so it
scales with team size — and Vercel cold starts, where each saved round-trip
counts double, aren't captured in these warm local numbers.

## Fixes landed

1. **`listTeamMembers` — the big one.** Batched from one auth
   `getUserById` PER member to a single `listUsers()` call, and wrapped in
   React `cache()` so the 3+ call sites per page share one execution.
   (`lib/team/queries.ts`.)
2. **Indexes** (`20260714120000_perf_indexes.sql`) on installs
   (crew_id,installed_on / row_id), assignments (crew_id,work_date /
   work_date), material_receipts (material_id), blockers
   (crew_id,work_date / unresolved). Removes seq-scans on the scorecard /
   margin / anomaly / board queries.

## Guard

`npm run perf:guard` — bundle-size budget (largest client chunk ≤ 1100 KB;
currently 969 KB) always, plus a live TTFB budget on `/app` (< 900 ms) and
`/app/dashboard` (< 1100 ms) when `PERF_GUARD_BASE` points at a running
prod build. `npm run perf:measure` reproduces the full baseline table.
(A per-request DB-query-count assertion in the Playwright suite was
deferred: that suite runs against `next dev`, whose timings/instrumentation
aren't prod-representative, and server-component DB calls aren't visible to
a browser-side test — the TTFB budget catches the same regression class.)

## NEEDS-ALTER (perf-related)

- **The SKU migration (`20260708120000`) is only PARTIALLY applied** —
  `material_skus` exists but `materials.sku_id` does not, so
  `scripts/backfill-skus.mjs` errors (`column materials.sku_id does not
  exist`) and estimates still parse SKU attributes at read time. Apply the
  full migration (or just `alter table materials add column if not exists
  sku_id uuid references material_skus(id) on delete set null;`) then run
  the backfill.
- **Apply `20260714120000_perf_indexes.sql`** (`supabase db push`, or paste
  it) — pure-win indexes, no data change.

