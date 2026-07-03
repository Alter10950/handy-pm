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
confirmed returning 200.

**Auth:** switched from email magic-link to email + password (see
`docs/DECISIONS.md` ADR-017) — magic-link delivery was too slow/unreliable
to develop and sign in against. No public sign-up; accounts are created
from the new **Team** page (`/app/team`, owner/pm only), which also
supports changing a member's role and resetting their password. Also
added self-service password change at `/account` (any role). This removes
the earlier "needs a human to configure Supabase Auth Redirect URLs" item
entirely — password sign-in has no callback URL to register, on either
localhost or production.

**Layout tab:** zoom/pan/fullscreen, multi-select + bulk quantities, and
row duplication added on top of Phase 4 (see `docs/DECISIONS.md`
ADR-018) — real feedback from the first live layout (Bingo Warehouse):
big warehouses need to zoom/pan to draw precisely, and marking many
near-identical rows one at a time was too slow. Row coordinates are
still normalized 0..1 in the DB; zoom/pan is purely a view transform,
verified zoom-invariant against the DB directly in
`e2e/row-workspace.spec.ts`, not just by inspection.

**Batch 2 (in progress, 2026-07-03):** sub-phase 0's schema migration
(`phases`, `blockers`, `day_logs`, `project_schedule`,
`installs.idempotency_key`/`device_id`, `materials.size`/`labor_units`,
one-marking-page-per-project, `daily-photos` bucket — see ADR-019) is
**drafted and committed but not yet applied** to the live Supabase
project — no access token/DB password was available in this environment
to run `supabase db push` directly. **NEEDS YOU:** either give a one-time
Supabase personal access token (Dashboard → Account → Access Tokens,
then `npx supabase login` and `npx supabase link`) so this and every
future migration can be pushed autonomously, or paste
`supabase/migrations/20260703104548_phases_scheduling_field_ops.sql`
into the Supabase SQL editor yourself (one step, safe to run more than
once — everything in it is idempotent). Sub-phase A (Team
deactivate/reactivate) is done and doesn't depend on this migration.
Sub-phases B–F (Field/Crew closeout, Scheduler, Phases, multi-page
drawings, packing-slip AI extraction) are queued and will resume as soon
as the schema is confirmed live.

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

## Phase 4 — Drawing marking / row setup ✅ built (2026-07-02, extended 2026-07-03)

- [x] Layout tab: drawing stage with row overlays (`RowStage`).
- [x] Auto rows tool (drag box → split N equal, orientation choice).
- [x] Draw one / Edit tools (select, move, resize, rename, delete).
- [x] Sequential auto-naming, immediate persistence, multi-page aware.
- [x] Row fill % + hazard indicator for unassigned rows.
- [x] Zoom (wheel/ctrl+wheel/pinch toward cursor, +/−/Fit buttons) + pan
      (Hand tool, space-drag, two-finger touch) + Fullscreen — a pure
      view transform, row coordinates stay normalized 0..1 in the DB.
- [x] Select tool: tap/shift-range/marquee multi-select rows, then
      "Set materials for selected rows" writes required_qty for every
      selected row × filled-in material in one action.
- [x] Duplicate a row (same geometry, placed adjacent, auto-named,
      optional "duplicate N times"), with or without copying its
      material assignments.
- [x] **Verified live** — `e2e/row-workspace.spec.ts`: draws a row at
      fit-zoom and again after zooming ~2.4x over the same content,
      confirming normalized geometry matches within tolerance directly
      against the DB; selects rows 2-11 and bulk-sets 2 materials,
      confirming rows 1/12 (just outside the range) got neither;
      duplicates a row twice with materials copied; reloads and confirms
      everything persisted.
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

## Sub-phase 0 — Schema for Field/Scheduler/Phases ⚠️ drafted, not yet applied (2026-07-03)

- [x] Migration written: `phases`, `blockers`, `day_logs`,
      `project_schedule` tables; `materials.size`/`labor_units`;
      `installs.idempotency_key`/`device_id`; `rows.phase_id`;
      `drawings.role`/`projects.mark_drawing_id` (one marking page per
      project, DB-enforced via a partial unique index +
      `set_marking_drawing()`); `daily-photos` storage bucket; RLS on
      every new table; `row_progress.phase_id`. See ADR-019.
- [x] `lib/supabase/database.types.ts` hand-updated to match (ADR-010's
      pattern), so sub-phases A–F can be built and typechecked against
      the new shape immediately.
- [ ] **NEEDS YOU** — not yet applied to the live Supabase project (no
      access token/DB password available here). See the status note at
      the top of this file for the two ways to unblock it.

## Auth — email + password, Team management ✅ built (2026-07-03)

- [x] `/login` — email + password (`supabase.auth.signInWithPassword`),
      magic-link flow and `/auth/callback` removed entirely (ADR-017).
- [x] No public sign-up. `/app/team` (owner/pm only) — create accounts
      (email + temp password + role), change an existing member's role,
      reset their password.
- [x] `/account` — self-service change-password, any signed-in role.
- [x] Deactivate/reactivate a team member (sub-phase A, 2026-07-03) — a
      ~100-year Supabase Auth ban / lifted ban, not a delete; blocks
      sign-in and token refresh (an already-active session can keep
      working up to its natural ~1h expiry). Self-lockout guarded, same
      as the role-change action.
- [x] **Verified live** — `e2e/team-flow.spec.ts` creates a member,
      changes their role (confirmed persisted across a real page reload,
      not just optimistic client state), resets their password,
      deactivates then reactivates them (confirmed via the admin API's
      `banned_until`), and exercises the self-service change-password
      flow. This run is also the standing proof that email+password
      login works end to end on localhost; production
      (`https://handy-pm.vercel.app`) was verified separately the same
      way it was built (see `docs/BUILD-LOG.md` 2026-07-03 entries).

## Testing ✅ built (2026-07-02, extended 2026-07-03)

- [x] `scripts/seed.mjs` — idempotent org + confirmed test user (+ known
      password, reset every run), replaces the old manual "rename the
      org" one-off SQL snippet.
- [x] Playwright E2E suite (`npm run test:e2e`) against the live Supabase
      project: real `/login` form sign-in (no admin backdoor needed now
      that auth is password-based), full create-project→mark-rows→
      assign-materials→verify-reconciliation flow, self-cleaning.
- [x] `e2e/team-flow.spec.ts` — Team screen create/role-change/
      password-reset + self-service change-password, self-cleaning.
- [x] `e2e/row-workspace.spec.ts` — zoom-invariant drawing accuracy
      (verified against the DB), multi-select + bulk quantities with an
      exact-boundary check, duplicate-with-materials, reload persistence.
- [x] Found and fixed a real bug on its first run — see ADR-016.

## Phase 6 — Field/Crew PWA (not started)

## Phase 7 — Scheduler (not started)

## Phase 8 — Customer portal (not started)

## Phase 9 — Dashboards/reports/polish (not started)
