# Decisions

ADR-style log. Newest at top. Each entry: Decision, Context, Choice,
Consequences.

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
`current_org_id()` and `current_role()`, back every policy so org/role
scoping is centralized in one place instead of repeated inline per table.

**Consequences:** Simple, uniform policies now; no scheduler-specific
restrictions exist yet. When Phase 7 (Scheduler) or a future admin UI gives
these roles concretely different capabilities, the policies will need to
split apart — tracked as follow-up, not done speculatively now.

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
