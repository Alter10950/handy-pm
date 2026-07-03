# Decisions

ADR-style log. Newest at top. Each entry: Decision, Context, Choice,
Consequences.

---

## ADR-021: Field (crew) app — append-only install log, localStorage offline queue, no crew-login link yet

**Decision date:** 2026-07-03

**Context:** Sub-phase B of Batch 2: a mobile-first `/field` area for crews to
pick a project, log material installs against rows, report blockers with a
photo, and confirm/close their day. The schema for this
(`installs.idempotency_key`/`device_id`, `blockers`, `day_logs`,
`daily-photos`) was already laid down in sub-phase 0 (ADR-019); this is
building the actual UI/actions against it.

**Choice — the offline queue covers install deltas only, not every
mutation:** logging a material install is the one field action repeated
dozens of times a shift, and the one the schema already carries
`idempotency_key`/`device_id` for specifically to make replaying it safe.
`lib/field/offline-queue.ts` persists pending deltas to `localStorage`
(not IndexedDB — a queue of small JSON objects has no need for an async,
versioned store) and drains them in FIFO order on mount and on the
browser's `online` event, stopping at the first failure so a still-offline
queue isn't hammered entry by entry. Blockers and day-log edits are
low-frequency (a handful of times a day) — a plain "the button shows an
error, tap it again" is enough there, and building a second, generic
"replay any action" queue (closures can't be serialized to localStorage
anyway, so it'd need its own {actionName, args} dispatch table) wasn't
worth it for actions this infrequent. `logInstallDelta`
(`lib/field/actions.ts`) treats a unique-violation on `idempotency_key` as
success, not an error — the queue's retry-after-a-dropped-connection case
needs that to be idempotent in truth, not just in intent. `pendingCount`
is read via `useSyncExternalStore` against the queue's own pub-sub, not
mirrored into component state — this also sidesteps
`react-hooks/set-state-in-effect`, a newer lint rule that flags exactly
the "read a browser-only value after mount" pattern this needs (see
`useCrewSelection` below for the same fix applied a second time).

**Choice — crew_id is a per-device localStorage preference, not tied to
login:** `profiles` has no `crew_id` column, and there's no crew-management
UI yet (`crews`/`crew_members` exist in the schema since Batch 1's
foundational migration, but Sub-phase C — Scheduler — is what actually
builds CRUD for them). Rather than block Field on that, `useCrewSelection`
remembers "which crew this device is logging as" in `localStorage`,
independent of the signed-in user — matching how a shared job-site phone
or tablet is actually used (one device, whichever crew has it that day),
not a personal login. Every crew-scoped write (`installs.crew_id`,
`blockers.crew_id`, `day_logs.crew_id`) is nullable and works with no crew
selected too. Implemented with `useSyncExternalStore`, same reasoning as
the offline queue above — reading `localStorage` in a `useState`+`useEffect`
pair is exactly the extra-render pattern that lint rule exists to catch.

**Choice — day_logs upsert is hand-rolled, not a Postgres `ON CONFLICT`:**
`day_logs` has `unique (project_id, crew_id, work_date)`, but Postgres
treats every `NULL` in a unique column as distinct from every other
`NULL` — so with no crew picked, `ON CONFLICT` would never match an
existing "no crew" row for that project/day, and every "mark arrived"
tap would insert a new row instead of updating one. `upsertDayLog`
explicitly selects for an existing match (crew-nullable-aware) first, then
updates or inserts accordingly.

**Choice — photos attach to blockers, not a general daily-photo log:**
the `daily-photos` bucket exists, but the only schema column referencing
it is `blockers.photo_path` — there's no separate "photos of a row today"
table. Rather than add one speculatively, `BlockerForm` is where photo
capture lives (evidence for a reported issue), matching what the schema
actually supports.

**Consequences:** `e2e/helpers/cleanup.ts`'s `deleteProjectCompletely`
gained a recursive Storage listing helper — `daily-photos` nests
`{project_id}/{date}/{crew_id}/{filename}`, unlike the flat
`{project_id}/{filename}` drawings/packing-slips use, and Storage's
`list()` isn't recursive (a "folder" is just an entry with `id: null`).
The standard app header (Projects/Scheduler/Field/Team nav) still renders
on `/field/*` — reasonable for now (consistent with every other route),
but a crew member on a phone doesn't need those links; a
Field-specific compact header is a reasonable later polish, not done here
to avoid changing the shared protected-layout unprompted.

## ADR-020: Direct-manipulation layout canvas (no separate tools) + command-pattern undo/redo

**Decision date:** 2026-07-03

**Context:** Two requests arrived back to back, mid-batch: add undo/redo to
the Layout tab, then — before that landed — rework the whole tool model
(separate Draw/Edit/Select buttons) into one direct-manipulation canvas
(click to select, drag a selected row to move it, 8 resize handles, plain
drag on empty space to draw). The second absorbs the first (undo/redo
needs to cover every mutation the new model can produce), so they're one
combined change, landing before Batch 2's sub-phase B resumes.

**Choice — command objects, not a type-dispatched reducer:** `useUndoStack`
(`components/projects/use-undo-stack.ts`) holds two plain arrays of
`{label, undo, redo}` entries. Each call site (move, resize, nudge,
rename, delete, duplicate, auto-rows batch, bulk material/phase
assignment) builds its own closure over the exact before/after data it
already has, rather than a central `switch (entry.type)` that would need
to know every mutation's shape. Since rows persist to the DB immediately,
`undo`/`redo` are `async` and re-issue the actual inverse Server Action
call(s) — a client-only visual rollback would drift from the database the
moment a second person (or tab) looks at the project. The hook's
`push`/`undo`/`redo` are deliberately plain functions reading `past`/
`future` state directly from the render closure, not wrapped in
`useCallback` with side-effecting state updaters — an early draft used
`setPast(prev => { entryToUndo = prev.at(-1); return prev.slice(0, -1) })`,
assigning an outer variable from inside a state updater, which is unsafe
under React's potential double-invocation of updater functions. Caught in
self-review before it ever ran.

**Choice — Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y attach to `window`, not a div's
`onKeyDown`:** the first implementation attached the handler as
`onKeyDown` on the workspace's root div, reasoning that "keydown bubbles
from whatever's focused, up to this root" was enough scoping. It isn't:
clicking Delete in the command panel clears the selection as part of
handling that same click, which unmounts the command panel (and the
now-gone Delete button, which had focus from the click). Browsers move
focus to `<body>` when the focused element is removed from the document —
outside the div's subtree entirely — so the very next Ctrl+Z silently
never reached the handler. Found via `e2e/row-workspace.spec.ts`'s
delete-then-undo step timing out waiting for a POST that never fired, not
by inspection. Fixed by attaching the listener to `window` in a
`useEffect` (cleaned up on unmount), mirroring the existing Space-to-pan
listener in `row-stage.tsx` — scoped to "this component is mounted"
rather than to live DOM focus, which is what the feature actually needs
(`isTypingTarget` still guards against firing while typing in a field).

**Choice — resize handles get their own clipping wrapper, separate from
the row's box:** the 8 handles are centered *on* the row's border by
design (a corner handle's center is the row's actual corner), extending a
few pixels past the row's own edges in every direction. They render as
children of the row's box, which has `overflow-hidden` + `rounded` so the
fill-bar/label don't visually spill past the row's rounded corners. That
same clipping was cutting the outer half of every handle — and for corner
handles specifically, the clip boundary ran right through the handle's
own geometric center, since the center *is* the row's edge. A test
computing a handle's click target from its (unclipped)
`getBoundingClientRect()` center would land exactly on that knife-edge,
and the browser's hit-test would occasionally resolve to a different,
still-partially-visible neighboring handle instead (observed: a drag
aimed at the "se" handle silently resized only height, matching "s"'s
behavior — "s" sits right next to "se" and was winning the ambiguous hit
test). Fixed by moving `RowFillMarker` into its own
`absolute inset-0 overflow-hidden rounded` wrapper, one level inside the
row's own box, and dropping `overflow-hidden` from the row's box itself
(its background/border still respect `rounded` on their own — clipping a
box's own painted background never needed `overflow-hidden` in the first
place, only clipping its *children* did). This is a real interaction bug,
not just a test artifact: any user resizing a row via a corner handle was
subject to the same knife-edge unreliability.

**Choice — `listRowProgress` gets a real `ORDER BY`, not another
client-side workaround:** the multi-select code already had one comment
acknowledging "`listRowProgress` has no `ORDER BY` and Postgres doesn't
guarantee one," and worked around it locally by sorting via `rowNumber()`
for range-selection specifically. That workaround doesn't help rendering
order — which row paints on top when two rows' boxes overlap (e.g. a
freshly duplicated row placed adjacent to its source) was still
undefined, and could flip between page loads. Found when
`e2e/row-workspace.spec.ts` intermittently failed to click a duplicated
row because an unrelated, earlier-created row happened to paint on top of
it that run. Fixed at the source instead of adding a second workaround:
migration `20260703172037_add_row_progress_ordering.sql` appends
`rows.created_at` to the `row_progress` view (appended, not inserted —
`CREATE OR REPLACE VIEW` only allows adding columns at the end, per
ADR-019's `phase_id` lesson), and `listRowProgress` now does
`.order("created_at")`. Row paint order — and everything downstream of
it, like which row a click lands on when two overlap — is now
deterministic.

**Consequences:** `duplicate-row-dialog.tsx` and `row-edit-sheet.tsx` are
deleted (superseded by the command panel + inline rename form — grepped
first to confirm nothing else referenced them). `lib/rows/actions.ts`
gained `deleteRowsBatch`, `getRowSnapshots`, `restoreRows`,
`getRowMaterialQtys`, `setRowsPhase`, `getRowPhases`, and
`upsertRowMaterialQtyMany` (replacing the old cross-product
`upsertRowMaterialQtyBulk` — undo needs arbitrary `{rowId, materialId,
requiredQty}` triples, since a redo's "before" values can differ per row,
not just per selection). `lib/phases/{actions,queries}.ts` are new
(`createPhase`, `listPhases`) — the Phases *sub-phase* (colors on the
drawing, legend, filtering) is still queued in Batch 2; this rework only
needed enough to create-and-assign a phase inline from "Set phase."

## ADR-019: Schema for Field/Crew closeout, Scheduler, Phases, multi-page drawings

**Decision date:** 2026-07-03

**Context:** One combined migration (`20260703104548_phases_scheduling_field_ops.sql`)
adds everything the next batch of sub-phases needs: offline-safe installs,
phases, blockers, day logs, project scheduling, and "exactly one marking
page per project." Written as a single idempotent file per this batch's
brief, rather than split into schema/rls/storage files like Phase 2 — the
smaller Phase 2 split earned its complexity by being the _first_ migration
ever reviewed; this one is additive to an already-documented schema, so
one file is easier to review end to end.

**Choice — installs stays append-only, just dedupe-able:** `idempotency_key`
(unique, nullable) and `device_id` are added, not a rework of the
event-log model — the field app generates a key client-side per logged
delta, so replaying an offline queue after reconnecting can't double-count
even if the network ACK was lost and the client retries. Nullable because
existing/manually-created rows have none; Postgres treats multiple NULLs
in a unique column as distinct, so this doesn't constrain them.

**Choice — day_logs is NOT append-only, unlike installs/blockers:** a crew's
day is filled in progressively (arrived, then offload/install times, then
departed) and "closed" once — modeling that as one row per crew/project/
day (`unique(project_id, crew_id, work_date)`) that gets updated, not
inserted repeatedly, matches the actual UX ("confirm the day's times...
submit"). RLS lets crew update their own entry
(`created_by = auth.uid()`) while the day is still open; owner/pm can
edit/delete any. Installs and blockers deliberately stay append-only/
insert-only for crew (existing behavior for installs; blockers is a report
log, not a single record to revise).

**Choice — exactly one marking page, enforced at two levels:** a partial
unique index (`drawings (project_id) where role = 'marking'`) makes "at
most one" a DB-level guarantee, not just an application convention.
Re-designating which page is "the" marking page is a
`security invoker` function (`set_marking_drawing`, not `security
definer`) doing both `drawings.role` flips and the `projects.mark_drawing_id`
pointer update together — invoker, deliberately, so it only succeeds when
the _calling_ user's own RLS already permits those writes (owner/pm via
the existing `drawings_write`/`projects_update` policies), rather than
bypassing RLS the way the org/role helper functions intentionally do.
Existing projects are backfilled by picking the drawing with the most
existing rows as a best-guess "the page they were already marking" (ties
broken toward the lower `page_index`) — a safe default even for a project
that genuinely had rows spread across multiple pages before this
constraint existed, since existing rows keep working everywhere else
(progress/materials are project-scoped, not marking-page-scoped); the
constraint only affects where _new_ rows can be drawn going forward,
which the multi-page sub-phase's UI enforces.

**Choice — RLS follows the existing three-tier pattern exactly:**
owner/pm/scheduler manage `phases`/`project_schedule` (scheduling-adjacent,
matching `assignments`/`targets`'s existing policy); crew gets INSERT-only
on `blockers` (report, don't resolve — owner/pm resolves) and INSERT +
own-row UPDATE on `day_logs`; everyone in the org reads everything. No new
helper functions needed — every new table is `project_id`-scoped directly,
so the existing `org_id_of_project()` covers all of them.

**Choice — `row_progress` gains `phase_id`, nothing else changes:** the
Layout/Progress tabs need to color/filter/group by phase; adding the
column to the existing view is enough for that. Phase-filtered _material_
reconciliation (a phase's rows only) is deferred to the Phases sub-phase
as an application-level query joining `row_materials`/`rows`/`installs`
directly, rather than reshaping the shared `material_reconciliation` view
that the whole-project Materials tab already depends on unfiltered.

**Consequences:** `materials.labor_units` and `projects.planned_days` are
unused by any UI yet — they exist now so the Scheduler sub-phase's target
math has a real column to read instead of inventing one mid-feature.
`database.types.ts` was hand-updated to match (ADR-010's established
pattern) ahead of the migration actually being applied to the live
project, since no Supabase access token/DB password was available in this
environment — see `docs/BUILD-LOG.md` for how it was actually applied.

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
