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

Built in Phase 2. Migrations live in `supabase/migrations/`, applied in
this order:

1. `schema_core.sql` — tables, checks, FKs, indexes.
2. `auth_bootstrap.sql` — `handle_new_user` trigger.
3. `rls_policies.sql` — helper functions, RLS policies, grants.
4. `storage_buckets.sql` — `drawings` / `packing-slips` buckets + policies.
5. `views.sql` — `row_progress`, `project_progress`, `material_reconciliation`.

### Tables

Every table is scoped to an `organizations` row, directly (`org_id`) or
transitively via `project_id` → `projects.org_id` or `crew_id` →
`crews.org_id`.

| Table | Scoped via | Purpose |
| --- | --- | --- |
| `organizations` | — | Tenant boundary. One per Handy Equip-style deployment (see auth bootstrap below); multi-org support exists in the schema but isn't exercised yet. |
| `profiles` | `org_id` (nullable) | One row per `auth.users`, `role` ∈ `owner`/`pm`/`scheduler`/`crew`. |
| `projects` | `org_id` | A racking-install job. `status` ∈ `active`/`on_hold`/`complete`. |
| `crews` / `crew_members` | `org_id` / via `crews` | Install crews and their members (Phase 6/7). |
| `drawings` | `project_id` | One row per rendered page (`page_index` 0-based) of an uploaded layout PDF/image. `storage_path` points into the private `drawings` bucket. |
| `packing_slips` | `project_id` | Uploaded packing-slip files; `parsed` reserved for future OCR/extraction. |
| `materials` | `project_id` | The job's material catalog — `total_needed` (job total) and `received` (from packing slips) live here; per-row requirements live in `row_materials`. |
| `rows` | `project_id` (+ `drawing_id`) | A marked rack section on a drawing page. `x/y/w/h` are **normalized 0..1** fractions of the drawing's rendered size, so marks stay correct at any zoom/display size — matches the reference marking-tool prototype's coordinate model. |
| `row_materials` | via `rows` | Required qty of a material for a specific row. `unique(row_id, material_id)`. |
| `installs` | via `rows` | Append-only log of installed qty per row/material/date. `qty` may be negative (a correction entry) — never edit history in place. Written by the Phase 6 field app; empty until then. |
| `assignments` / `targets` / `crew_rates` | `project_id` / `crew_id` | Scheduling (Phase 7). Created now so FKs are clean from day one. |
| `share_tokens` | `project_id` | Customer portal tokens (Phase 8). Not publicly RLS-readable — see below. |

### Auth bootstrap

`handle_new_user()` (SECURITY DEFINER trigger on `auth.users` insert): the
**first** user ever created becomes `owner` of a freshly-created
organization. Every subsequent signup gets `role='crew'`, `org_id=null` —
there's no self-serve invite flow yet, so an owner/pm must manually move
them into the org (e.g. via the SQL editor) until a later phase builds
proper invites. After your first sign-in, rename the auto-created org:
`update organizations set name = 'Handy Equip';`.

### RLS & authorization

Every table has RLS enabled. Two SECURITY DEFINER helpers avoid recursive
policy evaluation: `current_org_id()` and `current_role()` (both read the
caller's own `profiles` row via `auth.uid()`). Role model:

- `owner` / `pm` / `scheduler` — full CRUD within their org. (Finer-grained
  differences between these three are deferred until a later phase's UI
  actually needs them.)
- `crew` — read access to their org's data, plus **INSERT on `installs`
  only**. Cannot create/edit/delete projects, materials, or rows.

`share_tokens` is deliberately **not** readable via any anon RLS policy —
the Phase 8 customer portal will read it through a server Route Handler
using `lib/supabase/admin.ts` (service role, bypasses RLS), never directly
from the browser.

Newer Supabase projects don't auto-grant new tables to the `anon`/
`authenticated` API roles (see `auto_expose_new_tables` in
`supabase/config.toml`), so the RLS migration also carries explicit
`grant select, insert, update, delete ... to authenticated` — RLS policies
are the real row-level gate; the grant just lets the role attempt the
operation at all. `anon` gets nothing on any of these tables.

### Views

`row_progress`, `project_progress`, and `material_reconciliation` are all
created `with (security_invoker = true)` — required on Postgres 15+ so the
view enforces RLS as the *querying* user, not the (elevated) migration
role that created it. Progress math caps installed qty at the required qty
per row/material (matching the reference prototype's `zonePct`/
`zoneComplete` logic), so logging more than required never shows over
100%.

### Storage

Two private buckets, `drawings` and `packing-slips`, path convention
`{project_id}/{filename}`. RLS policies on `storage.objects` derive the
owning project from the first path segment
(`(storage.foldername(name))[1]::uuid`) and check it against
`current_org_id()`. The app always reads via short-lived signed URLs
(`lib/supabase/server.ts` → `storage.from(bucket).createSignedUrl(...)`),
never public bucket URLs.

### Types

`lib/supabase/database.types.ts` is hand-written to match the migrations
exactly (no Docker/linked project available when Phase 2 was authored — see
`docs/DECISIONS.md`). All four client factories
(`lib/supabase/{client,server,admin,proxy}.ts`) are generic over
`Database`. Once the project is linked, regenerate for real with
`npx supabase gen types typescript --project-id <ref> > lib/supabase/database.types.ts`
and diff — it should be a near-exact match.

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
