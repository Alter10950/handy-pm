# Decisions

ADR-style log. Newest at top. Each entry: Decision, Context, Choice,
Consequences.

---

## ADR-018: Zoom/pan as a pure CSS transform; multi-select ordering; duplicate placement

**Decision date:** 2026-07-03

**Context:** Real feedback from the first live layout (Bingo Warehouse):
big warehouses need zoom/pan to draw precisely, and marking many
near-identical rows one at a time is too slow. The non-negotiable
constraint: row coordinates stay normalized 0..1 in the DB — zoom/pan
must be a view-only transform, never a change to what gets persisted.

**Choice — zoom/pan:** `transform: translate() scale()` on the stage
element, inside a fixed-size `overflow: hidden` viewport
(`components/projects/use-zoom-pan.ts`). The existing draw/move/resize
math (`(clientX - rect.left) / rect.width`) needed **zero changes**: it
already reads the stage's live `getBoundingClientRect()`, which the
browser reports post-transform, so the ratio is zoom/pan-invariant by
construction — a scaled element's reported width scales by the same
factor as the offset, canceling out. This was confirmed, not just
reasoned through: `e2e/row-workspace.spec.ts` draws a row at fit-zoom,
zooms in ~2.4x, drags over the exact same underlying content region
(computed from the stage's post-zoom bounding rect, not a fixed
viewport-relative size — an earlier draft of this test used a fixed
viewport-relative drag box at every zoom level, which _correctly_
produced different normalized sizes at different zoom and had to be
rewritten), and asserts the resulting geometries match within a small
tolerance.

React's `onWheel` and touch props are passive listeners by default, so
`event.preventDefault()` inside them silently no-ops (with a console
warning) — wheel-zoom and touch-pinch/pan are wired via native
`addEventListener(..., {passive: false})` in `useEffect`s instead, so
the browser's own scroll/pinch is actually suppressed.

