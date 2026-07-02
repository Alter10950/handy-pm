# Architecture

## Areas & routes

| Route                         | Access    | Purpose                                                                                                                                                                                                                |
| ----------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                           | redirect  | Sends signed-in users to `/app`, everyone else to `/login`.                                                                                                                                                            |
| `/login`                      | public    | Email magic-link sign-in (Handy PM branded).                                                                                                                                                                           |
| `/auth/callback`              | public    | Route Handler — exchanges the magic-link `code` for a session, redirects to `?next=` (default `/app`).                                                                                                                 |
| `/app`                        | protected | Projects list (from `project_progress`) + New project dialog.                                                                                                                                                          |
| `/app/project/[id]`           | protected | Overview tab — meta, quick stats, drawing thumbnail.                                                                                                                                                                   |
| `/app/project/[id]/mark`      | protected | "Layout" tab — drawing upload/viewer + row marking workspace (auto/draw/edit tools). Named `mark`, not `layout`, to avoid colliding with the Next.js `layout.tsx` file convention in the same folder — see `docs/DECISIONS.md`. |
| `/app/project/[id]/materials` | protected | Materials tab — packing-slip/paste-list upload, reference drawing overlay, materials × rows grid, reconciliation card.                                                                                                 |
| `/app/project/[id]/progress`  | protected | Project-level progress rollup (row counts, hazards, overall %). Per-material reconciliation lives on the Materials tab instead.                                                                                        |
| `/scheduler`                  | protected | Crew/install scheduling. Placeholder until Phase 7.                                                                                                                                                                    |
| `/field`                      | protected | Crew phone app (installable PWA). Placeholder until Phase 6.                                                                                                                                                           |
| `/portal/[token]`             | public    | Customer-facing read-only project status, gated by an unguessable share token. Placeholder until Phase 8.                                                                                                              |

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

## Projects feature (Phase 3)

`lib/projects/` is the data-access layer for everything under
`/app/project/[id]`:

- `queries.ts` — read-only functions (Server Components only; uses the
  cookie-based server client, relies entirely on RLS for org scoping —
  nothing here filters by `org_id` manually).
- `actions.ts` — Server Actions for structured mutations (create project,
  material CRUD/paste, recording a completed upload). See ADR-012 for why
  file uploads themselves don't go through here.
- `parse-material-list.ts` — pure function parsing `"name, qty"` lines
  (commas/tabs/spaces all work) into `{name, qty}`, used by the
  paste-from-packing-slip flow. Kept separate from `actions.ts` so it has
  no server-only dependencies and is trivially unit-testable.

Drawing/packing-slip uploads (`components/projects/{drawing,packing-slip}-upload.tsx`)
run client-side: `lib/pdf/render-drawing-file.ts` uses `pdfjs-dist` to
render each PDF page (capped at 15 pages) or a plain image onto a
`<canvas>`, downscales to a max 2000px dimension, and exports a JPEG
`Blob`. The component uploads each blob directly to Supabase Storage via
the browser client, then calls a Server Action once just to insert the
`drawings`/`packing_slips` row and revalidate. See ADR-012 and ADR-013.

## Drawing marking (Phase 4)

`/app/project/[id]/mark` renders `RowMarkingWorkspace`
(`components/projects/row-marking-workspace.tsx`), which owns tool
selection (`grid` / `draw` / `edit`), the active page, and orchestrates
three pieces:

- `RowStage` (`row-stage.tsx`) — the actual pointer-interactive canvas.
  Pointer capture on `pointerdown` (so drags keep tracking even if the
  cursor leaves the element) drives three drag modes: `draw` (drag a new
  box — used by both "Draw one" and, once "Auto rows" is armed with a
  count/orientation, "Auto rows"), `move`, and `resize` (via a corner
  handle, edit tool only). Geometry updates render from local "draft"
  state during a drag and only call back to the parent (to persist) on
  `pointerup` — never on every `pointermove`, or every frame would hit the
  database. A `pointerup` with no net movement is treated as a tap, which
  opens the rename/delete sheet instead of persisting a move.
  Row fill orientation (does the progress bar fill bottom-to-top or
  left-to-right?) is decided by comparing **rendered pixel** dimensions
  (`geometry.h * stageHeightPx >= geometry.w * stageWidthPx`, tracked via
  `ResizeObserver`), not the raw normalized `w`/`h` — those are only
  directly comparable when the stage happens to be square. Caught in
  self-review; see `docs/BUILD-LOG.md`.
