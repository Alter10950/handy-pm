# Architecture

## Areas & routes

| Route                         | Access    | Purpose                                                                                                                                                                                                                         |
| ----------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                           | redirect  | Sends signed-in users to `/app`, everyone else to `/login`.                                                                                                                                                                     |
| `/login`                      | public    | Email + password sign-in (Handy PM branded). No sign-up form — see ADR-017.                                                                                                                                                     |
| `/account`                    | protected | Self-service change-password. Any signed-in role.                                                                                                                                                                               |
| `/app`                        | protected | Projects list (from `project_progress`) + New project dialog.                                                                                                                                                                   |
| `/app/team`                   | protected | Team/user management — owner/pm only. Create accounts (email + temp password + role), change an existing member's role, reset their password.                                                                                   |
| `/app/project/[id]`           | protected | Overview tab — meta, quick stats, drawing thumbnail.                                                                                                                                                                            |
| `/app/project/[id]/mark`      | protected | "Layout" tab — drawing upload/viewer + row marking workspace (auto/draw/edit tools). Named `mark`, not `layout`, to avoid colliding with the Next.js `layout.tsx` file convention in the same folder — see `docs/DECISIONS.md`. |
| `/app/project/[id]/materials` | protected | Materials tab — packing-slip/paste-list upload, reference drawing overlay, materials × rows grid, reconciliation card.                                                                                                          |
| `/app/project/[id]/progress`  | protected | Project-level progress rollup (row counts, hazards, overall %). Per-material reconciliation lives on the Materials tab instead.                                                                                                 |
| `/scheduler`                  | protected | Crew/install scheduling. Placeholder until Phase 7.                                                                                                                                                                             |
| `/field`                      | protected | Crew phone app (installable PWA). Placeholder until Phase 6.                                                                                                                                                                    |
| `/portal/[token]`             | public    | Customer-facing read-only project status, gated by an unguessable share token. Placeholder until Phase 8.                                                                                                                       |

Protected routes live under the `app/(protected)/` route group, which shares
one layout (`app/(protected)/layout.tsx`) that fetches the current user,
redirects to `/login` if absent, and renders `SiteHeader` (nav + signed-in
user + sign-out) around the page content. `proxy.ts` (Next.js's middleware
convention, renamed in Next 16) additionally redirects unauthenticated
requests to `/app`, `/scheduler`, and `/field` before any rendering happens —
see `docs/DECISIONS.md` ADR-006 and ADR-007 for why both layers exist and
why `/field` is included.

## Auth flow

1. User enters email + password on `/login`; the browser calls
   `supabase.auth.signInWithPassword(...)` directly (`lib/supabase/client.ts`),
   which sets Supabase's auth cookies via `@supabase/ssr` — no redirect
   link, no `/auth/callback` route (removed — see ADR-017).
2. `proxy.ts` runs on every request, refreshing the session cookie and
   redirecting unauthenticated requests away from protected routes. This is
   what keeps a session alive across visits; it doesn't care how the
   session was created.
3. There's no public sign-up. Every account is created by an owner/pm from
   `/app/team` (`lib/team/actions.ts`'s `createTeamMember`, service-role
   `admin.auth.admin.createUser`) or via `scripts/seed.mjs`. A brand-new
   project's very first user still auto-becomes `owner` of a new org
   (`handle_new_user` trigger, unchanged) — that path just isn't reachable
   from the UI anymore, only from the Supabase dashboard or a script.
4. Self-service password change lives at `/account`
   (`components/account/change-password-form.tsx`), calling
   `supabase.auth.updateUser({ password })` on the current session directly
   — no admin API involved, since a user changing their own password
   doesn't need to bypass RLS.
5. Sign-out is a Server Action (`lib/auth/actions.ts`) invoked from a form in
   `SiteHeader`.

### Team management (`/app/team`)

Owner/pm only — `app/(protected)/app/team/page.tsx` redirects anyone else
to `/app`, and every mutation in `lib/team/actions.ts` independently
re-derives the caller's role from the DB (never trusts the client), since
this is the one area of the app that reaches for the service-role admin
client:

