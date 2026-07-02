# Progress

**Current status:** Phases 1–5 of this batch are all built, self-reviewed,
and passing lint/typecheck/build. **The migration is confirmed live** on
the Supabase project (verified read-only: all 14 tables, all 3 views, both
storage buckets exist and are queryable) — see `docs/BUILD-LOG.md` for how
this was discovered. No organization exists yet, so nobody has signed in
for real; the user is doing that first real sign-in themselves (becomes
the auto-bootstrapped `owner`) rather than having a disposable test
account created in their production project — so nothing in Phases 3–5 has
been clicked through in a live browser session yet. See the final
end-of-batch report for the full rundown.

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
- [ ] **NEEDS ME:** the migration is live but this hasn't been clicked
      through in a real browser session yet — that needs your first real
      sign-in (see Phase 2). Code is self-reviewed and passes
      lint/typecheck/build.

## Phase 4 — Drawing marking / row setup ✅ built (2026-07-02)

- [x] Layout tab: drawing stage with row overlays (`RowStage`).
- [x] Auto rows tool (drag box → split N equal, orientation choice).
- [x] Draw one / Edit tools (select, move, resize, rename, delete).
- [x] Sequential auto-naming, immediate persistence, multi-page aware.
- [x] Row fill % + hazard indicator for unassigned rows.
- [ ] **NEEDS ME:** same as Phase 3 — code self-reviewed (including a caught
      and fixed pixel-vs-normalized fill-orientation bug, see
      `docs/BUILD-LOG.md`) and passes lint/typecheck/build, but not yet
      clicked through live.

## Phase 5 — Materials × rows grid + reconciliation + reference drawing ✅ built (2026-07-02)

- [x] Read-only reference drawing overlay, click-to-focus grid column.
- [x] Spreadsheet grid: sticky column/header, computed + editable cells.
- [x] Add material / paste from packing slip.
- [x] Reconciliation card (installed/assigned/needed/received/to-order, %).
- [ ] **NEEDS ME:** same as Phases 3–4 — self-reviewed and passes
      lint/typecheck/build, not yet clicked through live.

## Phase 6 — Field/Crew PWA (not started)

## Phase 7 — Scheduler (not started)

## Phase 8 — Customer portal (not started)

## Phase 9 — Dashboards/reports/polish (not started)
