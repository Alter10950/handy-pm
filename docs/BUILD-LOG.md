# Build log

Engineering journal. Newest entries at top.

---

## 2026-07-03 — Local dev port note, Vercel env vars wired, production 500 fixed

**What:** Two loose ends from the previous session: document the
alternate dev port, and get the production deployment past the
`Internal Server Error` it was throwing (missing Supabase env vars on
Vercel — the server client throws on boot when they're absent).

**Local dev:** `npm run dev` binds port 3000 by default; when that's
already taken (it was, by the E2E suite's `webServer`), README now notes
the fix: `npm run dev -- -p 3001`.

**Vercel:** ran `vercel link` (user-authenticated, confirmed correct
project: `handy-pm`, org `seder-s-projects`) — repo-level linking, so
only `.vercel/repo.json` exists (no `.vercel/project.json`, which is
expected for current Vercel CLI versions, not a misconfiguration. Then
added all three Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) to
Production, Preview, and Development via `vercel env add`, piping each
value directly from `.env.local` through a shell pipeline so the secret
never appeared in any command string or visible output. Triggered
`vercel --prod`; build succeeded and aliased to
`https://handy-pm.vercel.app`. Confirmed via `curl`: `/` now returns
`307` → `/login` returns `200` (previously `500`).

**Not done (needs a human with dashboard access):** Supabase Auth **Site
URL** and **Redirect URLs** still need the production domain added —
there's no Supabase Management API token available in this environment,
so this can't be done from the terminal. Exact steps are in the chat
report; nothing else is blocked on it since `localhost:3001` was already
added in the previous session for E2E/manual testing.

**Also cleaned up:** `.gitignore` had picked up a redundant trailing
`.vercel` / `.env*` pair (Vercel CLI appends these during `vercel link`,
not knowing they're already covered by existing entries higher up) —
removed the duplicate, no behavior change.

## 2026-07-02 — Automated Batch 1 verification: E2E suite, found + fixed a real bug

**What:** Built what Phases 3–5 were missing — automated proof they
actually work in a browser, not just self-review + `next build`. Full
reasoning in ADR-015 and ADR-016; summary here.

**Seed script:** `scripts/seed.mjs`, idempotent, service-role, plain Node
(`node --env-file=.env.local`, no new runtime dependency). Ensures org
"Handy Equip" and a confirmed test user (`qa+owner@handyequip.test`)
exist and are correctly wired (`profiles.org_id`/`role='owner'`)
regardless of what the auth-bootstrap trigger initially assigned. Ran it
for real: first run created both (org id `42baa3d2-...`, user id
`0a175d8c-...`); second run confirmed idempotent (`created: false` on
both). This supersedes the "run this SQL after your first sign-in" note
from the Phase 2 report — **replaced now** the org already exists.

**Auth without email:** extended `/auth/callback` (the real route, not a
test-only one) to accept `token_hash`+`type` alongside the `code` it
already handled — both are Supabase-documented verification shapes for
the same callback. `e2e/auth.setup.ts` uses
`supabase.auth.admin.generateLink` to get a `token_hash` with no email
sent, drives a real browser through the real callback, and saves
`storageState` for the rest of the suite to reuse.

**E2E suite:** `e2e/project-flow.spec.ts` — create project → upload
`e2e/fixtures/test-drawing.svg` → auto-create 3 rows via the same
drag-a-box interaction a real user would use → paste a material list →
assign quantities across the grid → assert exact Assigned/Left/To-order
numbers in both the grid and the reconciliation card → verify the
Progress tab. `test.afterAll` deletes the test project (DB rows cascade;
Storage objects don't, so `e2e/helpers/cleanup.ts` removes those
explicitly too) via a service-role client, independent of the browser
session. Verified zero orphaned test rows in `projects` after every run,
including the failed ones during debugging.

**Found a real bug on the first run:** drawing upload failed in the
browser with "Missing required environment variable:
NEXT_PUBLIC_SUPABASE_URL" — even though the dev server's own boot log
confirmed it loaded `.env.local`. Root cause: `lib/supabase/client.ts`
(the browser Supabase client — used by the login form and both upload
components) read its config through a generic `requireSupabaseEnv(name)`
helper doing `process.env[name]` (bracket/computed access). Next.js
inlines `NEXT_PUBLIC_*` vars into the browser bundle by statically
rewriting literal `process.env.NEXT_PUBLIC_X` expressions at build
time — it cannot follow a variable into a bracket lookup, so the
rewrite silently never fired for this call site, and `process.env` is
empty in an actual browser. **This bug has been live since Phase 1** and
affected every client-side Supabase call added since; it survived five
sub-phases of self-review and a passing `next build` because neither
exercises a real browser's compiled bundle. Fixed by splitting
`lib/supabase/env.ts`: `requireSupabaseEnv` stays as-is for server code
(bracket access is harmless there — no build-time inlining involved,
`process.env` is the real runtime environment), and a new
`requireBrowserSupabaseEnv(value, name)` validates a value already read
via a static `process.env.NEXT_PUBLIC_X` reference at the call site.
`lib/supabase/client.ts` updated accordingly. Full detail in ADR-016 —
this is exactly the class of bug the whole exercise was meant to catch,
and it did, on the very first real run.

**Test-authoring bugs along the way** (not app bugs — fixed in the test
itself): `getByRole('button', {name: /Next/})` also matched Next.js's own
"Open Next.js Dev Tools" button in dev mode — narrowed to the exact
label. `table tbody tr` matched both the materials grid's table _and_
the Reconciliation card's table (2 rows each, so "expected 2 got 4") —
scoped to `.locator("table").first()`. The auto-rows dialog's ~100ms
close-transition overlay was still intercepting the drag that was
supposed to land on the stage underneath it — added an explicit wait for
the dialog text to fully disappear before dragging.

**Environment quirk:** Next.js allows only one `next dev` per project
directory (`.next/dev` lock) — Playwright's `webServer` trying to start
its own instance on a different port failed with "Another next dev
server is already running." Pointed Playwright at the same port (3001)
a manually-started dev server already uses instead of fighting that;
`reuseExistingServer` then just uses what's already up. `E2E_PORT`
overrides if 3001 is taken by something unrelated.

**Quality gates:** `npm run lint`, `npm run typecheck`, `npm run build`
all pass. `npm run test:e2e` passes twice in a row cleanly. `npm run
format` applied.

---

## 2026-07-02 — Phase 5: materials × rows grid, reconciliation

**What:** Built the last sub-phase of this batch. Extracted
`RowFillMarker` (the fill-bar + label + hazard-icon visual) out of
`RowStage` so `MaterialsReferenceStage` — a read-only version of the
marking stage, rows as buttons instead of drag targets — renders rows
identically by construction. `MaterialsGrid` is the spreadsheet: sticky
corner/header/first-column via `position: sticky` on individual cells
(not `<thead>`) with `border-separate` (`border-collapse` breaks sticky
cells in most browsers) and an explicit background on every sticky cell.
Needed/Received and each row's required qty are editable inputs;
Assigned/Left/To-order are read straight off the `material_reconciliation`
view rather than re-derived client-side — one place for that math to
live, matching the pattern already established for `project_progress` on
the Overview tab. `ReconciliationCard` reuses the same view for its
Installed/Assigned/Needed/Received/To-order table, flagging
`assigned !== needed` and `to_order > 0` per spec. Tapping a row on the
reference drawing highlights its grid column and focuses its first cell
via a `Map<rowId, HTMLElement>` ref registry — no DOM queries.
`MaterialsTable` (Phase 3's simpler table) is a strict subset of what the
grid does, so it's deleted, not kept alongside as a redundant second
editing surface — same call as deleting `DrawingViewer` in Phase 4.

**Scope note:** the grid intentionally has no "Unit" column. Neither the
spec's column list for this sub-phase nor the reference prototype's own
grid (`<th class="l stick">Part</th><th>Needed</th><th>Recv</th>
<th>Assigned</th><th>Left</th><th>To order</th>`) includes one — `unit`
stays a plain field on `materials` with no dedicated edit UI yet.

**Still not clicked through live:** same reason as Phases 3–4 — no real
sign-in has happened yet, and creating a disposable test account in the
user's production Supabase project isn't something to do unilaterally
(the permission classifier agreed, twice, earlier this session). Self-
review this time included working through the sticky-positioning CSS
requirements by hand (`border-separate`, per-cell backgrounds, cell-level
not `<thead>`-level `sticky`) since a table with broken sticky headers is
the kind of bug that's obvious the second a real browser renders it but
invisible to `tsc`/`eslint`/`next build`.

**Quality gates:** `npm run lint`, `npm run typecheck`, `npm run build`
all pass. `npm run format` applied.

---

## 2026-07-02 — Migration discovered live; Phase 4: drawing marking

**The Phase 2 migration is live.** While starting Phase 4, a routine file
re-read turned up that `supabase/migrations/20260702183323_rls_policies.sql`
and `20260702183327_storage_buckets.sql` had changed on disk since the last
commit — every `current_role()` call site renamed to `current_user_role()`,
plus a new untracked `APPLY_ALL_MIGRATIONS.sql` (all 5 migrations
concatenated, with the same rename applied, clearly meant for pasting into
the Supabase SQL editor). Read `APPLY_ALL_MIGRATIONS.sql` to understand
what happened rather than asking: `current_role` collides with
`CURRENT_ROLE`, a reserved PostgreSQL keyword/session-info function —
defining a same-named function in `public` is a real, findable error the
moment someone actually tries to run it. That's exactly what happened here.

Rather than assume, verified directly with the credentials already in
`.env.local`: hit the PostgREST endpoint for `organizations` and nine other
tables/views with the anon key (200 + `[]` — RLS blocking anon, but the
relations exist) and the Storage API with the service-role key (both
`drawings` and `packing-slips` buckets present, both private). **The
migration is fully and correctly applied.** Fixed the three remaining
`current_role` references that weren't caught by whatever ran
`APPLY_ALL_MIGRATIONS.sql` (`lib/supabase/database.types.ts`'s `Functions`
entry, and two docs mentions) so the rename is consistent everywhere.

Wanted to smoke-test the authenticated flows for real (create a project,
upload a drawing, mark rows) rather than trust self-review alone, but two
attempts to set that up were correctly stopped by the permission
classifier: listing all `auth.users` (PII, not asked for) and creating a
disposable test account via the admin API (a persistent write to the
user's real production project, not asked for either) — right calls both
times, this wasn't mine to decide unilaterally. Also worth noting: no
`organizations` row exists yet, meaning nobody has signed in for real —
the auth-bootstrap trigger makes the _first_ signup the owner, so creating
a throwaway test account first would have quietly stolen that slot from
the user's real first sign-in. Asked directly instead of guessing; the
user is doing that first real sign-in themselves. Continuing to build and
self-review without a live click-through in the meantime.

**Phase 4 — drawing marking:** Built `RowMarkingWorkspace`
(`components/projects/row-marking-workspace.tsx`) orchestrating three
pieces: `RowStage` (the pointer-interactive canvas — drag-to-draw, drag-
to-move, drag-a-handle-to-resize, tap-to-rename, all via pointer capture so
drags keep tracking outside the element bounds), `AutoRowsDialog`
(count + orientation, matching the reference prototype's `applyGrid` split
math exactly), and `RowEditSheet` (rename/delete only — required-material
assignment stays on the Materials tab, coming in Phase 5, keeping row
geometry and row×material data cleanly separated). Auto-naming
(`lib/rows/naming.ts`) scans every row label in the _whole project_, not
just the active page, so "Row N" numbering continues correctly across
pages. This superseded sub-phase 3's placeholder `DrawingViewer` component
entirely — deleted it rather than leaving dead code once nothing imported
it anymore.

**Bug caught in self-review:** the fill bar's orientation (does progress
fill bottom-to-top or left-to-right?) was first written comparing
_normalized_ `w`/`h` directly (`geometry.h >= geometry.w`). That's only
correct when the stage happens to be square — on a real non-square
drawing, a row that's visually wider than tall in rendered pixels could
still have `h >= w` in normalized terms if the page itself is much taller
than wide, flipping the fill the wrong way. Fixed by tracking the stage's
actual rendered pixel size via `ResizeObserver` and comparing
`geometry.h * stageHeightPx >= geometry.w * stageWidthPx` instead. Would
not have been caught by `tsc`/`eslint`/`next build` — only by actually
reasoning through the math, which is exactly why "self-review: reread the
diff" is its own step and not assumed covered by the quality gates.

**Consistency fix:** noticed mid-review that `MaterialsTable` (built in
Phase 3) never called `router.refresh()` after its Server Action calls,
while `PasteMaterialsDialog` (built the same session) did — an
inconsistency, not a deliberate choice. Standardized on always calling it
after a direct (non-form) Server Action invocation, given the automatic-
revalidation behavior couldn't be verified live yet either. See ADR-014.

**Quality gates:** `npm run lint`, `npm run typecheck`, `npm run build` all
pass. `npm run format` applied.

---

## 2026-07-02 — Phase 3: projects, drawing/packing-slip uploads, materials

**What:** Built the Projects area end to end: `/app` list (cards from the
`project_progress` view) + New Project dialog; `/app/project/[id]` with a
4-tab shell (Overview / Layout / Materials / Progress); drawing upload
(PDF.js renders each page to a capped/downscaled JPEG client-side, uploads
to the `drawings` bucket, inserts one `drawings` row per page) with a page
switcher; packing-slip upload; a paste-material-list parser and dialog; an
inline-edit materials table (add/edit/delete). Data-access layer split into
`lib/projects/queries.ts` (reads) and `lib/projects/actions.ts` (Server
Action mutations) — full reasoning for the Server Action vs. direct-
browser-upload split in ADR-012, and for uploads being additive-only (no
destructive replace flow) in ADR-013.

**GitHub connected mid-session:** the user shared the GitHub repo URL
(`github.com/Alter10950/handy-pm`) partway through Phase 2's SQL work.
Added it as `origin` and stopped there — the auto-mode safety classifier
correctly held back the actual `push` since a bare URL isn't an explicit
"push" instruction. Confirmed with the user (they'd also shared the Vercel
project URL, which was the signal worth double-checking) before pushing;
they said yes. First push attempt timed out — Git Credential Manager was
very likely waiting on an interactive sign-in window on the user's own
screen (this environment runs directly on their Windows machine, so a GCM
popup is real and completable by them, not a dead end). Retried in the
background and it went through cleanly the second time.

**Reused Phase 1 patterns:** the "no client at module scope, browser client
only inside handlers" rule from ADR-006 carried straight over to file
uploads. Added `app/(protected)/error.tsx` (themed error boundary) so a
thrown Server Action error (e.g. "your account isn't assigned to an
organization yet" from a second signup trying to create a project) renders
something readable instead of Next's default error page — covers every
Server Action in the protected tree, not just this one.

**Design tokens extended:** added `--success` (#22c55e), `--warning`
(#f59e0b), and `--stage` (#0b1119) to `app/globals.css` — all three lifted
directly from the reference prototype's CSS variables (`--done`, `--warn`,
and `#stageWrap`'s background), needed now for project status badges and
reused again for the drawing/row-marking surfaces in sub-phases 4-5.

**Still blocked (see Phase 2's NEEDS ME):** none of this has run against
real data — the migration isn't applied yet. `npm run lint`,
`npm run typecheck`, and `npm run build` all pass, and the code was
carefully self-reviewed (revalidatePath coverage double-checked so the
Overview tab's materials count and the projects list's % stay fresh after
every mutation), but "create a project → upload a PDF → see pages → upload
a packing slip → paste a material list → edit it" hasn't been clicked
through for real yet. Will smoke-test the moment the migration is live.

**Quality gates:** `npm run lint`, `npm run typecheck`, `npm run build` all
pass. `npm run format` applied.

---

## 2026-07-02 — Phase 2: DB schema, RLS, storage, types

**What:** Authored the full Phase 2 data model as five ordered SQL
migrations under `supabase/migrations/`: `schema_core` (14 tables + indexes),
`auth_bootstrap` (first-user-becomes-owner trigger), `rls_policies` (helper
functions + policies + grants), `storage_buckets` (drawings/packing-slips
buckets + policies), `views` (row_progress/project_progress/
material_reconciliation). Hand-wrote `lib/supabase/database.types.ts` to
match and wired the `Database` generic into all four Supabase client
factories. Full reasoning for the RLS role model, `security_invoker` on
views, and the hand-written-types call is in `docs/DECISIONS.md`
(ADR-008 through ADR-011).

**Environment constraints:** No Docker in this sandbox, so `supabase start`
(local Postgres) and `supabase gen types --local` aren't available —
migrations were authored and self-reviewed without a live DB to run them
against. `psql`/`pg_dump` aren't installed either, so there was no way to
even syntax-check the SQL locally short of very careful manual review.

**Reference prototype found and read:** Located
`Layout-Marker-OVERLAY.html` in `Claude/Projects/Marking a Layout daily/`
(user-provided path). The file is truncated on disk — cuts off mid-statement
partway through `renderProgress()`, after the fully-intact Layout
(marking/zone drag-resize) and Materials (grid/reconciliation-input)
sections, before ever reaching its own Progress/Log views. That's enough:
its CSS theme tokens match the Phase 1 Handy Equip palette almost exactly
(confirms the existing theme is on target), and its zone data model
(`{x,y,w,h,required:{matId:qty},installed:{matId:qty}}`, normalized 0..1
coords, `zonePct`/`zoneComplete` capping installed at required, sequential
"Row N" auto-naming, drag/move/resize via `pointerdown`/`pointermove`/
`pointerup`) maps directly onto the `rows`/`row_materials`/`installs`
tables and the `row_progress` view's math. Didn't ask the user to re-paste
the missing tail — sub-phase 5's reconciliation-card spec is more specific
than whatever the prototype's own Progress/Log tabs would have shown, so
building sub-phases 4-5 from the intact sections plus the explicit written
spec is enough; noted here rather than stalling.

**Mid-session credential exchange:** The user provided the Supabase project
URL, then the anon key, then the service role key, each in a separate
message while migration-writing was in progress. Wrote `.env.local`
(gitignored) as each arrived rather than batching, since there's no reason
to make the user wait. `npm run build` stayed green throughout with real
`.env.local` values present.

**NEEDS ME:** the migration is authored, self-reviewed, and committed, but
**not yet applied** to the live project (`ntdynurigavrpvexwiij`). Tried
`supabase link --project-ref ntdynurigavrpvexwiij` — fails with
`LegacyPlatformAuthRequiredError` (needs a Supabase personal access token).
`supabase db push`/`link -p` also accept a direct DB password as an
alternative to linking. Neither was available in the environment. Two ways
to unblock, either one works:

- Supabase personal access token (supabase.com/dashboard/account/tokens),
  or
- the project's database password (Supabase dashboard → Settings →
  Database).

Once either is available: `npx supabase link --project-ref
ntdynurigavrpvexwiij` then `npx supabase db push`. Fallback if that's still
not workable: paste each file in `supabase/migrations/` into the Supabase
SQL editor, in filename order — they're idempotent (`if not exists` /
`create or replace` throughout), so re-running is safe.

**Problems fixed:**

- `rows.drawing_id` — spec's raw column list didn't mark it `not null`;
  made it required since a marked row without a drawing page isn't valid.
- `installs.qty` — initially constrained `> 0`; relaxed to `<> 0` after
  checking the reference prototype, which allows negative "installed today"
  deltas as correction entries rather than editing history in place.

**Quality gates:** `npm run lint`, `npm run typecheck`, `npm run build` all
pass with `.env.local` present (Next.js picks it up automatically; routes
touching Supabase are `force-dynamic` so this was already exercised in
Phase 1).

---

## 2026-07-02 — Phase 1: foundation, auth, theme, PWA

**What:** Stood up the whole Phase 1 foundation in one session: docs system,
Next.js scaffold, Supabase auth, Handy Equip theme, app shell, PWA, README.

**Scaffold:** `create-next-app` refuses project names with capitals/spaces
(the working directory is `Handy PM`), so it was scaffolded into a temp
`handy-pm-tmp` subfolder and moved up into the repo root, with `package.json`
`name` fixed to `handy-pm` afterward. Removed the auto-generated
`CLAUDE.md`/`AGENTS.md` scaffold files (replaced with the real ones), the
default `/next.svg` etc. placeholder assets, and the default homepage.

**Theme:** `npx shadcn@latest init -d` resolved to the `base-nova` preset
(Base UI, not Radix) — kept it rather than forcing the older Radix-based
style; see ADR-003. Replaced the generated neutral/oklch light+dark token
pairs in `app/globals.css` with the Handy Equip palette as a single fixed
dark theme (ADR-004). Fixed a bug in the generated `globals.css`/
`layout.tsx` pair where `--font-sans` was self-referential (the Geist font
variable was named `--font-geist-sans` but the theme expected `--font-sans`)
by renaming the font variable.

**Auth:** Wired `@supabase/supabase-js` + `@supabase/ssr` with three client
factories (`lib/supabase/{client,server,admin}.ts`) plus a lazy env-var
reader. The tricky part was making `npm run build` pass with **no** Supabase
project configured yet — `@supabase/ssr`'s client constructor throws
synchronously on a missing/empty URL, and Next.js will execute a page's
render function during its build-time static-generation attempt unless the
route is forced dynamic. Solved by (a) never constructing a Supabase client
at module scope, (b) only calling the browser client from inside event
handlers, and (c) marking every server-side consumer `force-dynamic`. See
ADR-006 for the full reasoning. Verified by smoke-testing the dev server
with placeholder (syntactically valid, non-functional) env values: `/`
redirects unauthenticated requests to `/login` (307), `/app` and
`/scheduler` redirect with a `?next=` param, `/login` and `/portal/[token]`
render 200 without needing any Supabase call. Full magic-link delivery
wasn't tested — that needs a real Supabase project, which doesn't exist yet.

**Routing:** Built `/app`, `/scheduler`, `/field` inside an
`app/(protected)/` route group sharing one layout that checks auth and
renders the header/nav; `/portal/[token]` and `/login` sit outside it,
public. Discovered along the way that putting `/field` in the same route
group as `/app`/`/scheduler` means the shared layout guards it too, even
though the brief only explicitly required guarding `/app` and `/scheduler` —
decided to keep that behavior (crew accounts should need sign-in) and made
`proxy.ts`'s explicit prefix list match it for consistency. See ADR-007.

**Next.js 16 surprise:** the `middleware.ts` file convention is deprecated
in Next 16 in favor of `proxy.ts` (exported function renamed `proxy`). The
first build surfaced this as a deprecation warning; renamed the file (and
the internal `lib/supabase/middleware.ts` helper, for naming consistency)
before it became a real problem.

**PWA:** Icons (favicon, apple-touch-icon, 192/512/512-maskable) are
generated at build time via `next/og`'s `ImageResponse` special-file
conventions rather than checked-in binary placeholders — a yellow square
with a dark "HP" wordmark. Initially set `runtime = "edge"` on the icon
route handlers (copied from an old habit); build warned that edge runtime
disables static generation, and since these routes have no per-request
variance, removed the edge runtime and added `export const dynamic =
"force-static"` instead so they're prerendered once, not regenerated per
request. Service worker is hand-rolled (network-first, cached app-shell
fallback) rather than Serwist/next-pwa, to avoid unverified compatibility
risk with a same-day Next 16/React 19/Turbopack stack — see ADR-002.

**Problems fixed:**

- `create-next-app` naming restriction (see Scaffold above).
- `shadcn init -b neutral` isn't a valid `--base` value — that flag selects
  the component library (`radix`/`base`), not the color; used `-d` instead.
- `.gitignore`'s default `.env*` pattern would have also ignored
  `.env.local.example`; added a `!.env.local.example` negation.
- `next build` initially warned about the deprecated `middleware` convention
  and about edge runtime disabling static generation — both fixed as
  described above.

**Quality gates:** `npm run lint`, `npm run typecheck`, and `npm run build`
all pass clean (see the final commit for output). `npm run format` applied
project-wide.

**Left for the user:** create a Supabase project, fill in
`.env.local` from `.env.local.example`, add the same three env vars to
Vercel, and confirm the Phase 2 roadmap draft in `docs/PROGRESS.md` before
that phase starts.