- `createTeamMember` — `admin.auth.admin.createUser` (email + the temp
  password typed into the form, visible not masked, so the admin can read
  it back to share with the new hire), then overwrites the profile row the
  `handle_new_user` trigger just inserted (org_id null, role 'crew') with
  the caller's org and the selected role. That overwrite has to go through
  the admin client — `profiles_update`'s RLS `using` clause checks the
  row's _pre-update_ org_id, which is null for a brand-new profile, so the
  caller's own RLS-scoped session could never pass that check itself.
- `updateTeamMemberRole` — a plain role change (org_id unchanged) is
  exactly what `profiles_update`'s RLS already allows an owner/pm to do
  directly, so this one uses the normal cookie-scoped client, not admin.
  Blocks changing your own role from this screen (self-lockout guard).
- `resetTeamMemberPassword` — `admin.auth.admin.updateUserById(...,
{password})`. Since this goes through the admin client (bypasses RLS),
  it explicitly checks the target profile's `org_id` against the caller's
  own before touching `auth.users` — otherwise an owner/pm could reset a
  password for a user in a different org by guessing/knowing their id.

`lib/team/queries.ts`'s `listTeamMembers()` reads profiles via the normal
RLS-scoped client (already correctly limited to the caller's org) and
resolves each member's email with `admin.auth.admin.getUserById` — bounded
to this org's own member count, never a whole-project user dump, since
`auth.users` isn't exposed through RLS/PostgREST at all.

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

## Drawing marking (Phase 4; reworked into one direct-manipulation canvas + undo/redo, 2026-07-03)

`/app/project/[id]/mark` renders `RowMarkingWorkspace`
(`components/projects/row-marking-workspace.tsx`), which owns selection
state, undo/redo, fullscreen state, the active page, and orchestrates:

- `RowStage` (`row-stage.tsx`) — the pointer-interactive canvas. No more
  separate Draw/Edit/Select tools (removed — see ADR-020): a plain
  pointerdown on a row selects it (shift/ctrl-click adds/removes it from
  a multi-selection); pointerdown on empty space draws a new box, or,
  held with Shift, marquee-selects; pointerdown on a row that's already
  part of the current selection moves the whole selection together
  (`beginRowMove` decides move-vs-select at pointerdown time from
  whether the clicked row is already in a multi-row selection). A
  single-selected row shows 8 resize handles (4 corners + 4 edge
  midpoints — `HANDLES`), each wired to a generic `applyResize()` that
  grows/shrinks whichever edge(s) the dragged handle sits on
  (`affectsLeft/Right/Top/Bottom` booleans per handle), leaving the
  opposite edge(s) fixed. Pointer capture on `pointerdown` keeps a drag
  tracking even if the cursor leaves the element. Geometry updates
  render from local "draft" state during a drag and only call back to
  the parent (to persist) on `pointerup` — never on every `pointermove`.
  Arrow keys nudge the current selection by a small zoom-aware
  screen-pixel step (Shift = 8x). Row fill orientation (does the
  progress bar fill bottom-to-top or left-to-right?) is decided by
  comparing **rendered pixel** dimensions
  (`geometry.h * effectiveHeight >= geometry.w * effectiveWidth`) against
  the stage's known natural size — not the raw normalized `w`/`h`, which
  are only directly comparable when the stage happens to be square.
  Caught in self-review; see `docs/BUILD-LOG.md`.
  - **Resize handles live outside their row's own clipping wrapper.**
    Corner/edge handles are deliberately centered *on* the row's own
    border (extending a few pixels past it in every direction) — as
    children of the row's own `overflow-hidden` box (needed to clip the
    fill-bar/label to the row's rounded rectangle), a corner handle's
    clip boundary ran right through its own geometric center, making it
    unreliably grabbable (a drag aimed at "se" could silently land on
    "s" instead). Fixed by giving the fill-bar/label their own
    `overflow-hidden` wrapper one level in, leaving the row's own box —
    which hosts the handles — unclipped. Found via
    `e2e/row-workspace.spec.ts`, not self-review; see ADR-020.
- **Zoom/pan** (`use-zoom-pan.ts` + `zoom-controls.tsx`) — unchanged by
  the interaction-model rework: a pure CSS `transform: translate()
  scale()` on the stage element, inside a fixed-size `overflow: hidden`
  viewport. Row geometry stays normalized 0..1 in the DB; the
  draw/move/resize math above needs **no changes** to stay correct
  under this transform, because every formula reads the stage's
  _current_ `getBoundingClientRect()`, and the browser already folds the
  live transform into that rect — `(clientX - rect.left) / rect.width`
  yields the same 0..1 fraction at any zoom/pan, the transform cancels
  out of the ratio automatically. Verified directly (not just by
  inspection): `e2e/row-workspace.spec.ts` draws a row at fit-zoom, zooms
  in 4x, drags over the exact same underlying content region (computed
  from the stage's post-zoom bounding rect), and asserts both rows land
  within 0.02 of the same normalized geometry in the DB. Wheel (any)
  zooms toward the cursor; native (non-React) wheel/touch listeners are
  used so `preventDefault()` actually suppresses the browser's own
  scroll/pinch — React's `onWheel`/`onTouch*` props are passive by
  default and silently ignore `preventDefault()`. Two-finger touch
  drives combined pinch-zoom + pan via native `touchstart/move/end`.
  Holding Space or the Pan toggle engages pan regardless of what's
  selected (ignored while typing in a field).
- **Fullscreen** — unchanged: `RowMarkingWorkspace`'s root (toolbar +
  stage, not just the stage) is the `requestFullscreen()` target, so the
  toolbar/undo/zoom controls stay reachable. Listens for
  `fullscreenchange` (handles Esc-to-exit, which bypasses the button).
- **Undo/redo** (`use-undo-stack.ts`, ADR-020) — command-pattern stack:
  every mutation (draw, move, resize, nudge, rename, delete, duplicate,
  one auto-rows batch, one bulk material/phase assignment) pushes a
  self-contained `{label, undo, redo}` entry built at the call site from
  the before/after data it already has, rather than a central
  type-dispatched reducer. Rows persist to the DB immediately, so
  undo/redo re-issues the inverse Server Action call(s) so the revert
  actually sticks, not just a client-side visual rollback; a toast shows
  "Undone"/"Redone" (`toast.tsx`). Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y are
  attached to `window` (via a ref-held handler + effect, not a React
  `onKeyDown` on a wrapping div): a command-panel action like Delete
  clears the selection as part of handling its own click, unmounting the
  (until-then-focused) button — the browser then moves focus to
  `<body>`, outside any div-scoped listener's subtree, silently breaking
  the very next Ctrl+Z. Found via `e2e/row-workspace.spec.ts`; see
  ADR-020.
- `RowCommandPanel` — button row acting on the current selection: Copy
  (duplicate incl. materials — sequential per row, not batched, to keep
  per-row placement/materials-copy logic simple and correct), Rename
  (single-selection only), Set materials (`BulkMaterialsPanel`), Set
  phase (`PhasePicker`), Delete, Clear. Delete/Backspace keys do the
  same as the Delete button.
- `AutoRowsDialog` — count + orientation ("vertical, side-by-side,
  left→right" splits width into N columns; "horizontal, stacked,
  top→bottom" splits height into N rows), matching the reference
  prototype's `applyGrid` math exactly. Confirming arms grid mode; the
  next drag-on-empty-space creates the whole batch in one Server Action
  call and pushes one undo entry for it.
- `PhasePicker` — dropdown of existing phases (color swatch + name) +
  "No phase" + inline "+ New phase" creation (name + 6 preset color
  swatches); "Set phase" assigns the current selection in one action,
  creating the phase first if new.
- **Phase color + legend (Phase 4/Sub-phase D, 2026-07-03, see
  ADR-023).** Each row with a `phaseId` renders with that phase's color
  as its **border** — an inline `style={{borderColor}}`, since colors
  are arbitrary hex values chosen in `PhasePicker` and can't be Tailwind
  classes ahead of time — deliberately not a background fill, which
  would collide with `RowFillMarker`'s own use of the background for
  install-progress. `PhaseLegend` (`phase-legend.tsx`), shown above the
  canvas, lists every phase with a show/hide toggle; hiding one filters
  its rows out of `RowStage`'s render entirely (`rows.filter(...)`
  before the `.map()`), not just dims them, so a hidden row is also not
  selectable/draggable/resizable while out of the way.
- `duplicateRows` (`lib/rows/actions.ts`) — copies are placed adjacent to
  the source (offset by the source's own width if it's narrower than
  tall, matching how "vertical" auto-rows sit side-by-side; offset by
  height otherwise, matching "horizontal" auto-rows stacking),
  auto-named the next sequential "Row N", clamped to stay within
  `[0, 1]`. `copyMaterials` (default on) also copies the source row's
  current `row_materials` onto every copy in the same action — two round
  trips (insert rows, then read + insert `row_materials` using the new
  rows' generated ids), not N one-off calls.

Auto-naming (`lib/rows/naming.ts`, pure functions) scans **every** row
label in the project — not just the active page's — for the highest
`Row N`, so numbering continues correctly across pages. `listRowProgress`
orders by `rows.created_at` (added to the `row_progress` view
specifically for this, appended at the end of its SELECT list per the
`CREATE OR REPLACE VIEW` positional-columns constraint — see ADR-019) so
row order — and therefore which row paints on top when two overlap, e.g.
a freshly duplicated row placed near its source — is deterministic
rather than whatever order Postgres happens to return with no
`ORDER BY`; found via `e2e/row-workspace.spec.ts` intermittently failing
a click on a duplicated row, see ADR-020. Mutations
(`lib/rows/actions.ts`: `createRow`, `createRowsBatch`,
`deleteRowsBatch`, `getRowSnapshots`, `restoreRows`, `updateRowGeometry`,
`renameRow`, `duplicateRows`, `setRowsPhase`, `getRowPhases`,
`upsertRowMaterialQtyMany`) are Server Actions, consistent with ADR-012.

`RowFillMarker` (`components/projects/row-fill-marker.tsx`) — the fill
bar + label + hazard-icon visual — is shared between `RowStage` (editable)
and `MaterialsReferenceStage` (read-only, Phase 5) so a row renders
identically in both places by construction, not by convention. Phase
border coloring (above) is applied identically in both for the same
reason — `MaterialsReferenceStage` doesn't get a hide toggle (that's a
Layout-tab-specific declutter tool), but a row's color should still
match wherever it's shown.

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

**Phase filter (Sub-phase D, 2026-07-03, see ADR-023).** A `<select>`
above the reference drawing narrows `MaterialsWorkspace`'s already-fetched
`rowProgress` to the selected phase's rows before building both the
reference-stage rows and the grid columns, and sums `rowMaterials`'
`required_qty` for those rows into a compact "assigned to this phase"
summary below the drawing — not a full reconciliation (that needs
per-row installed data this page doesn't fetch). The Progress tab
(`app/(protected)/app/project/[id]/progress/page.tsx` +
`components/projects/phase-progress.tsx`) has its own, separately-scoped
phase filter that recomputes row count/rows complete/pct client-side
from `row_progress`, the same shape `project_progress` aggregates — no
new query for either tab's filter.

## Field / crew app (Phase 6, 2026-07-03)

`/field` (active projects, `app/(protected)/field/page.tsx`) →
`/field/[projectId]` (`app/(protected)/field/[projectId]/page.tsx`) fetch
everything server-side in one `Promise.all` and hand it to
`FieldWorkspace` (`components/field/field-workspace.tsx`), a single client
component that switches between three views via local state (row list ↔
row detail ↔ day panel) rather than separate routes — same reasoning as
`RowMarkingWorkspace`: one data fetch, no full-page round trips between
taps a crew member expects to feel instant.

- **Crew selection is a per-device `localStorage` preference, not an
  identity.** `profiles` has no `crew_id` column and there's no
  crew-management UI yet (`crews`/`crew_members` have existed in the
  schema since Batch 1 — see Data model below — but Sub-phase C is what
  builds CRUD for them). `useCrewSelection` (`use-crew-selection.ts`)
  remembers "which crew this device is logging as" independent of the
  signed-in user, matching a shared job-site phone better than a personal
  login would. Every crew-scoped write is nullable and degrades cleanly
  with no crew picked. Implemented with `useSyncExternalStore` (a
  module-level pub-sub over `localStorage`), not `useState` + `useEffect`
  — the latter is exactly the "read a browser-only value after mount and
  mirror it into state" pattern ESLint's `react-hooks/set-state-in-effect`
  rule flags. See ADR-021.
- **Material steppers** (`material-stepper.tsx`) show cumulative
  installed vs. required per material, with a qty input (+/− adjust it
  locally) and "Log +N" / "Correct −N" buttons that each record ONE
  `installs` delta — the log stays append-only (a correction is a
  negative entry, never editing/deleting a prior one, consistent with
  the schema comment on `installs`).
- **Offline queue** (`lib/field/offline-queue.ts` +
  `use-install-logger.ts`) covers install deltas specifically, not a
  generic "any action" queue — the one field action repeated dozens of
  times a shift, and the one the schema already carries
  `idempotency_key`/`device_id` for. A delta is attempted immediately;
  if that fails (or the browser is already offline), it's persisted to
  `localStorage` and drained in FIFO order on mount and on the `online`
  event, stopping at the first failure. `logInstallDelta`
  (`lib/field/actions.ts`) treats a unique-violation on
  `idempotency_key` as success — a retry after a dropped connection (but
  where the insert actually landed) must not double-count. `pendingCount`
  is read via `useSyncExternalStore` against the queue's own
  notify-on-mutation pub-sub, for the same lint-rule reason as crew
  selection above; the queue's internal "currently draining" guard is a
  plain `useRef`, not `useState`, since it's a mutex that's never
  rendered — using state there tripped the same rule even called from
  inside a `useCallback`, not literally inline in the effect. See
  ADR-021.
- **Blockers** (`blocker-form.tsx`) — a bottom-sheet form: 10 fixed codes
  as a tappable grid (matching `BlockerCode`), a note, and an optional
  photo. A photo uploads to the `daily-photos` bucket client-side (same
  upload-then-record-the-path pattern as `DrawingUpload`) before
  `createBlocker` records the row. Photos attach to blockers
  specifically — the schema has no separate "daily photo log" table, so
  this is what it actually supports rather than a speculative addition.
- **Day log** (`day-log-panel.tsx`) — five progressive timestamps
  (arrived, offload start/end, install start/end) each a tap-to-mark-now
  with a reset, a note, and "Close the day" (sets `departed_at`).
  `upsertDayLog` (`lib/field/actions.ts`) is a hand-rolled
  find-or-update-or-insert, not a Postgres `ON CONFLICT` upsert:
  `day_logs`' `unique (project_id, crew_id, work_date)` doesn't catch
  "no crew picked" duplicates, since Postgres treats every `NULL` in a
  unique column as distinct from every other `NULL`.
- `lib/field/queries.ts`'s `getInstalledTotals` sums raw `installs` rows
  per (row, material) in JS rather than via a new aggregate view — one
  project's install history is small enough that this is simpler than
  adding a view for a single caller. `listTodayDayLogs`/
  `listTodayBlockers` return every crew's entries for today (not
  filtered to "my crew" server-side), since which crew the client is
  logging as is `localStorage` state the server can't know ahead of
  render — the client matches its own `crewId` against the list instead.

## Scheduler (Phase 7, 2026-07-03)

`/scheduler` (`app/(protected)/scheduler/page.tsx`) renders `CrewManager`
(crew CRUD: name/size/cost-per-hour, add/remove `crew_members`; `crews`
and `crew_members` have existed in the schema since Batch 1 with no UI
until now) and `SchedulerProjectList` (active projects, linking into each
one's workspace). `/scheduler/[projectId]` fetches everything server-side
in one `Promise.all` and hands it to `SchedulerWorkspace`
(`components/scheduler/scheduler-workspace.tsx`):

- **Remaining-qty math uses `assigned − installed`, not
  `material_reconciliation.left_qty`.** `left_qty` is
  `needed − assigned` — procurement's "still needs to be ordered/
  allocated," a different number from "how much of what's assigned to a
  row still needs to physically go in," which is what a schedule target
  is about. `lib/scheduler/queries.ts`'s `listRemainingByMaterial`
  computes it directly from `material_reconciliation`'s own `assigned`/
  `installed` columns. See ADR-022.
- **`ScheduleBuilder`** (`schedule-builder.tsx`) — pick a start/end date,
  optionally skip weekends, generate the candidate day list, tap any day
  to exclude it (e.g. a holiday), save. `setProjectSchedule`
  (`lib/scheduler/actions.ts`) replaces the whole `project_schedule` set
  for the project rather than diffing against the existing one — a date
  is either scheduled or it isn't, nothing else to preserve.
- **`generateTargets`** (`lib/scheduler/actions.ts`) — "daily targets
  auto-suggested from remaining material ÷ remaining days": splits each
  material's remaining qty evenly across every scheduled day from today
  forward, project-wide (`targets.crew_id: null` — a day can have more
  than one crew assigned, and splitting a target across them needs a
  rule, evenly/by size/by cost, that isn't specified). Deletes and
  regenerates only `crew_id is null` rows from today forward first, so
  re-running it after progress changes is a clean recompute rather than
  layering on stale suggestions; past-dated and any manually-set
  per-crew targets are left untouched. `upsertTarget` is a hand-rolled
  find-or-update-or-insert (`targets` has no unique constraint at all,
  unlike `day_logs` — same reasoning as ADR-021's day_logs upsert).
- **`WeekView`** (`week-view.tsx`) — prev/next week navigation; each
  scheduled day shows assigned crews (+ unassign), target vs. actual
  (summed across materials — the Scheduler cares about total daily
  output, not a per-material breakdown, which is the Materials tab's
  job), and a status badge (Exceeded ≥110% of target, Hit ≥100%, Close
  ≥70%, Miss below — reasonable defaults, not spec'd numbers). Days not
  in `project_schedule` render dimmed, for context, without a target/
  actual. `AssignCrewForm` (`assign-crew-form.tsx`) offers three
  assignment scopes — whole project (`assignments.row_id: null`),
  specific rows (multi-select), or a phase (resolved client-side to that
  phase's *current* row ids and inserted as one `assignments` row per
  row — a snapshot at assignment time, not a live link to the phase).
- **SPI badge** (`SchedulerWorkspace`) — cumulative actual ÷ cumulative
  planned (sum of all targets) through today, green ≥1.0 / amber ≥0.8 /
  red below. Standard EVM-style thresholds, not numbers from the spec.

Crew rate tracking (`crew_rates.units_per_hour`) isn't built — the schema
anticipates it as a *derived* metric (actual installed ÷ actual hours
from `day_logs`/`installs`), a non-trivial aggregation pipeline of its
own that isn't a named Sub-phase C requirement; targets are generated
from remaining-qty ÷ remaining-days only, not adjusted by a crew's
historical rate.

## Testing

`npm run test:e2e` (`npm run seed && playwright test`) runs a Playwright
suite against the **real Supabase project**, driving `next dev` on
`localhost:3001` — not a mock. See ADR-015 for the full reasoning; in
short:

- `scripts/seed.mjs` — idempotent: ensures org "Handy Equip" and a
  confirmed test user (`qa+owner@handyequip.test`) exist, wired together
  (`profiles.org_id`/`role`) with a known password
  (`SEED_OWNER_PASSWORD`, reset on every run so a stale password from a
  prior run can never break the suite). Safe to run any number of times,
  including as part of every `test:e2e` invocation.
- `e2e/auth.setup.ts` — signs in as that user through the real `/login`
  form (email + password) — no admin/backdoor sign-in needed now that
  auth is password-based, so this also exercises the actual sign-in UI.
  Saves `storageState` for reuse by the rest of the suite.
- `e2e/project-flow.spec.ts` — the main flow: create project → upload a
  drawing (`e2e/fixtures/test-drawing.svg`) → auto-create rows → paste a
  material list → assign quantities in the grid → verify the
  reconciliation card and Progress tab. Cleans up its own project (and
  Storage objects) in `test.afterAll` via `e2e/helpers/cleanup.ts`
  (service-role, so cleanup succeeds independent of the browser
  session's state).
- `e2e/team-flow.spec.ts` — creates a team member from `/app/team`,
  changes their role, resets their password; separately exercises
  self-service password change from `/account`. Deletes the created auth
  user in `test.afterAll` (`deleteAuthUserByEmail`). The role-change step
  waits for the actual POST response before reloading to verify — the row
  updates its `<select>` optimistically, so checking the DOM value alone
  can't distinguish "saved" from "an in-flight request `page.reload()`
  is about to cancel."
- `e2e/field-flow.spec.ts` (run at a 390×844 mobile viewport) — project
  pick → crew pick → material install → blocker + photo → **offline
  queue exercised for real** (`page.context().setOffline(true)`, confirm
  it queues and shows the pending-sync indicator, go back online, confirm
  it drains into the database) → day confirm → close the day.
- `e2e/scheduler-flow.spec.ts` — crew + member creation, schedule build
  (confirms weekends were actually skipped, not just that some days were
  saved), target generation, assign + unassign a crew — each step
  confirmed against the database, not just the UI's own "done" message
  (a real timing gap surfaced here: the week view's re-render isn't
  awaited by the generate-targets button, so a naive assertion on the
  toast alone could pass a beat before the UI actually caught up).
- `e2e/phases-flow.spec.ts` — assigns a row to a new phase and confirms
  its border color actually changed (`getComputedStyle`, polled — not
  just that the legend entry appeared), hides the phase and confirms
  the row disappears from the drawing while an unrelated row stays
  visible, un-hides it, then filters Materials and Progress by phase.
  Caught another cross-page navigation race: Materials and Progress both
  have a `<select>` labeled "Filter by phase," and interacting with it
  right after clicking the "Progress" nav link — before that client-side
  navigation actually finishes — silently lands on the *Materials* tab's
  still-mounted select instead. Fixed by waiting for a
  Progress-tab-specific element first; worth remembering for any test
  that reuses label text across pages.

This suite is what caught ADR-016's env var bug — self-review and
`next build` both stayed clean through Phases 3–5 because neither
exercises a real browser's client-side bundle the way an actual sign-in
or upload click does.

## Data model

Built in Phase 2, extended 2026-07-03 for Field/Scheduler/Phases (see
ADR-019). Migrations live in `supabase/migrations/`, applied in this
order:

1. `schema_core.sql` — tables, checks, FKs, indexes.
2. `auth_bootstrap.sql` — `handle_new_user` trigger.
3. `rls_policies.sql` — helper functions, RLS policies, grants.
4. `storage_buckets.sql` — `drawings` / `packing-slips` buckets + policies.
5. `views.sql` — `row_progress`, `project_progress`, `material_reconciliation`.
6. `phases_scheduling_field_ops.sql` — `phases`, `blockers`, `day_logs`,
   `project_schedule` tables; `materials.size`/`labor_units`;
   `installs.idempotency_key`/`device_id`; `rows.phase_id`;
   `drawings.role` + `projects.mark_drawing_id` (one marking page per
   project); `daily-photos` bucket; `row_progress.phase_id`.

### Tables

Every table is scoped to an `organizations` row, directly (`org_id`) or
transitively via `project_id` → `projects.org_id` or `crew_id` →
`crews.org_id`.

| Table                                    | Scoped via                    | Purpose                                                                                                                                                                                                                                     |
| ---------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organizations`                          | —                             | Tenant boundary. One per Handy Equip-style deployment (see auth bootstrap below); multi-org support exists in the schema but isn't exercised yet.                                                                                           |
| `profiles`                               | `org_id` (nullable)           | One row per `auth.users`, `role` ∈ `owner`/`pm`/`scheduler`/`crew`.                                                                                                                                                                         |
| `projects`                               | `org_id`                      | A racking-install job. `status` ∈ `active`/`on_hold`/`complete`. `planned_days` (Scheduler target math) and `mark_drawing_id` (the one markable page — see below) added 2026-07-03.                                                         |
| `crews` / `crew_members`                 | `org_id` / via `crews`        | Install crews and their members (Scheduler sub-phase).                                                                                                                                                                                      |
| `drawings`                               | `project_id`                  | One row per rendered page (`page_index` 0-based) of an uploaded layout PDF/image. `storage_path` points into the private `drawings` bucket. `role` ∈ `reference`/`marking` — see below.                                                     |
| `packing_slips`                          | `project_id`                  | Uploaded packing-slip files; `parsed` reserved for future OCR/extraction.                                                                                                                                                                   |
| `materials`                              | `project_id`                  | The job's material catalog — `total_needed` (job total) and `received` (from packing slips) live here; per-row requirements live in `row_materials`. `size` (free-form, e.g. `36SQ10`) and `labor_units` (Scheduler math) added 2026-07-03. |
| `rows`                                   | `project_id` (+ `drawing_id`) | A marked rack section on a drawing page. `x/y/w/h` are **normalized 0..1** fractions of the drawing's rendered size, so marks stay correct at any zoom/display size. `phase_id` (nullable) added 2026-07-03.                                |
| `row_materials`                          | via `rows`                    | Required qty of a material for a specific row. `unique(row_id, material_id)`.                                                                                                                                                               |
| `installs`                               | via `rows`                    | Append-only log of installed qty per row/material/date. `qty` may be negative (a correction entry) — never edit history in place. `idempotency_key` (unique, nullable) + `device_id` added 2026-07-03 for the field app's offline queue.    |
| `phases`                                 | `project_id`                  | A named, colored grouping of rows — `color` renders on the drawing, `sort_order` controls legend/list order.                                                                                                                                |
| `blockers`                               | `project_id`                  | A logged reason work stopped — `code` is one of 10 fixed values, plus note/photo. `resolved_at` null until cleared.                                                                                                                         |
| `day_logs`                               | `project_id`                  | One row per crew/project/day (`unique(project_id, crew_id, work_date)`), filled in progressively and updated (not re-inserted) as the day closes out.                                                                                       |
| `assignments` / `targets` / `crew_rates` | `project_id` / `crew_id`      | Scheduling. Created in Phase 2 so FKs were clean from day one; built out by the Scheduler sub-phase.                                                                                                                                        |
| `project_schedule`                       | `project_id`                  | Presence of a row = a scheduled working day (`unique(project_id, work_date)`) — a date range can be picked and specific days skipped without a separate flag.                                                                               |
| `share_tokens`                           | `project_id`                  | Customer portal tokens (Phase 8). Not publicly RLS-readable — see below.                                                                                                                                                                    |

**Exactly one marking page per project:** `drawings.role` defaults to
`'reference'`; a partial unique index
(`drawings (project_id) where role = 'marking'`) makes "at most one
marking drawing per project" a DB-level guarantee. Re-designating which
page is the marking one goes through `set_marking_drawing(project_id,
drawing_id)` — a `security invoker` function that flips every drawing's
`role` and updates `projects.mark_drawing_id` together, so it can never
leave two drawings marked `'marking'` or the pointer out of sync, and it
only succeeds when the calling user's own RLS already permits those
writes (it does not bypass RLS the way the org/role helpers deliberately
do). See ADR-019 for the backfill logic that assigned existing projects a
marking page when this migration ran.

### Auth bootstrap

`handle_new_user()` (SECURITY DEFINER trigger on `auth.users` insert): the
**first** user ever created becomes `owner` of a freshly-created
organization — this bootstrap path is now reachable only via the
Supabase dashboard or `scripts/seed.mjs` (see ADR-017), since there's no
public sign-up. Every subsequent account is created from `/app/team`
(owner/pm only), which sets the right org/role immediately via the
service-role admin API — no manual SQL needed.

### RLS & authorization

Every table has RLS enabled. Two SECURITY DEFINER helpers avoid recursive
policy evaluation: `current_org_id()` and `current_user_role()` (both read
the caller's own `profiles` row via `auth.uid()`; the role helper is NOT
named `current_role()` — that collides with a reserved Postgres keyword,
see ADR-008 update below). Role model:

- `owner` / `pm` / `scheduler` — full CRUD within their org on most tables.
  (Finer-grained differences between these three are deferred until a
  later phase's UI actually needs them, except where noted below.)
- `crew` — read access to their org's data, plus:
  - **INSERT on `installs`** (log field work) — never update/delete.
  - **INSERT on `blockers`** (report a stoppage) — resolving/editing/
    deleting is owner/pm only.
  - **INSERT + UPDATE own row on `day_logs`** (`created_by = auth.uid()`)
    while filling in the day progressively; owner/pm can edit/delete any.
  - **INSERT on the `daily-photos` storage bucket.**
  - Cannot create/edit/delete projects, materials, rows, phases, or the
    project schedule.

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

Three private buckets: `drawings` and `packing-slips`, path convention
`{project_id}/{filename}`; `daily-photos` (added 2026-07-03), path
convention `{project_id}/{date}/{crew_id}/{filename}` — the extra path
segments don't change the org-scoping check below, since it only ever
looks at the _first_ segment. RLS policies on `storage.objects` derive the
owning project from the first path segment
(`(storage.foldername(name))[1]::uuid`) and check it against
`current_org_id()`. `daily-photos` allows INSERT from any org role
(crew uploads photos in the field); `drawings`/`packing-slips` stay
owner/pm-only for writes. The app always reads via short-lived signed URLs
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
