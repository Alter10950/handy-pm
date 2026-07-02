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

Deployment target: **Vercel**. Backend: **Supabase** (Postgres + Auth; DB
schema arrives in Phase 2).

## Commands

```bash
npm run dev           # start the dev server (Turbopack)
npm run build         # production build
npm run start         # run the production build locally
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
npm run format        # prettier --write .
npm run format:check  # prettier --check .
```

**Database migrations**: not applicable yet — there is no schema until
Phase 2. Once Supabase tables exist, migrations will run through the
Supabase CLI (`supabase migration new`, `supabase db push`); this section
will be updated when that lands.

## Folder structure map

```
app/
  layout.tsx                 root layout: fonts, metadata, viewport, SW registration
  page.tsx                   "/" — redirects to /app or /login based on auth
  globals.css                Tailwind v4 + Handy Equip theme tokens
  manifest.ts                PWA manifest (special file → /manifest.webmanifest)
  icon.tsx / apple-icon.tsx  generated favicon / apple touch icon (next/og)
  icons/icon-*/route.tsx     generated 192/512/512-maskable PWA icons (next/og)
  login/page.tsx             magic-link sign-in page (public)
  auth/callback/route.ts     exchanges the magic-link code for a session
  portal/[token]/page.tsx    public customer portal placeholder
  (protected)/               route group — shared authed shell
    layout.tsx                fetches the user, redirects to /login if absent,
                               renders SiteHeader + children (force-dynamic)
    app/page.tsx               "/app" — Projects placeholder
    scheduler/page.tsx         "/scheduler" placeholder
    field/page.tsx             "/field" placeholder

components/
  ui/                        shadcn/ui primitives (generated, don't hand-edit)
  site-header.tsx            authed nav + sign-out
  login-form.tsx             magic-link form (client component)
  placeholder-panel.tsx       shared placeholder page shell
  service-worker-register.tsx registers public/sw.js on mount

lib/
  supabase/
    env.ts                    lazy required-env-var reader
    client.ts                 browser Supabase client factory
    server.ts                 server Supabase client factory (Server
                               Components / Route Handlers / Server Actions)
    admin.ts                  service-role client — server-only, unused until
                               a later phase needs to bypass RLS
    proxy.ts                  session refresh + protected-route redirect
                               logic, called from proxy.ts
  auth/actions.ts             signOut server action
  utils.ts                    cn() class merge helper (shadcn)

proxy.ts                      Next.js 16 "proxy" (formerly middleware) —
                               guards /app, /scheduler, /field

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
6. **Ask if blocked.** If a required decision or credential is missing, stop
   and ask rather than guessing.
7. **Keep it simple and readable.** Prefer clear, conventional patterns over
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
