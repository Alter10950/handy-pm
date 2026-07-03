# Handy PM

Project management software for **Handy Equip**, a warehouse racking-install
company. Four areas:

- `/app` — office/PM area (projects)
- `/field` — installable crew phone app (PWA)
- `/scheduler` — crew/install scheduling
- `/portal/[token]` — public, read-only customer project status page

This is Phase 1: foundation, auth, theme, and the PWA shell. No business
data model yet (Phase 2). See [`CLAUDE.md`](./CLAUDE.md) for the full
engineering operating manual and [`docs/PROGRESS.md`](./docs/PROGRESS.md)
for current status.

## Prerequisites

- Node.js 20+ and npm
- A [Supabase](https://supabase.com) project (free tier is fine)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Supabase project at [supabase.com](https://supabase.com), then
   copy `.env.local.example` to `.env.local` and fill in the values from
   your project's **Settings → API** page:

   ```bash
   cp .env.local.example .env.local
   ```

   | Variable                        | Where to find it                  | Exposed to browser?  |
   | ------------------------------- | --------------------------------- | -------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`      | Settings → API → Project URL      | Yes                  |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API → anon/public key  | Yes                  |
   | `SUPABASE_SERVICE_ROLE_KEY`     | Settings → API → service_role key | **No — server only** |

3. In Supabase, enable **email magic link** sign-in (Authentication →
   Providers → Email — enabled by default on a new project) and add your
   local dev URL to **Authentication → URL Configuration → Redirect URLs**:

   ```
   http://localhost:3000/auth/callback
   ```

## Run

```bash
npm run dev            # start the dev server at http://localhost:3000
npm run build           # production build
npm run start            # run the production build locally
```

If port 3000 is already in use by something else, pass an alternate port:

```bash
npm run dev -- -p 3001
```

## Quality gates

```bash
npm run lint             # eslint
npm run typecheck        # tsc --noEmit
npm run format            # prettier --write .
npm run format:check       # prettier --check .
```

## Deploying to Vercel

1. Import the repo into [Vercel](https://vercel.com/new).
2. Add the same three environment variables from `.env.local` (Project
   Settings → Environment Variables): `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
3. In Supabase, add your production domain's callback URL to
   **Authentication → URL Configuration → Redirect URLs**:

   ```
   https://your-vercel-domain.vercel.app/auth/callback
   ```

4. Deploy. No build configuration overrides are needed — Vercel
   auto-detects Next.js.

## Tech stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript (strict) ·
Tailwind CSS v4 · shadcn/ui (`base-nova`, Base UI) · Supabase (Postgres +
Auth) · deployed on Vercel.

See [`CLAUDE.md`](./CLAUDE.md) for exact versions, folder structure, and
working conventions.
