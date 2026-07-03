# CLAUDE.md — Handy PM operating manual

Read this file first, every session. It is the source of truth for how this
repo is built and how work gets logged.

## Project summary

Handy PM is project management software for **Handy Equip**, a warehouse
racking-install company. It has four areas:

- `/app` — office/PM area (projects, protected, requires sign-in)
- `/field` — crew phone app, installable PWA (protected, requires sign-in)
- `/scheduler` — crew/install scheduling (protected, requires sign-in)
- `/portal/[token]` — public, read-only customer-facing project status page
  (no auth — access is gated by an unguessable share token, added in a later
  phase)

This is Phase 1: foundation, auth wiring, theme, PWA shell, and the
documentation system below. No business data model yet — that's Phase 2.

## Tech stack and versions

Installed and locked as of Phase 1 (see `package.json` / `package-lock.json`
for exact resolutions):

| Package               | Version                                       |
| --------------------- | --------------------------------------------- |
| next                  | 16.2.10 (App Router, Turbopack)               |
| react / react-dom     | 19.2.4                                        |
| typescript            | 5.9.3 (strict mode)                           |
| tailwindcss           | 4.3.2                                         |
| shadcn (CLI)          | 4.12.0, `base-nova` style on `@base-ui/react` |
| @base-ui/react        | 1.6.0                                         |
| @supabase/supabase-js | 2.110.0                                       |
| @supabase/ssr         | 0.12.0                                        |
| eslint                | 9.39.4 (flat config, `eslint-config-next`)    |
| prettier              | 3.9.4                                         |
| node                  | 24.x (see `node --version` locally)           |

Deployment target: **Vercel**. Backend: **Supabase** (Postgres + Auth +
Storage; schema in `supabase/migrations/`, see `docs/ARCHITECTURE.md`).

## Commands

```bash
npm run dev           # start the dev server (Turbopack)
npm run build         # production build
npm run start         # run the production build locally
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
npm run format        # prettier --write .
npm run format:check  # prettier --check .
npm run seed          # idempotently ensure the E2E test org + user exist
npm run test:e2e      # seed, then run the Playwright suite against the
                       # real Supabase project (localhost:3001) — see
                       # docs/ARCHITECTURE.md "Testing" and ADR-015
```

**Database migrations**: SQL files in `supabase/migrations/`, applied in
filename (timestamp) order.

```bash
npx supabase migration new <name>                        # create a new migration file
npx supabase link --project-ref <ref>                     # one-time, needs a personal access token
npx supabase db push                                      # apply pending migrations to the linked project
npx supabase gen types typescript --project-id <ref> \
  > lib/supabase/database.types.ts                         # regenerate types after any schema change
```

No Docker/local Postgres in this environment, so `supabase start` /
`--local` flags aren't available here — migrations are authored and
reviewed locally, then pushed to the real project once linked. If `db push`
isn't available (no token/password), paste the migration files into the
Supabase dashboard's SQL editor in filename order as a fallback — same SQL,
same order.

## Folder structure map