- `AutoRowsDialog` — count + orientation ("vertical, side-by-side,
  left→right" splits width into N columns; "horizontal, stacked,
  top→bottom" splits height into N rows), matching the reference
  prototype's `applyGrid` math exactly. Confirming arms grid mode; after
  one box is dragged and the batch is created, the tool auto-returns to
  `edit` rather than staying armed for a second (dialog-less) batch.
- `RowEditSheet` — rename or delete the tapped row. Deliberately does
  **not** touch required-material quantities — that's the Materials tab's
  job (`row_materials`), coming in Phase 5. Keeps the two concerns (row
  geometry vs. row×material data) cleanly separated.

Auto-naming (`lib/rows/naming.ts`, pure functions) scans **every** row
label in the project — not just the active page's — for the highest
`Row N`, so numbering continues correctly across pages. Mutations
(`lib/rows/actions.ts`: `createRow`, `createRowsBatch`, `updateRowGeometry`,
`renameRow`, `deleteRow`) are Server Actions, consistent with ADR-012.

`RowFillMarker` (`components/projects/row-fill-marker.tsx`) — the fill
bar + label + hazard-icon visual — is shared between `RowStage` (editable)
and `MaterialsReferenceStage` (read-only, Phase 5) so a row renders
identically in both places by construction, not by convention.

## Materials × rows grid (Phase 5)

`/app/project/[id]/materials` renders `MaterialsWorkspace`
(`components/projects/materials-workspace.tsx`), which owns the active
page and which row is "highlighted" (tapped on the reference drawing),
and composes:

- `MaterialsReferenceStage` — a read-only version of the marking stage:
  same `RowFillMarker` visuals, but each row is a `<button>` that reports
  a click up to the parent instead of supporting drag/resize.
- `MaterialsGrid` (`materials-grid.tsx`) — the spreadsheet. `position:
sticky` on individual `<th>`/first-`<td>` cells (not on `<thead>` —
  that doesn't reliably stick in tables) with `border-separate` on the
  `<table>` (`border-collapse` breaks `position: sticky` on cells in most
  browsers) and an explicit background on every sticky cell (otherwise
  scrolled-under content shows through). The corner cell is sticky on
  _both_ axes (`top-0 left-0`) at the highest z-index so it stays above
  both the sticky header row and the sticky first column as you scroll
  either direction. Needed/Received and the per-row-material required
  qty are editable inputs (Server Action on blur, same uncontrolled-
  input-keyed-by-value pattern as `MaterialsTable` used); Assigned/Left/
  To-order are read directly off `material_reconciliation` — computed
  server-side, not re-derived client-side, so there's exactly one place
  that math lives. Highlighting a row (tapped on the reference stage)
  scrolls its header into view and focuses its first cell via a
  `Map<rowId, HTMLElement>` ref registry, not DOM queries.
- `ReconciliationCard` (`reconciliation-card.tsx`) — per-material
  Installed/Assigned/Needed/Received/To-order straight from
  `material_reconciliation`, plus overall % from `project_progress`.
  Flags `assigned !== needed` (amber) and `to_order > 0` (red), per spec.

`MaterialsTable` (Phase 3's simpler inline-edit table) is gone — the grid
is a strict superset of what it did, so it was deleted rather than kept
as a second, now-redundant editing surface. The grid intentionally has no
"Unit" column — neither the spec's column list nor the reference
prototype's own grid includes one; unit stays a plain field on `materials`
with no dedicated edit UI yet.

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

| Table                                    | Scoped via                    | Purpose                                                                                                                                                                                                                                |
| ---------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organizations`                          | —                             | Tenant boundary. One per Handy Equip-style deployment (see auth bootstrap below); multi-org support exists in the schema but isn't exercised yet.                                                                                      |
| `profiles`                               | `org_id` (nullable)           | One row per `auth.users`, `role` ∈ `owner`/`pm`/`scheduler`/`crew`.                                                                                                                                                                    |
| `projects`                               | `org_id`                      | A racking-install job. `status` ∈ `active`/`on_hold`/`complete`.                                                                                                                                                                       |
| `crews` / `crew_members`                 | `org_id` / via `crews`        | Install crews and their members (Phase 6/7).                                                                                                                                                                                           |
| `drawings`                               | `project_id`                  | One row per rendered page (`page_index` 0-based) of an uploaded layout PDF/image. `storage_path` points into the private `drawings` bucket.                                                                                            |
| `packing_slips`                          | `project_id`                  | Uploaded packing-slip files; `parsed` reserved for future OCR/extraction.                                                                                                                                                              |
| `materials`                              | `project_id`                  | The job's material catalog — `total_needed` (job total) and `received` (from packing slips) live here; per-row requirements live in `row_materials`.                                                                                   |
| `rows`                                   | `project_id` (+ `drawing_id`) | A marked rack section on a drawing page. `x/y/w/h` are **normalized 0..1** fractions of the drawing's rendered size, so marks stay correct at any zoom/display size — matches the reference marking-tool prototype's coordinate model. |
| `row_materials`                          | via `rows`                    | Required qty of a material for a specific row. `unique(row_id, material_id)`.                                                                                                                                                          |
| `installs`                               | via `rows`                    | Append-only log of installed qty per row/material/date. `qty` may be negative (a correction entry) — never edit history in place. Written by the Phase 6 field app; empty until then.                                                  |
| `assignments` / `targets` / `crew_rates` | `project_id` / `crew_id`      | Scheduling (Phase 7). Created now so FKs are clean from day one.                                                                                                                                                                       |
| `share_tokens`                           | `project_id`                  | Customer portal tokens (Phase 8). Not publicly RLS-readable — see below.                                                                                                                                                               |

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
policy evaluation: `current_org_id()` and `current_user_role()` (both read
the caller's own `profiles` row via `auth.uid()`; the role helper is NOT
named `current_role()` — that collides with a reserved Postgres keyword,
see ADR-008 update below). Role model:

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
view enforces RLS as the _querying_ user, not the (elevated) migration
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
