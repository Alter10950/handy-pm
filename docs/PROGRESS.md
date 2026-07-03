# Progress

**Current status:** Phases 1–5 of this batch are all built AND now
**verified live** via an automated Playwright E2E suite
(`npm run test:e2e`) running against the real Supabase project — no more
manual click-through needed to trust this. That suite's first real run
caught and fixed a genuine bug (`NEXT_PUBLIC_*` env vars weren't reaching
the browser bundle on the sign-in/upload paths — see `docs/DECISIONS.md`
ADR-016) that five phases of self-review and `next build` had missed,
because none of that exercises a real browser. Org "Handy Equip" exists
(seeded by `scripts/seed.mjs`); the user is doing their own real
first/owner sign-in separately (see `docs/BUILD-LOG.md`).

**Production deploy:** live at `https://handy-pm.vercel.app` — the
`Internal Server Error` (missing Supabase env vars on Vercel) is fixed,
all three env vars are set for Production/Preview/Development, `/login`
confirmed returning 200. Still needs a human: add the production domain
to Supabase's Auth **Site URL** / **Redirect URLs** in the dashboard (no
Management API token available here — see `docs/BUILD-LOG.md` for exact
steps).

This roadmap (Phase 1 = done) is confirmed by the user — no longer a draft:

2. DB schema/RLS/storage/types
3. Projects + drawing & packing-slip uploads + materials
4. Drawing marking / row setup
5. Materials × rows grid + reconciliation + reference drawing
6. Field/Crew PWA
7. Scheduler
8. Customer portal
9. Dashboards/reports/polish

---

## Phase 1 — Foundation ✅ complete (2026-07-02)

- [x] Documentation system: `CLAUDE.md`, `docs/PROGRESS.md`,
      `docs/BUILD-LOG.md`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`.
- [x] Next.js App Router + TypeScript (strict) scaffold, ESLint, `@/*` alias.
- [x] Tailwind CSS v4 + shadcn/ui, Handy Equip theme tokens as CSS variables.
- [x] Prettier + ESLint/Prettier compatibility; `dev`/`build`/`start`/`lint`/
      `typecheck`/`format` npm scripts.
- [x] Git repo initialized, `.gitignore`, conventional-commit history.
- [x] Supabase clients (browser, server, admin) reading env vars;
      `.env.local.example` documented.
- [x] Email magic-link auth: `/login`, `/auth/callback`, sign-out.
- [x] Route guard: `proxy.ts` (middleware) + protected-layout backstop for
      `/app`, `/scheduler`, `/field`; `/portal/[token]` public.
- [x] Responsive Handy Equip-themed app shell: header, nav, signed-in user,
      sign-out.
- [x] Placeholder pages: `/app`, `/scheduler`, `/field`, `/portal/[token]`.
- [x] PWA: manifest, generated icons (192/512/512-maskable + favicon/apple
      touch icon), hand-rolled service worker, apple web-app meta tags.
- [x] README with setup, env vars, and Vercel deploy steps.
- [x] Quality gates passing (lint, typecheck, build).

## Phase 2 — DB schema/RLS/storage/types

- [x] Supabase CLI initialized, `supabase/migrations/`.
- [x] Schema: organizations, profiles, projects, drawings, packing_slips,
      materials, rows, row_materials, installs, crews, crew_members,
      assignments, targets, crew_rates, share_tokens + indexes.
- [x] Auth bootstrap trigger (`auth.users` insert → `profiles`, first user
      becomes `owner` of a new org).
- [x] RLS enabled on every table, org-scoped, `crew` role restricted.
- [x] Storage buckets `drawings` + `packing-slips`, org-scoped policies.
- [x] Views: `row_progress`, `project_progress`, `material_reconciliation`.
- [x] TypeScript `Database` types wired into Supabase clients.
- [x] **Migration applied and confirmed live** — verified read-only via the
      REST API (all tables/views/buckets present). Renamed `current_role()`
      → `current_user_role()` (collided with a reserved Postgres keyword);
      see `docs/DECISIONS.md` ADR-008 update and `docs/BUILD-LOG.md`.

## Phase 3 — Projects + drawing & packing-slip uploads + materials ✅ built (2026-07-02)

- [x] `/app` real projects list (from `project_progress`) + New project
      dialog.
- [x] `/app/project/[id]` tab shell: Overview, Layout ("mark" route),
      Materials, Progress.
- [x] Drawing upload: PDF → per-page images via pdf.js, or single image.
- [x] Packing slip upload + paste-material-list parser.
- [x] Materials inline-edit table (superseded by the Phase 5 grid — see
      below).
- [x] Overview tab: meta, stats, drawing thumbnail.
- [x] **Verified live** via `npm run test:e2e` (see Phase "Testing" below)
      — create-project-through-upload-materials flow confirmed working
      against the real Supabase project, not just self-review.

## Phase 4 — Drawing marking / row setup ✅ built (2026-07-02)

- [x] Layout tab: drawing stage with row overlays (`RowStage`).
- [x] Auto rows tool (drag box → split N equal, orientation choice).
- [x] Draw one / Edit tools (select, move, resize, rename, delete).
- [x] Sequential auto-naming, immediate persistence, multi-page aware.
- [x] Row fill % + hazard indicator for unassigned rows.
- [x] **Verified live** — the fixed pixel-vs-normalized fill-orientation
      bug (self-review catch) and the auto-rows drag flow are both
      exercised by the E2E suite.

## Phase 5 — Materials × rows grid + reconciliation + reference drawing ✅ built (2026-07-02)

- [x] Read-only reference drawing overlay, click-to-focus grid column.
- [x] Spreadsheet grid: sticky column/header, computed + editable cells.
- [x] Add material / paste from packing slip.
- [x] Reconciliation card (installed/assigned/needed/received/to-order, %).
- [x] **Verified live** — the E2E suite pastes a material list, assigns
      quantities across 3 rows, and asserts exact Assigned/Left/To-order
      numbers in both the grid and the reconciliation card.

## Testing ✅ built (2026-07-02)

- [x] `scripts/seed.mjs` — idempotent org + confirmed test user, replaces
      the old manual "rename the org" one-off SQL snippet.
- [x] Playwright E2E suite (`npm run test:e2e`) against the live Supabase
      project: admin-generated sign-in (no email), full create-project→
      mark-rows→assign-materials→verify-reconciliation flow, self-cleaning.
- [x] Found and fixed a real bug on its first run — see ADR-016.

## Phase 6 — Field/Crew PWA (not started)

## Phase 7 — Scheduler (not started)

## Phase 8 — Customer portal (not started)

## Phase 9 — Dashboards/reports/polish (not started)