```
app/
  layout.tsx                 root layout: fonts, metadata, viewport, SW registration
  page.tsx                   "/" — redirects to /app or /login based on auth
  globals.css                Tailwind v4 + Handy Equip theme tokens
  manifest.ts                PWA manifest (special file → /manifest.webmanifest)
  icon.tsx / apple-icon.tsx  generated favicon / apple touch icon (next/og)
  icons/icon-*/route.tsx     generated 192/512/512-maskable PWA icons (next/og)
  login/page.tsx             email + password sign-in page (public); no
                             sign-up form — see docs/DECISIONS.md ADR-017
  portal/[token]/page.tsx    public customer portal placeholder
  (protected)/               route group — shared authed shell
    layout.tsx                fetches the user + profile role, redirects to
                               /login if absent, renders SiteHeader +
                               children (force-dynamic)
    error.tsx                  themed error boundary (Server Action throws
                               land here, e.g. "no org assigned yet")
    account/page.tsx           self-service change-password (any role)
    app/page.tsx               "/app" — Projects list + New project dialog
    app/team/page.tsx           "Team" — owner/pm only: create accounts
                               (email + temp password + role), change an
                               existing member's role, reset their password
    app/project/[id]/
      layout.tsx                 project header + ProjectTabs nav
      page.tsx                   Overview tab
      mark/page.tsx               "Layout" tab — row marking workspace, see
                                 docs/DECISIONS.md for why the folder is
                                 "mark", not "layout"
      materials/page.tsx          Materials tab — reference drawing +
                                 materials × rows grid + reconciliation
      progress/page.tsx           Progress tab (project-level rollup)
    scheduler/page.tsx         "/scheduler" placeholder
    field/page.tsx             "/field" placeholder

components/
  ui/                        shadcn/ui primitives (generated, don't hand-edit)
  site-header.tsx            authed nav + sign-out; nav is role-aware (Team
                             link only for owner/pm)
  login-form.tsx             email + password sign-in form (client component)
  placeholder-panel.tsx       shared placeholder page shell
  service-worker-register.tsx registers public/sw.js on mount
  account/
    change-password-form.tsx   calls supabase.auth.updateUser({password})
                               directly — operates on the current session,
                               no admin API involved
  team/
    add-team-member-dialog.tsx  create-account dialog (email, optional
                               name, role, temp password w/ generate button)
    team-member-row.tsx          per-member role select + reset-password
                               disclosure
  projects/
    new-project-dialog.tsx      + project-card / project-tabs /
                               project-status-badge.tsx
    drawing-upload.tsx           + packing-slip-upload.tsx
    row-fill-marker.tsx           shared fill/label/hazard visual — used by
                                 both row-stage.tsx (editable) and
                                 materials-reference-stage.tsx (read-only)
    row-stage.tsx                 pointer-interactive marking canvas —
                                 zoom/pan/multi-select/marquee live here;
                                 see docs/ARCHITECTURE.md for why the
                                 existing draw/move/resize math needed no
                                 changes for zoom/pan to work
    use-zoom-pan.ts                zoom/pan state + wheel/pinch handling —
                                 takes the viewport ref as a param rather
                                 than creating/returning one; see its
                                 docstring and docs/DECISIONS.md ADR-018
                                 before "simplifying" that back
    zoom-controls.tsx              floating +/−/Fit/% overlay
    row-marking-workspace.tsx      + auto-rows-dialog / row-edit-sheet.tsx /
                                 duplicate-row-dialog.tsx /
                                 bulk-materials-panel.tsx
    duplicate-row-dialog.tsx        copy count + "also copy materials" toggle
    bulk-materials-panel.tsx        one qty input per material, applies to
                                 every selected row in one action
    materials-reference-stage.tsx  read-only drawing view, click-to-highlight
    materials-grid.tsx             the spreadsheet (sticky header/column)
    materials-workspace.tsx        orchestrates the two above + highlight state
    reconciliation-card.tsx        per-material install/assign/order summary
    paste-materials-dialog.tsx      shared by materials-grid and (formerly)
                                 the Phase 3 materials table

lib/
  supabase/
    env.ts                    lazy required-env-var reader
    client.ts                 browser Supabase client factory
    server.ts                 server Supabase client factory (Server
                               Components / Route Handlers / Server Actions)
    admin.ts                  service-role client — server-only, bypasses RLS
    proxy.ts                  session refresh + protected-route redirect
                               logic, called from proxy.ts
    database.types.ts         hand-written Database type (see
                               docs/ARCHITECTURE.md — regenerate once linked)
  auth/actions.ts             signOut server action
  projects/
    queries.ts                 read-only data access (Server Components)
    actions.ts                  Server Actions for structured mutations —
                               see docs/DECISIONS.md ADR-012 for why file
                               uploads are NOT here
    parse-material-list.ts      pure "name, qty" line parser
  rows/
    naming.ts                   pure sequential "Row N" auto-naming +
                               rowNumber() (single-label N, for
                               multi-select range ordering)
    actions.ts                   Server Actions: create/move/resize/rename/
                               delete/duplicate a row, upsert a row's (or,
                               in bulk, many rows') required qty for a
                               material
  team/
    queries.ts                  listTeamMembers() — RLS-scoped profiles
                               query joined with admin-client email lookups
                               (auth.users isn't exposed to RLS at all)
    actions.ts                   Server Actions: createTeamMember,
                               updateTeamMemberRole, resetTeamMemberPassword
                               — every one re-derives the caller's own role
                               from the DB before touching anything; the
                               admin-client paths explicitly re-check org
                               membership since they bypass RLS
    generate-password.ts        client-safe random temp-password generator
                               (crypto.getRandomValues), used by both the
                               create dialog and the reset-password form
  pdf/render-drawing-file.ts  browser-only PDF/image → JPEG Blob rendering
                             (pdfjs-dist + canvas) for drawing uploads
  utils.ts                    cn() class merge helper (shadcn)

proxy.ts                      Next.js 16 "proxy" (formerly middleware) —
                               guards /app, /scheduler, /field

supabase/
  config.toml                 Supabase CLI project config
  migrations/*.sql             schema, RLS, storage, views — see
                               docs/ARCHITECTURE.md for the full data model

scripts/seed.mjs               idempotent E2E org+user+password seed —
                               plain Node (not part of the Next.js TS
                               build), run via `node --env-file=.env.local`

e2e/
  auth.setup.ts                 signs in through the real /login form
                               (email+password), saves storageState —
                               Playwright "setup" project
  project-flow.spec.ts           main flow: create project → upload →
                               mark rows → assign materials → verify
  team-flow.spec.ts               Team screen: create member → change role
                               → reset password; + self-service
                               change-password from /account
  row-workspace.spec.ts           zoom-invariant drawing accuracy (checked
                               against the DB, not just rendered CSS),
                               multi-select + bulk quantities with an
                               exact-boundary check, duplicate-with-
                               materials, reload persistence
  helpers/                       env.ts, supabase-admin.ts (service-role
                               client), cleanup.ts (deletes test
                               projects/users)
  fixtures/test-drawing.svg      tiny fixture image for upload tests
  .auth/                         gitignored — contains a real session

docs/                          see below
```

