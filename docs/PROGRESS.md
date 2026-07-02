# Progress

**Current status:** Phase 1 (Foundation) complete. `npm run lint`,
`npm run typecheck`, and `npm run build` all pass. Waiting on the user to
create a Supabase project and supply real credentials before Phase 2 starts.

> **Note on Phases 2–9 below:** only Phase 1's scope was specified in detail.
> The Phase 2–9 breakdown is this session's best-guess roadmap for a
> racking-install PM tool, inferred from the project summary — **not** a
> scope the user has confirmed. Treat it as a draft to review and adjust
> before each phase kicks off, not a locked plan.

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

## Phase 2 — Data model & core CRUD (draft, not started)

- [ ] Design Supabase schema: `projects`, `customers`/sites, `profiles`.
- [ ] Migrations (Supabase CLI) + RLS policies.
- [ ] Typed Supabase queries (generated types via Supabase CLI).
- [ ] `/app` — real project list + project detail views.
- [ ] Basic create/edit project forms.

## Phase 3 — Scheduling (draft, not started)

- [ ] `schedule_entries` schema linked to projects and crew.
- [ ] `/scheduler` calendar/timeline UI.
- [ ] Crew assignment.

## Phase 4 — Field app (draft, not started)

- [ ] Install checklists per project.
- [ ] Photo capture/upload (Supabase Storage).
- [ ] Job status updates from the field.
- [ ] Offline-friendly behavior (build on the Phase 1 service worker).

## Phase 5 — Customer portal (draft, not started)

- [ ] `portal_tokens` schema + generation flow.
- [ ] `/portal/[token]` real read-only project status/timeline.
- [ ] Token revocation / expiry.

## Phase 6 — Documents & files (draft, not started)

- [ ] Supabase Storage buckets + RLS.
- [ ] Attachments/drawings per project.
- [ ] File management UI.

## Phase 7 — Notifications & communications (draft, not started)

- [ ] Email/SMS notifications on status changes.
- [ ] Reminders (scheduling, follow-ups).

## Phase 8 — Reporting & dashboards (draft, not started)

- [ ] KPIs / project analytics.
- [ ] Crew utilization reports.

## Phase 9 — Polish, QA & launch (draft, not started)

- [ ] Accessibility pass.
- [ ] Performance pass.
- [ ] Test coverage.
- [ ] Production hardening / launch checklist.
