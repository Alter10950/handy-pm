# Progress

**Current status:** Phase 1 complete. Phase 2 (schema/RLS/storage/types)
authored and committed; migration push to the live project is a **NEEDS ME**
blocker (see below). Phases 3–5 (projects + uploads, drawing marking,
materials × rows grid) in progress in one long autonomous session — see
`docs/BUILD-LOG.md` for the latest entry.

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
- [ ] **NEEDS ME:** migration not yet applied to the live project — needs a
      Supabase personal access token or DB password (see latest
      `docs/BUILD-LOG.md` entry). Apply with `npx supabase link
      --project-ref ntdynurigavrpvexwiij` then `npx supabase db push`, or
      paste the 5 files in `supabase/migrations/` into the SQL editor in
      order.

## Phase 3 — Projects + drawing & packing-slip uploads + materials

- [ ] `/app` real projects list (from `project_progress`) + New project
      dialog.
- [ ] `/app/project/[id]` tab shell: Overview, Layout, Materials, Progress.
- [ ] Drawing upload: PDF → per-page images via pdf.js, or single image.
- [ ] Packing slip upload + paste-material-list parser.
- [ ] Materials inline-edit table.
- [ ] Overview tab: meta, stats, drawing thumbnail.

## Phase 4 — Drawing marking / row setup

- [ ] Layout tab: drawing stage with row overlays.
- [ ] Auto rows tool (drag box → split N equal, orientation choice).
- [ ] Draw one / Edit tools (select, move, resize, rename, delete).
- [ ] Sequential auto-naming, immediate persistence, multi-page aware.
- [ ] Row fill % + hazard indicator for unassigned rows.

## Phase 5 — Materials × rows grid + reconciliation + reference drawing

- [ ] Read-only reference drawing overlay, click-to-focus grid column.
- [ ] Spreadsheet grid: sticky column/header, computed + editable cells.
- [ ] Add material / paste from packing slip.
- [ ] Reconciliation card (installed/assigned/needed/received/to-order, %).

## Phase 6 — Field/Crew PWA (not started)

## Phase 7 — Scheduler (not started)

## Phase 8 — Customer portal (not started)

## Phase 9 — Dashboards/reports/polish (not started)
