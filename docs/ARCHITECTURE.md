# Architecture

## Areas & routes

| Route             | Access    | Purpose                                                                                                                                  |
| ----------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/`               | redirect  | Sends signed-in users to `/app`, everyone else to `/login`.                                                                              |
| `/login`          | public    | Email magic-link sign-in (Handy PM branded).                                                                                             |
| `/auth/callback`  | public    | Route Handler — exchanges the magic-link `code` for a session, redirects to `?next=` (default `/app`).                                   |
| `/app`            | protected | Office/PM area — Projects. Placeholder in Phase 1.                                                                                       |
| `/scheduler`      | protected | Crew/install scheduling. Placeholder in Phase 1.                                                                                         |
| `/field`          | protected | Crew phone app (installable PWA). Placeholder in Phase 1.                                                                                |
| `/portal/[token]` | public    | Customer-facing read-only project status, gated by an unguessable share token (token validation arrives with the data model in Phase 2). |

Protected routes live under the `app/(protected)/` route group, which shares
one layout (`app/(protected)/layout.tsx`) that fetches the current user,
redirects to `/login` if absent, and renders `SiteHeader` (nav + signed-in
user + sign-out) around the page content. `proxy.ts` (Next.js's middleware
convention, renamed in Next 16) additionally redirects unauthenticated
requests to `/app`, `/scheduler`, and `/field` before any rendering happens —
see `docs/DECISIONS.md` ADR-006 and ADR-007 for why both layers exist and
why `/field` is included.

## Auth flow

1. User enters their email on `/login`.
2. Browser calls `supabase.auth.signInWithOtp(...)`, which sends a magic
   link pointing at `/auth/callback?code=...&next=...`.
3. `/auth/callback` exchanges the code for a session (sets Supabase's auth
   cookies via `@supabase/ssr`) and redirects to `next` (default `/app`).
4. `proxy.ts` runs on every request, refreshing the session cookie and
   redirecting unauthenticated requests away from protected routes.
5. Sign-out is a Server Action (`lib/auth/actions.ts`) invoked from a form in
   `SiteHeader`.

## Data model

**Not built yet.** No Supabase tables exist as of Phase 1 — this section
will be filled in during Phase 2 once the project/schedule/customer schema
is designed. Expected shape based on the product summary (subject to change
once Phase 2 design happens):

- `projects` — a racking-install job (customer, site address, status,
  dates).
- `schedule_entries` — crew/install calendar entries linked to a project.
- `portal_tokens` — unguessable share tokens mapping to a project, powering
  `/portal/[token]` without requiring customer accounts.
- Crew/office user profiles, likely backed by Supabase Auth's `auth.users`
  plus a `profiles` table for app-specific fields (role, name, phone).

Row Level Security (RLS) will be the primary authorization mechanism once
these tables exist — the `SUPABASE_SERVICE_ROLE_KEY` client
(`lib/supabase/admin.ts`) is reserved for trusted backend operations that
need to bypass RLS (e.g. generating portal tokens), and is unused until then.

## PWA

- `app/manifest.ts` generates `/manifest.webmanifest` (name, standalone
  display, `#141414` theme/background color, 192/512/512-maskable icons).
- Icons and the favicon/apple-touch-icon are generated at build time via
  `next/og`'s `ImageResponse` (`app/icon.tsx`, `app/apple-icon.tsx`,
  `app/icons/*/route.tsx`) — a yellow square with a dark "HP" wordmark.
  Marked `force-static` since their output never varies per request.
- `public/sw.js` is a minimal hand-rolled service worker (network-first,
  falls back to a cached app shell) registered client-side by
  `components/service-worker-register.tsx`. See ADR-002.