**Choice — the `react-hooks/refs` lint rule:** `eslint-plugin-react-hooks`
(bundled with this Next.js/React version) flags `zoomPan.property` access
in JSX/render whenever `zoomPan` is a custom hook's return value that
_anywhere_ mixes in a ref — even for plain-value fields like `.zoom` or
`.fit` that have nothing to do with the ref. It doesn't appear to trace
data flow precisely enough to clear non-ref fields on an object that also
carries a ref. Fixed two ways: `useZoomPan` takes the viewport ref as a
parameter instead of creating and returning it, and every call site
destructures the hook's return into plain local variables
(`const { zoom, panX, ... } = useZoomPan(...)`) instead of holding onto
the object and writing `zoomPan.zoom` in JSX. A ref that must stay
current for a mount-once native-listener effect (the touch-pinch handler)
is updated inside a `useEffect` (no dependency array — runs after every
render), never assigned directly in the render body, which is a second,
independent violation of the same rule family ("cannot mutate a ref
during render").

**Choice — multi-select range ordering:** `listRowProgress` has no
`ORDER BY`, and Postgres doesn't guarantee row order without one —
shift-click "select rows 2-11" needs a well-defined range, not whatever
order the DB happens to return. Rows are sorted by `rowNumber()`
(extracted from the "Row N" label; `lib/rows/naming.ts`) purely for
computing the range, falling back to alphabetical for any custom-renamed
label that doesn't match the pattern.

**Choice — duplicate placement:** copies are offset by the source row's
own width (if narrower than tall) or height (otherwise) — matching
exactly how "vertical" vs. "horizontal" Auto Rows already arranges
adjacent rows (side-by-side vs. stacked), rather than inventing a
separate placement convention. Clamped into `[0, 1]` like every other
geometry write; a duplicate placed near an edge can end up overlapping
its source rather than getting fancier collision avoidance, matching this
codebase's existing "keep it simple, the row is still editable after"
posture (see ADR-013 on additive-not-destructive uploads for the same
philosophy).

**Choice — bulk quantities:** `upsertRowMaterialQtyBulk` takes the full
`rowIds x materialQtys` cross product in one `.upsert()` call (same
`onConflict: "row_id,material_id"` target as the existing single-cell
`upsertRowMaterialQty`), rather than looping N×M individual round trips
client- or server-side. Goes through the same RLS-scoped client as every
other row_materials write — multi-select needed no RLS changes.

**Consequences:** Zoom/pan required touching zero persistence code —
the entire feature is additive view state in `RowStage`. The
`react-hooks/refs` workaround (destructure-at-call-site) is now the
pattern to follow for any future hook that returns a ref alongside plain
values; documented here and in the hook's own docstring so it isn't
"fixed" back to a bundled-object return later. Duplicate's placement
heuristic reuses Auto Rows' mental model rather than adding a new one,
at the cost of only working well for roughly-rectangular strip-shaped
rows — an unusual row shape could produce a less sensible offset
direction, acceptable since the result is a normal, fully-editable row
either way.

---

## ADR-017: Email magic-link auth replaced with email + password, no public sign-up

**Decision date:** 2026-07-03

**Context:** Supabase's built-in magic-link email delivery proved too slow
and unreliable to develop/test against comfortably (this is what motivated
ADR-015's admin-generated `token_hash` E2E workaround in the first place).
Password sign-in removes the email dependency entirely for every sign-in,
not just the test suite's.

**Choice:**

- `/login` now collects email + password and calls
  `supabase.auth.signInWithPassword` directly from the browser client — no
  redirect link, so `app/auth/callback/route.ts` (pure magic-link/OTP
  verification code) was deleted rather than left disabled; nothing else
  in the app used it (confirmed by grepping the whole repo before removal).
  This also deletes the Supabase dashboard "Redirect URLs" setup step for
  both localhost and production — password sign-in has no callback to
  register.
- No sign-up form exists anywhere in the app. Every account is created
  from a new **Team** page (`/app/team`, owner/pm only) via
  `lib/team/actions.ts`'s `createTeamMember`, which uses the service-role
  admin client (`admin.auth.admin.createUser`) since there's no other way
  to create a `auth.users` row without a client-facing sign-up endpoint.
  The `handle_new_user` "first user becomes owner" trigger (ADR at
  Phase 2) is untouched — it still fires on any `auth.users` insert,
  admin-API-created or not — so a brand-new project's first account still
  needs creating directly in the Supabase dashboard (or via
  `scripts/seed.mjs`), then everyone after that goes through Team.
- Team also supports changing an existing member's role and resetting
  their password (`updateTeamMemberRole`, `resetTeamMemberPassword`) —
  both natural siblings of "assign a role during creation" using the same
  underlying primitives, not separately-scoped features. Every mutation
  re-derives the caller's own role from the DB before doing anything
  (never trusts the client); the two admin-client paths (create, reset
  password) additionally verify the _target_ profile's org_id by hand,
  since bypassing RLS means the org boundary that normally protects
  `profiles` rows has to be re-checked explicitly instead of inherited for
  free — `updateTeamMemberRole` doesn't need this because it goes through
  the caller's own RLS-scoped session, where `profiles_update`'s policy
  already enforces it.
- Self-service password change lives at `/account` (any signed-in role),
  calling `supabase.auth.updateUser({password})` on the current session —
  deliberately not part of Team, since changing your _own_ password needs
  no admin privileges and no org-membership check at all.
- `e2e/auth.setup.ts` was rewritten to sign in through the real `/login`
  form instead of ADR-015's admin-generated `token_hash` bypass — password
  auth doesn't need a backdoor, so the E2E setup now also exercises the
  real sign-in UI rather than routing around it.
- `scripts/seed.mjs` was extended to set (and reset, every run) a known
  password for the seed user, so the suite never depends on a password
  that might have drifted from a prior run or a manual edit.

**Consequences:** Signing in no longer depends on email delivery at all,
for real users or tests. The "first user becomes owner" bootstrap path is
now reachable only from the Supabase dashboard/a script, not the UI —
documented in `README.md` so a fresh project's setup steps stay accurate.
Team's "reset password" capability means a forgotten password never needs
a code-level fix or a support script — an owner/pm handles it from the UI,
using the exact code path already required for the one-off "set my own
password" bootstrap this decision also needed. Optional follow-up, not
done here: disabling "Enable email signups" in the Supabase dashboard as
defense-in-depth against someone calling `auth.signUp` directly against
the API (the app itself never exposes that path, so this is redundant
hardening, not a functional gap).

---

## ADR-016: `NEXT_PUBLIC_*` env vars must be read via static `process.env.X`, never `process.env[name]`, in browser code

**Decision date:** 2026-07-02

**Context:** `lib/supabase/client.ts` (the _only_ browser-side Supabase
client factory) read its URL/anon key through
`requireSupabaseEnv(name: SupabaseEnvVar)`, which does
`process.env[name]` — bracket/computed property access. Next.js inlines
`NEXT_PUBLIC_*` vars into the client bundle by statically rewriting
literal `process.env.NEXT_PUBLIC_X` expressions at build time; it cannot
follow a variable into a bracket-indexed lookup, so the rewrite silently
never happened for this call site. At runtime in the browser,
`process.env` is empty, so `process.env[name]` resolved to `undefined`
and the (correctly-written) validation threw "Missing required
environment variable" — even with `.env.local` fully populated and the
dev server confirming "- Environments: .env.local" at boot.

This had been **live and broken since Phase 1** (`login-form.tsx`'s
`signInWithOtp` call) and silently affected every client-side Supabase
call added since (`drawing-upload.tsx`, `packing-slip-upload.tsx`). It
went undetected through five sub-phases of self-review and manual
smoke-testing because none of that testing ever completed a real
magic-link sign-in or exercised an upload button in an actual browser —
exactly the gap the E2E suite (ADR-015) was built to close, and exactly
what it caught, on its first real run, within a session of being written.

**Choice:** Split `lib/supabase/env.ts` in two: `requireSupabaseEnv(name)`
(server-only, unchanged — bracket access is harmless server-side, where
`process.env` is the real runtime environment, not a build-time inlining
target) and a new `requireBrowserSupabaseEnv(value, name)` that just
validates a value already read via a **static** `process.env.NEXT_PUBLIC_X`
reference at the call site. `lib/supabase/client.ts` now reads both vars
that way.

**Consequences:** Real magic-link sign-in and both upload flows work
correctly for the first time. Any _future_ browser-side env var read must
follow the same static-reference pattern — documented in both files'
docstrings so the next person (or session) reaching for
`requireSupabaseEnv` in client code sees why not to.

---

## ADR-015: Playwright E2E against the live Supabase project, auth via admin-generated `token_hash`

**Decision date:** 2026-07-02

**Context:** Phases 3–5 shipped self-reviewed but never actually clicked
through in a browser — verifying that required a real sign-in, and the
app only supports email magic-link auth. Waiting on a human to click a
real emailed link every time this needs checking doesn't scale, and
isn't something to automate by receiving real email.

**Choice:** `scripts/seed.mjs` idempotently ensures an org ("Handy
Equip") and a confirmed, passwordless test user
(`qa+owner@handyequip.test` — `.test` is IANA-reserved, can never collide
with a real domain) exist, service-role, run via
`node --env-file=.env.local` (no new runtime dependency for that
script). `e2e/auth.setup.ts` (a Playwright "setup" project, per
Playwright's standard auth-reuse pattern) calls
`supabase.auth.admin.generateLink({type: 'magiclink', ...})` to get a
one-time `token_hash` **without sending any email**, then drives a real
browser to `/auth/callback?token_hash=...&type=magiclink` — the app's
_real_ callback route, extended (not a test-only bypass route) to accept
`token_hash`+`type` alongside the PKCE `code` it already handled, since
Supabase documents both as legitimate verification shapes for the same
endpoint. Real cookies get set through the real code path; the resulting
`storageState` is saved and reused by the actual test file, so sign-in
happens once per run, not once per test.

The suite runs against `next dev` on the **real Supabase project** (via
`.env.local`), not a mock — the entire point is catching integration bugs
a mock would hide (see ADR-016, found on the very first real run). Test
data is namespaced (`[E2E] Project flow ${Date.now()}`) and torn down in
`test.afterAll` via a service-role `deleteProjectCompletely` helper that
also removes Storage objects (which have no FK/cascade relationship to
the DB rows that reference them) — verified empty (`select id from
projects`) after every run, including failed ones, before trusting this.

**Consequences:** `npm run test:e2e` (`npm run seed && playwright test`)
is fully self-contained and safe to re-run: idempotent seed, namespaced
and cleaned-up test data, no dependency on email delivery or manual
click-through. The `/auth/callback` extension is permanent, real app
surface, not scaffolding to strip out later. Playwright reuses the
project's already-running `next dev` on port 3001 rather than spawning
its own instance on a different port — Next.js allows only one dev
server per project directory (`.next/dev` lock), so fighting that with a
second port would just fail; `E2E_PORT` overrides if 3001 is unavailable.

---

## ADR-014: `router.refresh()` after every direct Server Action call from a Client Component

**Decision date:** 2026-07-02

**Context:** `revalidatePath` inside a Server Action is documented to
refresh the calling route automatically for both `<form action>` and plain
direct invocation from client code — but this couldn't be verified live
(no applied migration to click through against yet at the time this code
was written; see the Phase 2 NEEDS ME item). `RowStage`'s drag interactions
in particular can't tolerate a silent staleness bug: a moved/resized row
that doesn't visually confirm its saved position is a real usability
problem, not just a cosmetic one.

**Choice:** Every client component that calls a Server Action directly
(not via `<form action>`) also calls `router.refresh()` in its success
path — `MaterialsTable`, `RowMarkingWorkspace`'s `runAction`,
`PasteMaterialsDialog`. Redundant if Next's automatic revalidation already
covers it; cheap insurance if it doesn't.

**Consequences:** A possible extra refresh per action — not worth
optimizing away speculatively. Revisit once the migration is live and this
can actually be watched in a browser; if the automatic behavior is
confirmed reliable, these calls could be trimmed, but there's no harm in
leaving them.

---

## ADR-013: Drawing uploads are additive, never destructive, in Phase 2/3

**Decision date:** 2026-07-02

**Context:** The reference prototype has a "Replace drawing" menu action.
Rows are FK'd to a specific `drawing_id` with `on delete cascade` — deleting
a drawing to replace it would silently destroy any rows already marked on
that page.

**Choice:** `DrawingUpload` only ever adds new pages (`page_index`
continuing from the current count), labeled "Upload layout" when a project
has no drawings yet and "Add more pages" once it does. No delete/replace
flow was built this batch.

**Consequences:** Uploading the wrong file can't be undone from the UI yet
(only via the Supabase dashboard). A proper "replace this page" flow that
warns about/handles orphaned rows is real scope for a later phase, not a
gap to quietly paper over.

---

## ADR-012: Server Actions for relational CRUD, direct browser Supabase calls for file uploads

**Decision date:** 2026-07-02

**Context:** Sub-phase 3 needed both simple structured mutations (create
project, edit a material) and file-upload flows that require browser-only
APIs (`pdfjs-dist`, `<canvas>`) to render a PDF before it can be uploaded.

**Choice:** Structured mutations without files (`lib/projects/actions.ts`)
are Next.js Server Actions — `revalidatePath` keeps Server Component data
fresh automatically. File-upload flows (`DrawingUpload`,
`PackingSlipUpload`) call the _browser_ Supabase client
(`lib/supabase/client.ts`) directly from a Client Component to upload to
Storage — rendering has to happen client-side anyway, and Storage RLS
policies already enforce who can write where, so proxying the upload bytes
through a Server Action would add a hop with no security benefit. Each
upload flow finishes by calling a small Server Action
(`recordDrawingUpload`/`recordPackingSlipUpload`) purely to insert the
resulting row and revalidate — never to move file bytes.

**Consequences:** Two mutation patterns coexist in the same feature folder.
Documented here and in `CLAUDE.md` so a future session doesn't "fix" the
inconsistency by forcing file uploads through a Server Action (which would
hit Next.js's server body size limits on larger drawings) or by moving
simple CRUD to client-side calls (losing automatic revalidation).

---

## ADR-011: `installs.qty` allows negative values; `rows.drawing_id` is required

**Decision date:** 2026-07-02

**Context:** The reference marking-tool prototype
(`Layout-Marker-OVERLAY.html`) lets a crew member's "installed today"
stepper go negative to correct a prior over-count, storing that delta as
its own log entry rather than editing history in place. Separately, the
spec's raw column list for `rows` didn't explicitly mark `drawing_id`
`not null`.

**Choice:** `installs.qty check (qty <> 0)` instead of `qty > 0`, so
correction entries are valid, append-only log rows. `rows.drawing_id` was
made `not null` — a marked rack section without a drawing page to sit on
isn't a valid state in this tool's model.

**Consequences:** `row_progress`/`material_reconciliation`'s installed-qty
sums naturally net out corrections without any special-casing. Any future
row-creation code path must always supply a `drawing_id`.

---

## ADR-010: Hand-written `database.types.ts`, regenerate once linked

**Decision date:** 2026-07-02

**Context:** `supabase gen types typescript` needs either a linked project
(personal access token) or a local Postgres (`supabase start`, needs
Docker). Neither was available when Phase 2 was authored, but the app
needed typed Supabase clients (`SupabaseClient<Database>`) to satisfy the
strict-TypeScript working rule.

**Choice:** Hand-wrote `lib/supabase/database.types.ts` to exactly match
`supabase/migrations/*.sql`, in the same shape the CLI generates
(`Database.public.Tables/Views/Functions`), and wired it into all four
client factories via the generic parameter.

**Consequences:** Zero `any` in Supabase query results, but the file can
drift from the real schema if a future migration lands without a matching
type update. Once the project is linked, regenerate for real and diff
against this file — documented in `CLAUDE.md` and `docs/ARCHITECTURE.md`.

---

## ADR-009: Views use `security_invoker = true`

**Decision date:** 2026-07-02

**Context:** `row_progress`, `project_progress`, and `material_reconciliation`
aggregate across `rows`/`row_materials`/`installs`/`materials`/`projects` —
all RLS-protected. Postgres views default to evaluating permissions as the
view's _owner_ (the migration role, which is elevated) unless
`security_invoker = true` is set (Postgres 15+). Without it, these views
would silently leak cross-org data to every caller regardless of their own
RLS policies — the exact opposite of what they're for.

**Choice:** All three views are created `with (security_invoker = true)`.

**Consequences:** RLS on the underlying tables is enforced per-caller
through the view, same as querying the tables directly. This must carry
forward to any future view — it's not the Postgres default, so it's easy
to forget.

---

## ADR-008: RLS role model — owner/pm/scheduler full CRUD, crew read + install-log only

**Decision date:** 2026-07-02

**Context:** The spec explicitly required: "role 'crew' may SELECT org data
and INSERT installs, but not UPDATE materials or DELETE projects/rows,"
without detailing owner/pm/scheduler differences.

**Choice:** `owner`, `pm`, and `scheduler` are treated as equivalent for
RLS purposes this phase — full CRUD within their org on every table except
`organizations` itself (read-only, no client writes at all). `crew` gets
SELECT everywhere plus INSERT on `installs` only; every other write policy
excludes `crew` explicitly. Two SECURITY DEFINER helper functions,
`current_org_id()` and `current_user_role()`, back every policy so org/role
scoping is centralized in one place instead of repeated inline per table.

**Consequences:** Simple, uniform policies now; no scheduler-specific
restrictions exist yet. When Phase 7 (Scheduler) or a future admin UI gives
these roles concretely different capabilities, the policies will need to
split apart — tracked as follow-up, not done speculatively now.

**Update (2026-07-02):** the role helper was originally named
`current_role()`, which collides with `CURRENT_ROLE` — a reserved
PostgreSQL keyword/session-info function, not an ordinary identifier.
Renamed to `current_user_role()` across `rls_policies.sql`,
`storage_buckets.sql`, and `database.types.ts` before this was ever applied
to a live database, so no migration-of-a-migration was needed.

---

## ADR-007: Middleware guards `/app`, `/scheduler`, and `/field`

**Decision date:** 2026-07-02

**Context:** The Phase 1 brief explicitly required protecting `/app` and
`/scheduler`, and explicitly required leaving `/portal/[token]` public. It
was silent on `/field`. `/field` is the crew phone PWA, described in the
project summary as needing its own sign-in eventually.

**Choice:** `/field` lives inside the same `app/(protected)/` route group as
`/app` and `/scheduler`, so it inherits the shared layout's auth redirect.
`proxy.ts`'s `PROTECTED_PREFIXES` list was updated to include `/field` too,
so the fast middleware-level redirect and the layout-level backstop agree.

**Consequences:** `/field` requires sign-in starting Phase 1, ahead of the
literal spec text. This is a superset of what was asked, not a narrower
interpretation, and is reversible by moving the `field/` folder out of the
route group if a future phase wants crew members to use a separate,
lighter-weight auth flow (e.g. a PIN instead of email magic link).

---

## ADR-006: Supabase clients are constructed lazily, never at module scope

**Decision date:** 2026-07-02

**Context:** `npm run build` must pass with no real Supabase project
configured (Phase 1 ships before the user creates one). `@supabase/ssr` and
`@supabase/supabase-js` both validate the URL synchronously in their client
constructor and throw if it's missing/empty. Next.js statically prerenders
any route that doesn't use a dynamic API (`cookies()`, `headers()`, etc.),
which means constructing a Supabase client at module load time — or in the
render body of a page Next decides to prerender — can crash the build
itself when env vars aren't set.

**Choice:**

- `lib/supabase/env.ts` reads env vars lazily (inside a function, not at
  module scope), so importing it never throws.
- `lib/supabase/client.ts` (browser) is only ever called from inside event
  handlers (e.g. the login form's submit handler), never from a component's
  render body — so it only executes in the browser, post-hydration.
- `lib/supabase/server.ts` (server) always calls `cookies()` first, which
  forces the calling route segment to render dynamically. Routes that need
  it are additionally marked `export const dynamic = "force-dynamic"` as a
  second, explicit guarantee that Next skips build-time static generation
  for them entirely.

**Consequences:** `npm run build` is green with zero environment
configuration. The tradeoff is a small amount of boilerplate (`force-dynamic`
exports, factory functions instead of shared client instances) and a rule
that must be followed by hand in future code: **never `const supabase =
createClient()` at module scope.**

---

## ADR-005: Route folder literally named `app` inside the App Router

**Decision date:** 2026-07-02

**Context:** The product's office/PM area is specified as living at the URL
`/app`. Next.js's App Router requires the router root itself to be a folder
named `app` (or `src/app`).

**Choice:** Nest another folder named `app` inside the router root:
`app/(protected)/app/page.tsx` → URL `/app`. This is valid Next.js routing —
the router-root convention and a route segment name are independent
namespaces — but it reads oddly at a glance.

**Consequences:** Documented explicitly in `CLAUDE.md` and here so a future
session doesn't "fix" it by renaming/deleting the nested `app/` folder.

---

## ADR-004: Single fixed dark theme, no light-mode toggle

**Decision date:** 2026-07-02

**Context:** Handy Equip's brand is charcoal + yellow. The brief specifies
exact hex values for background, panels, borders, and text with no mention
of a light mode.

**Choice:** `app/globals.css` sets the Handy Equip palette directly on
`:root` (not gated behind `prefers-color-scheme` or a `.dark` class toggle).
The `.dark` class block is kept, with identical values, purely so any
shadcn/ui component that ships `dark:` Tailwind variants still renders
correctly if a `class="dark"` is ever applied — but nothing in the app
applies that class today.

**Consequences:** No light-mode work needed. If a future phase wants a real
light/dark toggle, the `.dark` block already exists as a starting point and
would need to diverge from `:root` at that point.

---

## ADR-003: shadcn/ui on the `base-nova` preset (Base UI, not Radix)

**Decision date:** 2026-07-02

**Context:** `npx shadcn@latest init -d` (defaults flag) resolved to the
`base-nova` preset, which is built on `@base-ui/react` (Radix's successor
library, maintained by the same team) rather than the older Radix-based
`new-york`/`default` styles most existing shadcn tutorials use.

**Choice:** Kept the CLI's own default rather than forcing `-b radix` for
familiarity. It's what the shadcn CLI itself recommends as of this build,
and Base UI is the forward-looking successor to Radix.

**Consequences:** Generated primitives (e.g. `components/ui/button.tsx`)
import from `@base-ui/react/*`, not `@radix-ui/react-*`. Copy-pasting
snippets from older shadcn/Radix-era tutorials into this repo will need
adaptation.

---

## ADR-002: Hand-rolled service worker instead of Serwist/next-pwa

**Decision date:** 2026-07-02

**Context:** Phase 1 needs the app installable and running standalone on a
phone. Both Serwist and next-pwa are common choices, but their compatibility
with a same-day Next.js 16 + React 19 + Turbopack stack was unverified, and
the brief explicitly allows "a maintained approach such as Serwist/next-pwa
or a hand-rolled SW."

**Choice:** Hand-rolled `public/sw.js` (network-first fetch strategy with a
cached app-shell fallback) registered from a small client component. PWA
icons (192/512/512-maskable) and the favicon/apple-touch-icon are generated
at build time via Next's `next/og` `ImageResponse` special-file conventions
(`app/icon.tsx`, `app/apple-icon.tsx`, `app/icons/*/route.tsx`) instead of
checked-in binary assets, so there are no placeholder PNGs to eventually
swap out.

**Consequences:** No extra dependency / version-compatibility risk. The
service worker is intentionally minimal (no precache manifest, no
stale-while-revalidate); revisit with Serwist if offline requirements grow
in a later phase.

---

## ADR-001: Next.js on Vercel + Supabase

**Decision date:** 2026-07-02

**Context:** Handy PM needs auth, a Postgres database (project/schedule
data arrives in Phase 2), and a deployment target that supports a React
Server Components app, a PWA, and a public token-gated portal route, without
standing up custom infrastructure.

**Choice:** Next.js App Router, deployed to Vercel. Supabase for Postgres +
Auth (email magic link), accessed via `@supabase/ssr` for cookie-based
session handling across Server Components, Route Handlers, and middleware.

**Consequences:** Vercel and Supabase both have generous free/hobby tiers
appropriate for an internal tool at this stage, and the App
Router + `@supabase/ssr` combination is Supabase's officially documented
integration path, which keeps future-session onboarding low-friction. RLS
(Row Level Security) will be the primary authorization mechanism once the
schema exists in Phase 2.