**Why a folder literally named `app` lives inside the Next.js `app/`
router root**: `app/(protected)/app/page.tsx` is not a typo. The App Router's
special root folder is conventionally named `app`; nesting another folder
also named `app` inside it is valid and maps to the URL `/app`. See
`docs/DECISIONS.md`.

## Conventions

- **TypeScript strict mode** is on (`tsconfig.json`). No `any` unless
  justified with a comment explaining why. No unused exports/vars.
- **Feature-based folders** — group by area (`app/(protected)/scheduler/`,
  etc.), not by technical layer.
- **Conventional commits** — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
  with a short scope-free subject line. Small, logically grouped commits.
  Never leave the repo in a broken state (every commit should pass the
  quality gates below).
- **Handy Equip theme tokens** — the whole app is a single fixed dark theme
  (no light-mode toggle). Colors live as CSS variables in `app/globals.css`
  and are consumed through Tailwind's semantic classes (`bg-background`,
  `text-foreground`, `bg-primary`, `text-primary-foreground`, `border-border`,
  etc.) — never hardcode hex values in components.
  - Primary (Handy Equip yellow): `#f2c00e`, with dark text `#1a1a1a` on
    yellow buttons/surfaces.
  - Background: `#141414`. Panels/cards: `#1e1e1e`. Borders: `#3a3a3a`.
    Body text: `#f4f3ef`.
- **Supabase clients** — never construct a client at module scope. Browser
  client (`lib/supabase/client.ts`) is only called inside event
  handlers/effects; server client (`lib/supabase/server.ts`) is only called
  inside functions that run per-request (Server Components marked
  `force-dynamic`, Route Handlers, Server Actions, `proxy.ts`). This is what
  keeps `next build` green without real Supabase credentials present. See
  `docs/DECISIONS.md`.

## Working rules (non-negotiable, every session)

1. **Log everything.** At the end of every work session: update
   `docs/PROGRESS.md` (task statuses) and append a dated entry to
   `docs/BUILD-LOG.md` (what you did, why, decisions, problems, fixes).
   Record any architectural decision in `docs/DECISIONS.md`.
2. **Small, clean commits.** Conventional commits (`feat:`, `fix:`, `chore:`,
   `docs:`). Commit logically grouped changes with clear messages. Never
   leave the repo in a broken state.
3. **Verify before done.** Before calling a phase/task complete, run and pass
   `npm run lint`, `npm run typecheck`, and `npm run build`. Paste the
   results. Fix any failure before continuing.
4. **Types are strict.** TypeScript strict mode on. No `any` unless
   justified in a comment. No unused code.
5. **No secrets in git.** Secrets go in `.env.local` (gitignored). Keep
   `.env.local.example` current with placeholders.
6. **Do it yourself — never offload work you can do.** If a step can be run
   from the terminal, a script, or an API, DO IT. Do not ask Alter to run
   commands, edit files, or click through UIs on your behalf — run the shell
   command, write the script, call the API yourself. If PowerShell blocks a
   script, switch shells (`cmd`, `npx.cmd`, `node`) instead of handing it
   back to him. The bar for asking Alter to run something is: it is
   _literally impossible_ without him.
7. **Only humans-only steps go to Alter — and prefer a one-time token.** The
   only things you may ask Alter to do are ones you genuinely cannot: a
   secret/credential you can't generate, or an interactive third-party
   browser login you can't perform as him. Even then, prefer asking him once
   for an access token (e.g. a Vercel or Supabase personal token he pastes in)
   so all future runs are fully autonomous. When you must involve him, don't
   halt the whole run — keep doing everything that isn't blocked and collect
   the human-only items into one clear "NEEDS YOU" list with exact steps.
8. **Keep it simple and readable.** Prefer clear, conventional patterns over
   clever ones. Organize by feature.

## Start of session checklist

1. Read `docs/PROGRESS.md` (current status line + open tasks).
2. Read the latest (topmost) entry in `docs/BUILD-LOG.md`.
3. Skim `docs/DECISIONS.md` for anything relevant to the area you're
   touching.

## End of session checklist

1. Update `docs/PROGRESS.md` (check off completed tasks, update the status
   line).
2. Append a new dated entry to the top of `docs/BUILD-LOG.md`.
3. Add any new architectural decision to `docs/DECISIONS.md`.
4. Run the quality gates — `npm run lint`, `npm run typecheck`,
   `npm run build` — and fix anything that fails.
5. Commit with a conventional-commit message.
