# Build log

Engineering journal. Newest entries at top.

---

## 2026-07-03 — Sub-phase B: Field/crew daily closeout

**What:** Batch 2's sub-phase B, resumed after the Layout-tab rework
interrupt. Mobile-first `/field` area: pick a project, pick a row (colored
by phase, showing %), log material installs, report blockers with a
photo, confirm the day's times, close the day. Full reasoning in
`docs/DECISIONS.md` ADR-021; summary here.

**New:** `/field` (project list, replaces the placeholder) and
`/field/[projectId]` (the workspace) routes. `lib/crews/queries.ts`
(`listCrews` — shared with the Scheduler sub-phase later).
`lib/field/{queries,actions}.ts` — `getInstalledTotals` (per-row-material
cumulative sum, computed here rather than via a new view since one
project's install log is small),`listTodayDayLogs`/`listTodayBlockers`,
`logInstallDelta` (idempotency-key-safe), `createBlocker`, `upsertDayLog`
(hand-rolled find-or-update-or-insert — see ADR-021 for why this can't be
a Postgres `ON CONFLICT` upsert), `closeDay`. `lib/field/offline-queue.ts`
— localStorage-backed queue for install deltas specifically, with
pub-sub so `useSyncExternalStore` can read `pendingCount` reactively.
`components/field/`: `field-workspace.tsx` (orchestrator: row list ↔ row
detail ↔ day panel, all client-side, one data fetch), `material-stepper.tsx`,
`blocker-form.tsx` (code grid + note + photo, uploads to `daily-photos`
client-side then records the path via a Server Action — same
upload-then-record pattern as drawing/packing-slip uploads),
`day-log-panel.tsx`, `use-crew-selection.ts`, `use-install-logger.ts`.

**Two `react-hooks/set-state-in-effect` lint errors, both fixed with
`useSyncExternalStore` instead of `useState`+`useEffect`:** both
`useCrewSelection` (reading the remembered crew from `localStorage`) and
the install queue's `pendingCount` originally read a browser-only value
inside an effect and mirrored it into state — exactly the "extra render"
pattern that ESLint's newer hooks rule flags. The lint rule turned out to
trace through a same-scope `useCallback` too: routing the queue's drain
through a `draining` boolean via `useState` still tripped the rule even
though the `setState` call was inside a separately-defined function, not
literally inline in the effect body — since `draining` is a pure internal
mutex never rendered, it's now a `useRef` instead, which sidesteps the
question entirely rather than working around it.

**Verification:** `npm run lint`, `npm run typecheck`, `npm run build`,
and the full `npm run test:e2e` (6 tests now, zero regressions) all pass.
New `e2e/field-flow.spec.ts` (run at a 390×844 mobile viewport — this is
the shape it's actually used at) covers, in one continuous flow: the
project appearing in the Field list, picking a crew, logging a material
delta and confirming the DB total, reporting a blocker, **going offline
mid-session (`page.context().setOffline(true)`), logging a delta that
queues instead of failing, confirming the pending-sync badge, going back
online, and confirming it drains and lands in the database** — the
riskiest part of this sub-phase actually exercised, not just reasoned
about. Also extended `e2e/helpers/cleanup.ts`'s project teardown to
recursively clean up `daily-photos` (nested paths, unlike the other two
buckets — see ADR-021), so repeated test runs don't accumulate orphaned
test photos in Storage.

Manually reviewed screenshots at the mobile viewport for all four main
views (project list, row detail with the material stepper, the blocker
bottom sheet, the day panel) before considering this done — all four
render cleanly. One known gap, not fixed here: the standard
Projects/Scheduler/Field/Team header still shows on `/field/*`, which a
crew member on a phone doesn't need; left as-is to avoid changing the
shared protected-layout for one route group without being asked (see
ADR-021's consequences).

## 2026-07-03 — Layout tab reworked into one direct-manipulation canvas + undo/redo

**What:** Two requests landed back to back mid-batch (after sub-phase 0 +
A, before sub-phase B): add undo/redo, then rework the whole Layout tool
model into one direct-manipulation canvas (no separate Draw/Edit/Select
buttons). Full reasoning in ADR-020; this entry covers the build and,
mainly, what the E2E suite caught.

**Build:** `row-stage.tsx` and `row-marking-workspace.tsx` rewritten.
Click a row to select; shift/ctrl-click adds/removes from the selection;
drag a selected row's body to move the whole selection; drag empty space
to draw (or shift-drag to marquee-select); 8 resize handles on a single
selection; arrow keys nudge. New: `use-undo-stack.ts`, `toast.tsx`,
`row-command-panel.tsx`, `phase-picker.tsx`, `lib/phases/{actions,
queries}.ts`. Deleted (superseded): `duplicate-row-dialog.tsx`,
`row-edit-sheet.tsx`. `lib/rows/actions.ts` gained batch/snapshot/restore
helpers undo needs (`deleteRowsBatch`, `getRowSnapshots`, `restoreRows`,
`upsertRowMaterialQtyMany` replacing the old cross-product bulk upsert).

**Rewriting `e2e/row-workspace.spec.ts` for the new model found three real
app bugs — not just test-design issues** (though there were plenty of
those too; see below). All three are detailed in ADR-020:

1. **Resize handles were unreliably grabbable**, worst on corner handles.
   They're deliberately centered on the row's own border, but rendered as
   children of the row's `overflow-hidden` box (needed to clip the
   fill-bar to the row's rounded corners) — the clip boundary ran right
   through a corner handle's own center. A drag aimed at "se" would
   sometimes silently behave like "s" instead (its closest, still-visible
   neighbor winning the ambiguous hit-test). Fixed by giving the
   fill-bar/label their own clipping wrapper, one level inside the row's
   now-unclipped box.
2. **Ctrl+Z stopped working right after Delete.** The undo/redo listener
   was a React `onKeyDown` on the workspace's root div — reasonable-
   sounding ("keydown bubbles up from whatever's focused"), except
   clicking Delete clears the selection as part of the same click,
   unmounting the just-focused Delete button; the browser then moves
   focus to `<body>`, outside the div's subtree, and the next Ctrl+Z
   never reaches the handler. Fixed by attaching the listener to
   `window` instead (matching the existing Space-to-pan pattern in
   `row-stage.tsx`).
3. **Row paint/click order was non-deterministic.** `listRowProgress` had
   no `ORDER BY`; a comment already flagged this for multi-select
   ordering (worked around locally with `rowNumber()` sorting), but
   render/paint order — which row is "on top" where two overlap, e.g. a
   freshly duplicated row next to its source — was still whatever
   Postgres felt like returning that query. New migration
   `20260703172037_add_row_progress_ordering.sql` appends
   `rows.created_at` to the view; `listRowProgress` now does
   `.order("created_at")`.

**E2E test-design bugs found and fixed along the way** (these were test
bugs, not app bugs): the 12-row auto-rows setup originally filled almost
the entire drawing, so a later "draw in empty space" step landed on an
existing row instead — narrowed the setup drag to a corner strip. A
"draw a new row" target was briefly moved off-center to dodge that same
fill area, which would have reintroduced the exact
zoom-toward-center-goes-off-screen bug from the previous session — kept
the target centered and narrowed the auto-rows strip instead. Several
`getByText("Row N").click()` calls were switched to
`getByTestId("row-box-Row N")`: clicking a label span directly is
unreliable once a row is narrow enough that the label's natural text
width exceeds the row's own box (the label isn't width-clamped, so its
click target can extend into a neighboring row). A `getByRole("button",
{name: "Clear"})` collided with a second, unrelated "Clear selection"
button visible at the same time — added `exact: true`. A resize
assertion read the database immediately after `mouse.up()`, racing the
Server Action's round trip — switched to `expect.poll`. Nudging
immediately after resizing raced the client's own re-render (the nudge
handler rebuilds the full box from the `rows` prop, so reading it before
the resize's re-render lands would silently revert the just-applied
width/height) — fixed by polling the row's own rendered bounding box
before nudging, not a network-based proxy.

**Verification:** `npm run lint`, `npm run typecheck`, `npm run build`,
and the full `npm run test:e2e` (5 tests, zero regressions) all pass.
`e2e/row-workspace.spec.ts` now covers: zoom-accuracy draw, click +
shift-click multi-select with an exact-boundary materials check, copy +
rename, move, resize, arrow-key nudge, phase creation + assignment,
delete → undo → redo, and reload persistence — in one continuous flow on
one project, matching how a real session would actually use these
features together rather than in isolation.

## 2026-07-03 — Sub-phase 0 migration applied and verified live

**What:** User provided a one-time Supabase personal access token.
`supabase link --project-ref ntdynurigavrpvexwiij` succeeded; `supabase
db push` initially failed because Batch 1's 5 migrations were applied
by hand via the SQL editor originally, so the CLI's remote migration
history table had no record of them — pushing would have tried to
re-run all 6 files and hit "policy already exists" on the first 5.
Fixed with `supabase migration repair --status applied <5 timestamps>`
(pure bookkeeping, no SQL re-run), then `db push` again.

**Real bug caught by the push itself:** failed with `cannot change name
of view column "label" to "phase_id"`. Root cause: `row_progress`'s
`CREATE OR REPLACE VIEW` inserted `r.phase_id` between `drawing_id` and
`label` in the SELECT list — Postgres compares old/new view columns
_positionally_ on replace and only allows appending new ones at the
end, so inserting one mid-list reads as renaming every column after it.
The whole migration rolled back atomically on failure (nothing
partially applied), consistent with `supabase migration list` showing
the new migration's remote status still empty afterward. Fixed by
moving `r.phase_id` to the end of the column list; re-ran cleanly.

**Verification:** confirmed all 4 new tables reachable via the REST API
(200, not 404). Ran `supabase gen types typescript` against the live
project and compared against the hand-written `database.types.ts` from
the previous entry — exact match on every altered/new column; the only
difference is intentional (this codebase's literal union types like
`BlockerCode` vs. the generator's plain `string` for CHECK-constrained
columns, per ADR-010's established practice of keeping the hand-written
version's stronger typing). `npm run typecheck` still clean.

## 2026-07-03 — Batch 2 kickoff: schema migration drafted (sub-phase 0), Team deactivate/reactivate (sub-phase A)

**What:** First two sub-phases of a large autonomous batch (schema →
Team polish → Field/Crew closeout → Scheduler → Phases → multi-page
drawings → packing-slip AI extraction). This entry covers the first two;
later entries cover each subsequent sub-phase as it lands.

**Sub-phase 0 — schema (drafted, not yet applied):** one combined,
idempotent migration
(`supabase/migrations/20260703104548_phases_scheduling_field_ops.sql`)
adding everything sub-phases B–F need — full reasoning in ADR-019.
Attempted `npx supabase db push` first; failed with "Cannot find project
ref" (not linked, no access token in this environment — same gap as
Phase 2's original migration). Rather than block the whole batch on
that, hand-updated `lib/supabase/database.types.ts` to match the new
schema (same approach ADR-010 used for the original schema, before this
project was linked), so every subsequent sub-phase can be written and
typechecked against the real shape immediately. The migration file
itself is real, reviewed, committed code — "applying" it to a specific
environment is a separate, one-time operational step, not a reason to
withhold it from source control. **This is the batch's one NEEDS-YOU
item** — see `docs/PROGRESS.md`'s status note for the two ways to
unblock it (a one-time access token, or a one-step SQL editor paste).

**Sub-phase A — Team deactivate/reactivate:** `setTeamMemberActive`
(`lib/team/actions.ts`) sets/lifts a ~100-year Supabase Auth ban via
`admin.auth.admin.updateUserById(..., { ban_duration })` — deactivating
never deletes anything, the profile and all their history stay put, and
reactivating is just clearing the ban. Blocks sign-in and token refresh
from that point on; an already-active session isn't instantly killed,
it can keep working up to its natural ~1h access-token expiry (Supabase
doesn't expose a "revoke this user's sessions right now" admin call to
pair with the ban). Self-lockout guarded (can't deactivate your own
account), same pattern as the existing role-change guard. Extracted the
"verify this target profile is in my org" check (previously duplicated
only in `resetTeamMemberPassword`) into a shared `requireMemberInOrg`
helper now that a second admin-client action needs the identical guard.
`TeamMemberRow` shows an Active/Deactivated badge and dims the whole row
when deactivated.

Also re-verified (unchanged since the previous session, but re-run
here since the E2E suite's first step in every run _is_ a real
password-based sign-in): email+password login continues to work end to
end on localhost via the full `npm run test:e2e` run below. Production
(`https://handy-pm.vercel.app`) was verified with a real headless
browser against a disposable test account in the prior session and
nothing auth-related has changed since — re-confirmed at this batch's
next production deploy rather than redundantly right now.

**E2E:** extended `e2e/team-flow.spec.ts` with a
deactivate-then-reactivate step: clicks Deactivate, waits for the real
POST response (not just the badge text) before checking, confirms via
`admin.auth.admin.listUsers()` that `banned_until` is actually in the
future; then reactivates and confirms it's cleared.

**Verification:** `npm run lint`, `npm run typecheck`, `npm run build`,
and the full `npm run test:e2e` (5 tests, zero regressions) all pass.

## 2026-07-03 — Layout tab: zoom/pan/fullscreen, multi-select bulk quantities, duplicate row

**What:** Real feedback from the first live layout (Bingo Warehouse): big
warehouses need zoom/pan to draw precisely, and setting up many
near-identical rows one at a time is too slow. Added zoom/pan/fullscreen,
multi-select → bulk quantity assignment, and row duplication to the
Layout tab, keeping the non-negotiable constraint: row coordinates stay
normalized 0..1 in the DB, zoom/pan is a view-only transform. Full
reasoning in ADR-018; summary here.

**Zoom/pan (`components/projects/use-zoom-pan.ts`):** a plain
`transform: translate() scale()` on the stage element inside a
fixed-size `overflow: hidden` viewport. The existing draw/move/resize
math needed **zero changes** — it already computes normalized fractions
from the stage's live `getBoundingClientRect()`, which the browser
reports post-transform, so the transform cancels out of the ratio
automatically at any zoom/pan. Wheel (any) zooms toward the cursor;
+/−/Fit buttons and a live percentage float in the stage's corner
(`zoom-controls.tsx`). Pan via a new Hand tool, holding Space (ignored
while typing), or a native two-finger touch drag; two-finger touch also
pinch-zooms. Both wheel-zoom and touch pinch/pan use native (non-React)
event listeners in a `useEffect`, not React's `onWheel`/`onTouch*` props
— those are passive by default, so `preventDefault()` silently no-ops
and the browser's own scroll/pinch would otherwise fight the custom
handling.

**Fullscreen:** `RowMarkingWorkspace`'s root (toolbar + stage together,
not just the stage) is the `requestFullscreen()` target, so the tool and
zoom controls stay reachable. Listens for `fullscreenchange` to also
catch Esc-to-exit.

**Multi-select + bulk quantities:** a new `select` tool — tap toggles a
row, shift-click selects the contiguous range from the last-tapped row,
drag-marquee unions in every row it touches. Rows are sorted by a new
`rowNumber()` helper (`lib/rows/naming.ts`) for this, not raw array/DB
order — `listRowProgress` has no `ORDER BY`, so "select rows 2-11" needs
a numeric ordering, not an incidental one. `BulkMaterialsPanel` shows one
quantity input per material (blank = leave untouched) and calls a new
`upsertRowMaterialQtyBulk` (`lib/rows/actions.ts`) once for the whole
`rowIds x materialQtys` cross product — one upsert, not N×M round trips,
through the same RLS-scoped client and `onConflict` target as the
existing single-cell upsert (multi-select needed no RLS changes).

**Duplicate a row:** `RowEditSheet` gained a "Duplicate…" button →
`DuplicateRowDialog` (copy count, "also copy material assignments"
toggle, default on) → a new `duplicateRows` Server Action. Copies are
placed adjacent to the source, offset by its own width or height
depending on which is smaller (matching exactly how "vertical" vs.
"horizontal" Auto Rows already arranges adjacent rows, rather than a new
placement convention), auto-named the next sequential "Row N", clamped
into `[0, 1]`. Copying materials is two round trips (insert the new
rows, then read the source's `row_materials` and insert copies using the
new rows' generated ids) — necessarily two, since Postgres has to hand
back the new ids before `row_materials` can reference them.

**A real lint rule fought back:** `eslint-plugin-react-hooks`'s
`react-hooks/refs` rule flagged `zoomPan.zoom`, `zoomPan.fit`, etc. as
"cannot access ref during render" even though those specific fields are
plain values, not refs — apparently the rule doesn't trace precisely
enough to clear non-ref fields on an object that _also_ carries a ref
(`viewportRef`) anywhere. Fixed by having `useZoomPan` take the viewport
ref as a parameter instead of creating/returning it, and having every
call site destructure the hook's return into plain local variables
rather than holding the object and writing `zoomPan.zoom` in JSX. A
second instance of the same rule family caught a real anti-pattern:
syncing a ref directly in the render body (`zoomPanRef.current = ...`)
instead of inside a `useEffect` — moved accordingly.

**E2E (`e2e/row-workspace.spec.ts`):** the most important test here
verifies the zoom-invariance claim isn't just asserted in a comment — it
draws a row at fit-zoom, zooms in ~2.4x, drags over the _exact same
underlying content region_ (computed from the stage's post-zoom bounding
rect) and confirms both rows land within 0.02 of the same normalized
geometry, read directly from the DB. Getting this test right took two
iterations: the first attempt dragged a fixed _viewport-relative_ box
size at every zoom level, which produces a _smaller_ stage fraction once
zoomed in — correct app behavior, wrong test, since it wasn't actually
comparing "the same content at two zoom levels." Also covers: selecting
rows 2-11 and bulk-setting two materials, with an explicit DB check that
rows 1 and 12 (just outside the range) got neither material (confirms an
exact boundary, not an off-by-one); duplicating a row twice with
materials copied, verified per-copy; and a reload to confirm persistence.
A second, genuine (if minor) bug surfaced along the way and was fixed in
the test, not the app: `[140, 20].sort()` defaults to lexicographic
string comparison in JS, so it doesn't actually sort numbers — needed an
explicit `(a, b) => a - b` comparator.

**Verification:** `npm run lint`, `npm run typecheck`, `npm run build`,
and the full `npm run test:e2e` (5 tests, including the two new/extended
specs above, zero regressions in the existing project-flow and
team-flow suites) all pass. No orphaned E2E test data confirmed via a
direct query afterward.

## 2026-07-03 — Replaced magic-link auth with email + password, added Team management

**What:** Magic-link email delivery was too slow/unreliable to sign in
against (both for the user and, earlier, for this project's own E2E
setup — see ADR-015). Replaced it end to end with email + password,
added an in-app way to create accounts since there's now no email step to
implicitly gate sign-up, and set a real password for the user's own
account so they could sign in immediately. Full reasoning in ADR-017;
summary here.

**Login:** `/login` now collects email + password and calls
`supabase.auth.signInWithPassword` directly from the browser client —
`components/login-form.tsx` rewritten, no more `signInWithOtp`. Sessions
stay persistent exactly as before (`proxy.ts`'s per-request cookie
refresh doesn't care how a session was created) — no changes needed
there. `app/auth/callback/route.ts` was pure magic-link/OTP verification
code with nothing else depending on it (confirmed by grepping the whole
repo first) — deleted rather than left disabled, along with the Supabase
dashboard "Redirect URLs" setup step in `README.md` for both localhost
and production, since password sign-in has no callback to register at
all. This also makes the previous session's still-open "configure
Supabase Auth Site URL/Redirect URLs for production" item moot — nothing
left to configure there.

**No public sign-up, Team management:** added `/app/team` (owner/pm
only, redirects anyone else to `/app`) — `lib/team/{queries,actions}.ts`.
`createTeamMember` uses the service-role admin client
(`admin.auth.admin.createUser`) since creating an `auth.users` row has no
other path without a sign-up endpoint, then overwrites the profile row
`handle_new_user`'s trigger already inserted (org_id null, role 'crew')
with the caller's own org and the role picked in the form — that
overwrite specifically needs the admin client, because `profiles_update`'s
RLS policy checks the row's _pre-update_ org_id (null for a fresh
profile), so the caller's own session could never pass that check.
`updateTeamMemberRole` and `resetTeamMemberPassword` round out the
screen — the first goes through the caller's normal RLS-scoped session
(a plain role change is exactly what `profiles_update` already allows),
the second needs the admin client again (bypasses RLS) and so explicitly
verifies the target profile's org_id against the caller's own before
touching `auth.users` — otherwise an owner/pm could reset a password for
a user in a different org by guessing/knowing their id. Every mutation
independently re-derives the caller's own role from the DB; nothing
trusts what the client claims about itself.

Also added `/account` (any signed-in role) for self-service password
change — `supabase.auth.updateUser({password})` on the current session,
deliberately separate from Team since it needs no admin privileges or
org check at all.

**Set a real login for the user:** ran a one-off Node script (admin API,
`.env.local` service-role key, deleted immediately after running, per the
same disposable-script pattern as the earlier magic-link bypass) to set a
generated password for `alter@handyequip.com` — their profile was already
`owner`/"Handy Equip" from the earlier bypass session, so this only
touched the password. Password relayed directly in chat, not committed or
logged anywhere.

**E2E suite:** `e2e/auth.setup.ts` rewritten to sign in through the real
`/login` form (email + password) instead of ADR-015's admin-generated
`token_hash` bypass — password auth doesn't need a backdoor, so setup now
also exercises the real sign-in UI. `scripts/seed.mjs` extended to set
(and reset, every run) a known password for the seed test user. Added
`e2e/team-flow.spec.ts`: create a team member → change their role →
reset their password → self-service change-password from `/account`,
cleaning up the created auth user afterward
(`e2e/helpers/cleanup.ts`'s new `deleteAuthUserByEmail`).

**Found and fixed a real test bug, not an app bug:** the role-change test
step initially failed after a `page.reload()` showed the _old_ role
still persisted. Root cause was the test, not the app: `TeamMemberRow`
updates its `<select>` optimistically (`setRole` before the Server Action
resolves), so asserting on the DOM value alone proved nothing about
server persistence, and reloading immediately could cancel the
in-flight request outright. Fixed by waiting for the actual POST
response (`page.waitForResponse`) before reloading — confirmed the role
change genuinely persists across a real page load once the test was
measuring the right thing.

**Verification:** `npm run lint`, `npm run typecheck`, `npm run build`,
and the full `npm run test:e2e` (4 tests: seeded sign-in, the existing
project flow — confirming no regression — team management, and
self-service password change) all pass.

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
