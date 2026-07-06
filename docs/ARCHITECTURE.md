# Architecture

## Areas & routes

| Route                         | Access    | Purpose                                                                                                                                                                                                                         |
| ----------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                           | redirect  | Sends signed-in users to `/app`, everyone else to `/login`.                                                                                                                                                                     |
| `/login`                      | public    | Email + password sign-in (Handy PM branded). No sign-up form — see ADR-017.                                                                                                                                                     |
| `/account`                    | protected | Self-service change-password + display-name edit. Any signed-in role.                                                                                                                                                           |
| `/app`                        | protected | Projects list (from `project_progress`) + New project dialog.                                                                                                                                                                   |
| `/app/team`                   | protected | Team/user management — owner/pm only. Create accounts (email + temp password + role), change an existing member's role, reset their password, deactivate/reactivate, assign to a crew.                                          |
| `/app/settings`               | protected | Org settings — owner/pm only. Name, address, logo, default working days.                                                                                                                                                         |
| `/app/project/[id]`           | protected | Overview tab — meta, quick stats, drawing thumbnail.                                                                                                                                                                            |
| `/app/project/[id]/mark`      | protected | "Layout" tab — drawing upload/viewer + row marking workspace (auto/draw/edit tools). Named `mark`, not `layout`, to avoid colliding with the Next.js `layout.tsx` file convention in the same folder — see `docs/DECISIONS.md`. |
| `/app/project/[id]/materials` | protected | Materials tab — packing-slip/paste-list upload, reference drawing overlay, materials × rows grid, reconciliation card.                                                                                                          |
| `/app/project/[id]/progress`  | protected | Project-level progress rollup (row counts, hazards, overall %). Per-material reconciliation lives on the Materials tab instead.                                                                                                 |
| `/scheduler`                  | protected | Crew/install scheduling — owner/pm/scheduler only (redirects crew to `/app`; their equivalent is Field). See Scheduler section below.                                                                                            |
| `/field`                      | protected | Crew phone app (installable PWA). Placeholder until Phase 6.                                                                                                                                                                    |
| `/portal/[token]`             | public    | Customer-facing read-only project status, gated by an unguessable share token. Built (Batch 3, Sub-phase H).                                                                                                                       |

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
4. Self-service password change and display-name edit both live at
   `/account` — `components/account/change-password-form.tsx` calls
   `supabase.auth.updateUser({ password })` on the current session
   directly (no admin API — changing your own password doesn't need to
   bypass RLS); `components/account/update-name-form.tsx` calls
   `updateOwnName` (`lib/account/actions.ts`), which goes through the
   `update_own_full_name` RPC rather than a plain `profiles` update — see
   below for why.
5. Sign-out is a Server Action (`lib/auth/actions.ts`) invoked from a form in
   `SiteHeader`.

### Role guards (`lib/auth/session.ts`, 2026-07-06)

Every mutating Server Action that maps to a role-restricted RLS policy
calls `requireRole([...])` as its first line — it re-derives the
caller's own org/role from the DB (never trusts the client) and throws a
friendly error if they don't hold one of the listed roles. This exists
*alongside* RLS, not instead of it: RLS is the real security boundary
(a disallowed write is rejected by Postgres regardless of what
application code does or doesn't check), but relying on it exclusively
meant a disallowed attempt surfaced as a raw Postgres RLS error, and
nothing stopped a future call site from reaching the service-role admin
client without re-deriving the caller's role first. Each call site's
allowed-role list matches its table's RLS policy exactly — see ADR-027
for the full audit. `requireOrg()` is the same shape with no role
restriction, for actions any signed-in org member should reach (Field's
installs/blockers/day_logs — crew *should* write these).

### Team management (`/app/team`)

Owner/pm only — `app/(protected)/app/team/page.tsx` redirects anyone else
to `/app`, and every mutation in `lib/team/actions.ts` calls
`requireRole(["owner", "pm"])`, since this is the one area of the app
that reaches for the service-role admin client:

- `createTeamMember` — `admin.auth.admin.createUser` (email + the temp
  password typed into the form, visible not masked, so the admin can read
  it back to share with the new hire), then overwrites the profile row the
  `handle_new_user` trigger just inserted (org_id null, role 'crew') with
  the caller's org and the selected role. That overwrite has to go through
  the admin client — `profiles_update`'s RLS `using` clause checks the
  row's _pre-update_ org_id, which is null for a brand-new profile, so the
  caller's own RLS-scoped session could never pass that check itself.
- `updateTeamMemberRole` / `assignTeamMemberCrew` (2026-07-06) — a plain
  role or `crew_id` change (org_id unchanged) is exactly what
  `profiles_update`'s RLS already allows an owner/pm to do directly, so
  both use the normal cookie-scoped client, not admin. Role change blocks
  changing your own role from this screen (self-lockout guard).
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

**Self-service name edit needs a narrow RPC, not a plain update.**
`profiles_update`'s RLS policy only lets owner/pm update *any* profile
row, including their own — a crew/scheduler user can't touch their own
`full_name` through it at all. Postgres RLS is row-level, not
column-level, so there's no way to write a policy granting "any user may
update this one column of their own row" without also exposing every
other column (`role`, `org_id`) on that row to a crafted client update.
`update_own_full_name(p_full_name)` (`security definer`) hardcodes both
`where id = auth.uid()` and the single column it ever touches — same
narrow-RPC pattern as `set_marking_drawing`.

### Org settings (`/app/settings`)

Owner/pm only, same page-level redirect pattern as Team.
`lib/org/actions.ts`'s `updateOrgSettings`/`recordOrgLogo` both call
`requireRole(["owner", "pm"])`, matching the `organizations_update` RLS
policy (organizations was read-only for every role until 2026-07-06 —
name/created_at never changed post-creation; a dedicated update policy
was added rather than widening `organizations_select`, so read access
for everyone else stays exactly as narrow as before). Logo upload
(`components/org/org-logo-upload.tsx`) mirrors `PackingSlipUpload`'s
browser-upload-then-record pattern exactly: browser Supabase client
uploads to the private `org-logos` bucket (path `{org_id}/{filename}`),
then a Server Action records `logo_path`. Default working days is an
`int[]` of JS `Date.getDay()` values (0=Sunday..6=Saturday) — a single
convention the estimator/scheduler can share rather than inventing a
second one, defaulting to Mon-Fri (`{1,2,3,4,5}`).

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

## Drawing marking (Phase 4; reworked into one direct-manipulation canvas + undo/redo, multi-page 2026-07-03; interaction/pan/snap-back rework 2026-07-06)

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
  As of the 2026-07-06 rework (ADR-031), that draft state is ALSO local-
  first on drop: it's no longer cleared immediately on a successful
  `pointerup`, so the row keeps showing the dropped position with zero
  visual snap-back while the persist is in flight, reconciling away only
  once the server-confirmed `rows` prop actually matches it (or
  reverting + toasting on a failed persist — `onMoveRows`/`onResizeRow`
  now return the underlying persist promise instead of firing-and-
  forgetting, specifically so `RowStage` can react to failure). Starting
  a new drag/resize reads its origin from `currentGeometry(row)` (draft-
  or-row), not the raw prop, so a second interaction on the same row
  while its first move is still persisting is computed from the right
  starting point. Arrow keys nudge the current selection by a small zoom-aware
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
  Panning is always available, never a mode: holding Space turns a
  left-drag into a pan (checked at pointerdown time, ignored while
  typing in a field), and — since the 2026-07-06 rework, replacing the
  Pan/Hand toggle button that used to be the only way to pan without
  Space — the middle mouse button always pans regardless of what's under
  the cursor, at the highest priority. Every pointerdown handler on a
  row body or resize handle checks `event.button !== 0` first and
  returns without `stopPropagation()` for a non-primary button, letting
  it bubble untouched to the stage's own handler (the same bubbling
  technique the pre-existing Space-held check already used) — a pan
  gesture can never be hijacked into moving/resizing/drawing a row.
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
- **Multi-page drawings (Sub-phase E, 2026-07-03, see ADR-024).** Every
  uploaded page is browsable via the page tabs (a ★ marks the current
  marking page), but exactly one is markable — enforced by
  `drawings.role`/`projects.mark_drawing_id` (ADR-019) plus `RowStage`'s
  new `readOnly` prop, true whenever the active page isn't
  `markDrawingId`. `readOnly` short-circuits
  `handleStagePointerDown`'s draw/marquee branch (pan still works — a
  view control, not a mark), `handleRowPointerDown` (select/move), and
  `handleKeyDown` (nudge/delete); resize handles are additionally gated
  `isSingleSelected && !readOnly`. Zoom/pan/fullscreen are entirely
  unaffected — they're not part of `RowStage`'s own interaction
  handlers. A project's first upload auto-becomes its marking page
  (`recordDrawingUpload`, `lib/projects/actions.ts`); later uploads
  default to `'reference'` and need an explicit "Set as marking page"
  (`setMarkingDrawing`, wrapping the `set_marking_drawing` RPC), which
  `RowMarkingWorkspace` shows next to the page tabs whenever the active
  page isn't the marking one (alongside a disabled, tooltip-explained
  "Auto rows" button — letting someone arm grid mode and then have the
  drag silently do nothing would look like a bug, not a boundary).
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

## Material receiving, reorder list, row readiness (Batch 3, Sub-phase F, 2026-07-06)

`lib/materials/` — `queries.ts` (`getMaterialReceiptTotals`,
`listMaterialReceiptHistoryByProject`) and `actions.ts`
(`recordMaterialReceipt`). Full design reasoning in
`docs/DECISIONS.md` ADR-033.

- **Receiving tab** (`/app/project/[id]/receiving`, hidden on
  `'estimate'`-status projects — same convention as Layout/Progress in
  `project-tabs.tsx`) — `ReceivingPanel` renders a reorder list (a
  straight filter/sort of the existing `material_reconciliation.
  to_order`, no new shortage math), a per-material status breakdown
  (count per `MaterialReceiptStatus`, a flagged banner when short/
  damaged/wrong has ever been logged), a check-in form, and an
  expandable "History" disclosure (`listMaterialReceiptHistoryByProject`
  — one bulk in-clause query across every material, not one query per
  material, same shape as `getMaterialReceiptTotals`).
- **`material_receipts` stays an append-only event log.**
  `recordMaterialReceipt` always inserts a row; only `status ===
  'received'` additionally does a read-modify-write on
  `materials.received`, the one aggregate `material_reconciliation`
  actually depends on for its `to_order`/`assigned` math. Every other
  status (`ordered`/`verified`/`staged`/`short`/`damaged`/`wrong`) has
  no separate aggregate — the log is authoritative, read back via the
  totals/history queries above. Same "log feeds one aggregate column"
  relationship `installs` already has with reconciliation.
- **Materials grid identity columns** — Profile, Capacity, Condition
  (a `<select>` of `MaterialCondition`), System, added after Labor in
  `materials-grid.tsx`, each with its own `data-testid`
  (`material-profile-`, `material-capacity-`, `material-condition-`,
  `material-system-`) — adding a second `<select>` to the row made a
  pre-existing test's bare `row.locator("select")` ambiguous; fixed
  there, not here (see Testing).
- **Row readiness** — `rows.materials_ready`/`area_accessible`/
  `drawing_approved` (booleans, sub-phase 0) feed `row_progress.
  readiness_status` (view-computed precedence: `complete` if all
  materials met → `blocked` if not materials_ready OR not
  area_accessible → `ready` if all three manual inputs are true AND a
  crew is assigned → else `partial`; a brand-new row defaults to
  `blocked`, since both manual inputs default false). `updateRowReadiness`
  (`lib/rows/actions.ts`) patches whichever subset of the three inputs
  changed (an explicit `{materials_ready?; area_accessible?;
  drawing_approved?}` object type — a loosely-typed `Record<string,
  boolean>` doesn't satisfy Supabase's generated `Update` shape).
  `RowReadinessPanel` (opened via a "Readiness" button in
  `row-command-panel.tsx`, single-row selection only) is a **local-first
  optimistic** component: its three checkboxes seed `useState` from
  props and update that local state directly in `onChange`, alongside
  calling the parent's `onChange` callback — the same fix, for the same
  reason, as the layout editor's move/resize snap-back (ADR-031): a
  fully server-controlled `checked={prop}` checkbox would otherwise
  visually revert the instant React re-renders with the still-stale
  prop, before the Server Action + `revalidatePath` round trip lands.
  Safe here because the panel only stays mounted while row selection
  doesn't change (picking a different row resets `activeCommand` and
  unmounts this one). `handleReadinessChange` in
  `row-marking-workspace.tsx` gives this full undo/redo, matching every
  other row edit. `RowFillMarker` renders a small corner dot
  (`READINESS_DOT_CLASS`: ready → success, partial → primary, blocked →
  destructive, omitted for complete) on both the editable
  (`row-stage.tsx`) and read-only (`materials-reference-stage.tsx`)
  drawing views.
- **Scheduler warns, doesn't block.** `AssignCrewForm.handleSubmit`
  checks the target rows' `readiness_status` and, if any is `'blocked'`,
  calls `window.confirm()` naming them before submitting — the same
  posture as the calendar's double-booking warning (ADR-029). The row
  picker itself also prefixes a blocked row's button label with "⚠ " and
  a destructive border, so the warning isn't the first signal. This is
  intentionally a soft warning, not a hard gate — turning "no verified
  material, no crew dispatch" into an actual block is an explicit later
  (Batch 4) job that builds on this UI rather than duplicating it.

## CSV/XLSX import, row-range duplication, materials bulk ops, drawing versioning (Batch 3, Sub-phase G, 2026-07-06)

Full design reasoning in `docs/DECISIONS.md` ADR-034.

- **Spreadsheet import** — `lib/projects/parse-spreadsheet.ts`
  (browser-only: `parseSpreadsheetFile(file)` uses `papaparse` for
  `.csv`, `exceljs` for `.xlsx`/`.xls`, reading only the first
  worksheet — both normalize to one `{headers, rows}` shape) +
  `guessColumnIndex(headers, synonyms)` (exact case-insensitive match,
  then substring fallback). `components/projects/import-materials-dialog.tsx`
  is one dialog with a `mode` toggle (materials list / row assignments)
  reusing the same file→map→preview→confirm shell for both — each mode
  has its own field-synonym config and its own preview-row shape, but
  the mapping `<select>`s and preview table render generically off
  whichever field list is active. Materials mode calls the new
  `lib/projects/actions.ts#importMaterials` (same `received =
  total_needed` packing-slip assumption as `pasteMaterialList`/
  `confirmExtractedMaterials`, same `replaceExisting` toggle). Row-
  assignments mode resolves row label + material name against the
  `rows`/`materials` lists already passed into `MaterialsGrid` as props
  (case-insensitive, trimmed) — entirely client-side, so the preview
  can show exactly which lines resolved before anything commits — and
  commits via the pre-existing `upsertRowMaterialQtyMany` directly, no
  new Server Action. **Deliberately never auto-creates a row or
  material from an unresolved name** — a spreadsheet has no geometry to
  draw a row from, and a silently-created near-duplicate material from
  a typo would be worse than a visible, named skip reason per line.
- **Duplicate range** — `components/projects/duplicate-range-dialog.tsx`
  + `handleDuplicateRange` in `row-marking-workspace.tsx`. Treats the
  current multi-row selection's own bounding box (not each row's
  individual size) as the repeating unit, offsetting every selected row
  by `n × blockWidth` (direction "right") or `n × blockHeight`
  ("below") for `n` in `1..repeatCount`, then calls the pre-existing
  `duplicateRows(projectId, drawingId, sourceRowId, newRows[],
  copyMaterials)` once per source row — that action already accepted
  *multiple* new rows per source (the single-row "Copy" button just
  always passed exactly one), so generating N pre-offset geometries
  client-side was the entire feature; no new Server Action. The dialog
  computes `maxRepeatsRight`/`maxRepeatsBelow` from the selection's own
  bounding box (how many repeats fit before the drawing's 0..1 edge) and
  disables/caps accordingly rather than silently clamping into an
  overlapping stack. Also the first UI to expose `copyMaterials` as a
  real checkbox — it's existed as a `duplicateRows` parameter since the
  original Copy button shipped, just hardcoded `true` at that one call
  site.
- **Materials bulk ops** — `MaterialsGrid` gained a leading checkbox
  column and a `selectedIds` Set, reusing its own existing
  `useTransition`/`error`/`run()` machinery (no separate undo-tracked
  action-dispatch shape, since materials edits in this codebase are
  direct, not undo-tracked, unlike rows). A conditional action bar
  offers bulk delete (`deleteMaterialsBatch`, `window.confirm()`-gated)
  and bulk set-condition (`bulkSetMaterialCondition`).
- **Drawing versioning** — `lib/drawings/queries.ts`
  (`listDrawingVersions`, `listDrawingVersionsByProject`) +
  `lib/drawings/actions.ts` (`uploadDrawingVersion`,
  `approveDrawingVersion`) on top of sub-phase 0's `drawing_versions`
  table, which had shipped with **zero** application code ever reading
  or writing it. `recordDrawingUpload` (existing) now also inserts a
  matching version-1 row (`approved_for_install: true` — nothing yet to
  review against) for every newly uploaded page, keeping the invariant
  "every `drawings` row has ≥1 `drawing_versions` row" true going
  forward. `uploadDrawingVersion` marks the page's current unsuperseded
  version `superseded_at = now()`, inserts the new version row
  UNAPPROVED, then updates the `drawings` row's `storage_path`/`width`/
  `height` in place (same id) — exactly the contract sub-phase 0's own
  migration comment specified but never implemented. `approveDrawingVersion`
  defensively un-approves every other version for that page when
  approving one, so "at most one approved version per page" holds even
  if ever called out of latest-version order.
  `components/projects/drawing-version-panel.tsx` (rendered above the
  toolbar in `row-marking-workspace.tsx`, for whichever page tab is
  currently active) shows the version badge, an "Upload new version"
  button (reuses `renderFileToPages`, first page only), an "Approve for
  install" button when pending, a warning banner visible to every role
  including crew when the latest version isn't approved yet, and an
  expandable version-history log — self-contained with its own
  `useTransition`/`router.refresh()`, not threaded through the
  workspace's undo stack (version history is an audit trail, not an
  undo-able edit, same posture as `material_receipts`/
  `project_estimates`). Intentionally a **soft warning, not a hard
  gate** — consistent with this codebase's established posture
  (ADR-029's double-booking warning, sub-phase F's blocked-row
  scheduler warning); turning this into an actual mobilization block is
  an explicit later (Batch 4) job.

## Customer portal (Batch 3, Sub-phase H, 2026-07-06)

Full design reasoning in `docs/DECISIONS.md` ADR-035.

- **`lib/portal/public.ts`** — the ONLY module the public
  `/portal/[token]` route calls. Uses `createAdminClient()` throughout
  (an anonymous request has no session, so RLS has nothing to scope
  against) and, unlike other admin-client modules in this codebase
  (`lib/reports/data.ts`), selects columns **by explicit name
  everywhere, never `select("*")`** — this output is directly
  customer-facing, so `project_progress`'s shortage-adjacent columns
  (`rows_missing_materials`, `required_total`, `installed_total`) are
  never even fetched, let alone rendered.
  - `resolveShareToken(token)` — looks up `share_tokens` by token;
    invalid if missing, `revoked_at` is set, or `expires_at` has
    passed. Collapses all three into one `null` return — the public
    page never explains *which* reason, just "no longer valid."
  - `getPortalData(projectId)` — `project_progress` (name/status/pct/
    deadline only), the single most recent `day_logs` row across every
    crew (`order by work_date desc, created_at desc limit 1`) for
    "most recent update," `projects.deadline` falling back to the
    latest `project_estimates.forecast_finish` for "next milestone,"
    and every `approved_photos` row for this project with a fresh
    1-hour signed URL from the private `daily-photos` bucket.
- **`lib/portal/queries.ts` / `lib/portal/actions.ts`** — the OFFICE
  side (RLS-scoped, authenticated owner/pm session), deliberately
  separate files from `public.ts` so it's never ambiguous at a call
  site which client (admin vs. RLS-scoped) a given function uses.
  `listCandidatePhotos` flattens every `day_logs.photo_paths` array and
  every non-null `blockers.photo_path` for the project into one browsable
  list (each entry tagged `source: 'day_log' | 'blocker'` and a
  human context string like "Day log — Jul 6, 2026"), cross-referenced
  against `approved_photos` so the UI knows which are already shown.
  `createShareToken`/`revokeShareToken`/`approvePhoto`/`unapprovePhoto`
  match `share_tokens_write`/`approved_photos_write` RLS exactly
  (owner/pm). `approvePhoto` upserts on `(project_id, storage_path)` —
  re-approving an already-approved photo (e.g. to change its caption)
  is idempotent, not a duplicate-key error.
- **"Portal" project tab** (`app/(protected)/app/project/[id]/portal/page.tsx`,
  hidden on `'estimate'`-status projects same as Layout/Receiving/
  Progress) — `ShareLinkPanel` (generate with an optional expiry,
  copy link, revoke with a `window.confirm()`) and `PhotoApprovalPanel`
  (a grid of every candidate photo, already-approved ones sorted first,
  "Show to customer" / "Remove from portal" toggle + an optional
  caption). Both are self-contained client components with their own
  `useTransition`/`router.refresh()` — no undo/redo (photo approval and
  link management are direct actions, not the kind of geometry/qty edit
  this codebase undo-tracks).
- **The public page itself** (`app/portal/[token]/page.tsx`) — a Server
  Component, no client-side state at all. Valid token → project name +
  status badge + % complete + (if set) target completion date + (if any
  day log exists) most recent update + (if any approved) a photo grid.
  Invalid/expired/revoked token → the same page shell with a single
  friendly message, no distinction shown to the customer between "link
  expired" and "PM revoked it." `next/image` renders every photo with
  `unoptimized` (same convention as the Overview tab's drawing
  thumbnail) since these are already-signed, already-sized URLs from
  Supabase Storage, not a `next/image`-optimizable path.

## Field / crew app (Phase 6, 2026-07-03; taken to flagship 2026-07-06)

`/field` (active projects + "My assignments today,"
`app/(protected)/field/page.tsx` → `components/field/field-home.tsx`) →
`/field/[projectId]` (`app/(protected)/field/[projectId]/page.tsx`) fetch
everything server-side in one `Promise.all` and hand it to
`FieldWorkspace` (`components/field/field-workspace.tsx`), a single client
component that switches between three views via local state (row list ↔
row detail ↔ day panel) rather than separate routes — same reasoning as
`RowMarkingWorkspace`: one data fetch, no full-page round trips between
taps a crew member expects to feel instant.

- **Crew selection is a per-device `localStorage` preference, not an
  identity — but now defaults to the signed-in user's own crew.**
  `useCrewSelection` (`use-crew-selection.ts`) remembers "which crew this
  device is logging as" independent of the signed-in user, matching a
  shared job-site phone better than a personal login would; every
  crew-scoped write is nullable and degrades cleanly with no crew picked.
  Implemented with `useSyncExternalStore` (a module-level pub-sub over
  `localStorage`), not `useState` + `useEffect` — the latter is exactly
  the "read a browser-only value after mount and mirror it into state"
  pattern ESLint's `react-hooks/set-state-in-effect` rule flags. See
  ADR-021. As of 2026-07-06 (`profiles.crew_id`, sub-phase A),
  `useCrewSelection(defaultCrewId)` falls back to the caller's own
  assigned crew when the device hasn't picked one yet — an explicit
  device-local pick still always wins once one exists.
- **"My assignments today"** (`field-home.tsx`, 2026-07-06) —
  `listTodayAssignments()` fetches every crew's assignments for today,
  org-wide (small dataset), and the client filters to the selected
  `crewId`, same "server can't filter ahead of render" reasoning as
  day_logs/blockers below.
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
  As of 2026-07-06, `BlockerForm` also takes optional `initialCode`/
  `initialNote` — the voice-note "report as blocker instead" hand-off
  (below) pre-fills these rather than making the crew re-type.
- **Day log** (`day-log-panel.tsx`) — five progressive timestamps
  (arrived, offload start/end, install start/end) each a tap-to-mark-now
  with a reset, a note, and (2026-07-06) end-of-day photos
  (`day_logs.photo_paths text[]` — distinct from a blocker's own photo;
  general documentation, so more than one is normal, unlike blockers'
  single `photo_path`). `upsertDayLog`/`addDayLogPhoto`/
  `removeDayLogPhoto` (`lib/field/actions.ts`) are hand-rolled
  find-or-update-or-insert, not a Postgres `ON CONFLICT` upsert:
  `day_logs`' `unique (project_id, crew_id, work_date)` doesn't catch
  "no crew picked" duplicates, since Postgres treats every `NULL` in a
  unique column as distinct from every other `NULL`.
- **"Close the day" opens a review screen, not an instant close**
  (2026-07-06) — times, today's net installs per row/material
  (`listTodayInstalls`, filtered client-side to the selected crew, same
  convention as day_logs/blockers), blocker count, note, and photos, with
  "← Back to edit" / "Confirm & close day." Composes two asks into one
  flow: "edit/resume before final submit" (fix a mis-logged qty via the
  row's own material stepper's "Correct −N," never a raw edit to the
  append-only `installs` log) and "a day-summary confirmation" (the
  review screen itself). `MaterialStepper` also shows "Today: +N"
  alongside the cumulative total, from the same `listTodayInstalls` data.
- **Voice-to-note** (`voice-note-recorder.tsx`, 2026-07-06) — the
  Anthropic Messages API has no audio-input content block, so
  transcription happens entirely client-side via the browser's own
  `SpeechRecognition` (vendor-prefixed on some browsers, unsupported on
  others — feature-detected, the component renders nothing at all when
  absent, rather than a button that always fails). Only the resulting
  text is sent to `app/api/field/voice-note`, which asks Claude (forced
  tool-use, same pattern as packing-slip extraction) to clean it into a
  concise note and flag a likely `BlockerCode` if it describes a
  stoppage. The crew always sees the draft first — "Use as today's
  note" / "Report as blocker instead" / "Discard" — nothing from a
  transcript reaches the database unreviewed.
- **Both AI routes (`packing-slips/extract`, `field/voice-note`) now
  call `requireOrg()` explicitly** (2026-07-06) — found while building
  voice-note that neither had a real auth check: packing-slip was only
  *indirectly* protected (an unauthenticated caller eventually fails
  inside `getSignedPackingSlipUrl`, but as an uncaught exception, not a
  clean response), and voice-note had *no* protection at all, since it
  never touches Supabase — nothing stopped an anonymous caller from
  spending the `ANTHROPIC_API_KEY` quota. Both now return a clean `401`
  instead.
- `lib/field/queries.ts`'s `getInstalledTotals` sums raw `installs` rows
  per (row, material) in JS rather than via a new aggregate view — one
  project's install history is small enough that this is simpler than
  adding a view for a single caller. `listTodayDayLogs`/
  `listTodayBlockers` return every crew's entries for today (not
  filtered to "my crew" server-side), since which crew the client is
  logging as is `localStorage` state the server can't know ahead of
  render — the client matches its own `crewId` against the list instead.

## Scheduler (Phase 7, 2026-07-03; gated to owner/pm/scheduler + taken to flagship 2026-07-06)

`/scheduler` (`app/(protected)/scheduler/page.tsx`) renders `CrewManager`
(crew CRUD: name/size/cost-per-hour, add/remove `crew_members`; `crews`
and `crew_members` have existed in the schema since Batch 1 with no UI
until now) and `SchedulerProjectList` (active projects, linking into each
one's workspace). `/scheduler/[projectId]` fetches everything server-side
in one `Promise.all` and hands it to `SchedulerWorkspace`
(`components/scheduler/scheduler-workspace.tsx`). Both pages redirect
non-owner/pm/scheduler callers to `/app` (ADR-027) — `CrewManager` and
the components below it render mutating controls with no role-awareness
of their own, so gating the whole page is simpler and more correct than
threading conditional rendering through each one individually; crew's
equivalent view is "My assignments today" in Field.

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

Crew rate tracking (`crew_rates.units_per_hour`) isn't built yet — see
below, this is exactly what sub-phase D adds.

### Cross-project crew calendar, capacity, per-crew SPI, Gantt timeline (2026-07-06)

`/scheduler/calendar` (`app/(protected)/scheduler/calendar/page.tsx` +
`components/scheduler/crew-calendar.tsx`) is the cross-project view the
per-project `WeekView` above can't be — a crew-×-day grid across every
active project for a given week (`?start=` search param drives the
visible week server-side; `WeekView`'s all-in-one-project data fetch
doesn't scale to "every project," so this page re-fetches per week
instead of holding a wide window client-side).

- **Native HTML5 drag-and-drop, no library.** Project chips (a sidebar
  of active projects) are `draggable`; dropping one on a crew's day cell
  calls `createAssignment` (whole-project scope). Existing assignment
  chips are also `draggable` (only when `row_id` is null — a
  rows/phase-scoped assignment is really N underlying `assignments` rows,
  and moving that batch via one drag isn't what this grid models);
  dropping one on a different cell calls the new `moveAssignment`. Before
  either, `checkDoubleBooking(crewId, workDate, excludeAssignmentId)`
  runs — a plain read, not role-gated like the writes — and a
  `window.confirm()` names any conflicting project(s) the crew is
  already on that day; declining leaves everything unchanged. See
  ADR-029 for why this is native DnD rather than a library, unlike
  nothing else in the app using one.
- **Capacity** — each cell shows "planned units / capacity hours."
  Capacity is `crew.size × 8`. Planned load is
  `getProjectDailyLaborLoad` (a project's remaining labor units —
  `assigned − installed` per material, weighted by
  `materials.labor_units`, mirroring `listRemainingByMaterial`'s
  "remaining" definition — spread across its remaining scheduled days)
  divided by however many crews share that project on that day (same
  "no rule specified, split evenly" reasoning as `generateTargets`).
  As of sub-phase D, this figure is real actual-hours-needed (standard
  labor units converted via the company-wide blended `crew_rates` for
  each material's `task_key`, falling back to the standard 1.0 pace
  wherever no crew has install history yet), not the flat 1:1
  placeholder this originally shipped with — see ADR-030. No changes
  were needed to this component or its props to pick that up.
- **Per-crew SPI** (`components/scheduler/crew-performance-panel.tsx`,
  shown on the per-project `SchedulerWorkspace`, not the cross-project
  calendar) — same even-split attribution, applied to `targets` (still
  project-wide per ADR-022) instead of labor units: a crew's "planned"
  for a day is that day's target divided by however many crews were
  assigned that day; "actual" is their own `installs.crew_id`-scoped
  total (`getCrewDailyActuals`).
- **Gantt-style timeline** (`components/scheduler/project-timeline.tsx`,
  also on `SchedulerWorkspace`) — `getPhaseTimelines` infers each
  phase's date range from `assignments` joined through `rows.phase_id`
  (a whole-project assignment counts toward every phase that has any
  row); phases have no date columns of their own. A phase with no
  assignments yet has no bar at all, not a zero-width placeholder.

## Estimation brain (Batch 3, Sub-phase D, 2026-07-06)

`lib/estimating/` — `labor.ts` (pure math, no I/O), `queries.ts` (reads,
including the one `computeProjectEstimate` function everything else
calls), `actions.ts` (writes: `recomputeCrewRates`, `saveProjectEstimate`,
`createEstimateProject`, `convertEstimateToActive`, plus the read-only
`computeEstimatePreview` the what-if tool calls directly, same
"Server Action as a callable read" pattern as `checkDoubleBooking`).
Full design reasoning in `docs/DECISIONS.md` ADR-030.

- **Labor units are standard hours.** `labor_standards.base_labor_units`
  is hours-per-unit at a baseline pace; `materials.labor_units =
  base_labor_units × size_factor` (via `computeLaborUnits`/
  `parseLeadingNumber` — only `per_ft_height`/`per_linear_ft` unit bases
  scale with size, a leading numeric token pulled from the free-text
  `size` field). This makes `crew_rates.units_per_hour` a clean
  efficiency multiplier relative to standard pace (1.0 = standard),
  computed automatically whenever a material's `task_key`/`size` changes
  (`lib/projects/actions.ts#updateMaterial`, and at insert time for
  `addMaterial`/`pasteMaterialList`/`confirmExtractedMaterials` — the
  last of these also infers `task_key` from the packing-slip AI
  extraction's own constrained description vocabulary and persists
  `size` to its own column instead of only folding it into `name`).
- **Three-tier rate resolution** (`resolveRate`): a crew's own
  `crew_rates` row (once `samples ≥ MIN_SAMPLES_FOR_CREW_RATE`, 3) →
  a company-wide blend across every crew's rates for that `task_key`
  (`getCompanyRatesByTaskKey`, samples-weighted, derived from the
  already-learned `crew_rates` table — cheap, no raw-history joins at
  read time) → the standard pace of `1.0` if nobody has any data yet.
- **`recomputeCrewRates`** is the one place that touches raw
  `installs`/`day_logs`/`blockers` history (90-day rolling window).
  `day_logs` records one time range per (crew, project, day) with no
  per-task breakdown, so each day's hours are allocated across whatever
  task_keys were actually installed that day, weighted by each one's
  share of that day's labor-unit output — the same proportional-
  attribution reasoning ADR-022/029 already used twice. Any (crew,
  project, date) with a blocker logged is excluded entirely before this
  allocation runs. A full recompute from the event log every time it's
  invoked (a button on `/app/estimate`), not an incremental running
  average — matches this codebase's general preference for auditable
  recomputation (`project_estimates` itself: insert, never mutate).
- **`computeProjectEstimate(projectId, {crewCount?, crewIds?})`** —
  full-scope labor units (`total_needed × labor_units`, works even with
  zero rows) and remaining-to-finish (`total_needed − installed`,
  deliberately NOT the scheduler's `assigned − installed` figure — see
  ADR-030 for why these two "remaining" concepts must stay separate),
  grouped by `task_key`, each converted to hours via the three-tier
  rate (blended across every selected crew if any are picked).
  `forecastFinishDate` walks forward from a start date crediting
  `crewCount` crew-days on each of the org's `default_working_days`
  until the needed crew-days are covered — deliberately NOT a simulation
  of a project's existing partial schedule, an intentional
  simplification for what's fundamentally a speculative "what if" tool.
  `computeConfidence` is a coverage heuristic (how much of the remaining
  labor rests on a real, sufficiently-sampled rate vs. the un-sampled
  standard guess), not a statistical confidence interval.
- **Estimate tab** (`/app/project/[id]/estimate`, on every project
  regardless of status) — `ProjectEstimatePanel` renders the initial
  server-computed estimate, then calls `computeEstimatePreview` directly
  on every what-if tweak (crew count, or toggling specific crews — which
  locks the count to the picked crews and uses their own rates instead
  of the company blend). "Save this estimate" inserts a `project_estimates`
  row (append-only, latest-by-`created_at` is "current," same pattern as
  `installs`). "Explain this estimate" POSTs the already-computed
  estimate JSON to `/api/estimates/explain` (`ANTHROPIC_API_KEY`-gated,
  same Anthropic Messages API call shape as the packing-slip/voice-note
  routes) — the AI explains the given numbers, never recomputes them.
  Unlike those two routes, the button itself doesn't render at all when
  the key isn't configured (computed server-side, passed down as a
  prop) rather than rendering and erroring on click.
- **Company estimating screen** (`/app/estimate`, owner/pm/scheduler —
  matches `labor_standards`/`crew_rates` RLS, not the owner/pm-only
  `/app/settings`) — a list of draft projects (`status = 'estimate'`),
  `LaborStandardsEditor`, and `CrewRatesPanel` (with the "recompute"
  button). "+ New estimate" creates a real `projects` row with
  `status = 'estimate'` and redirects straight to its Materials tab —
  paste a material list there exactly like a real project, classify
  each line's `task_key`/`size` in the grid, then read its Estimate tab.
  `listProjectsWithProgress` excludes `'estimate'` so it doesn't show on
  the main `/app` list; `ConvertEstimateButton` is a one-column status
  flip (a plain form action, not a client-side try/catch — it
  `redirect()`s, which a wrapped handler would incorrectly intercept).
  `ProjectTabs` hides Layout/Progress for `'estimate'`-status projects
  (no drawing, no install progress to show) but always keeps Estimate.

## Exception dashboard, emailed reports, closeout PDF (Batch 3, Sub-phase E, 2026-07-06)

Full design reasoning in `docs/DECISIONS.md` ADR-032.

- **`/app/dashboard`** (`app/(protected)/app/dashboard/page.tsx`, owner/
  pm/scheduler-gated, new nav link first among the office-role links) —
  a NEW page, not a rewrite of the plain `/app` project list (~20
  existing E2E specs navigate to `/app` expecting exactly that list).
  `lib/dashboard/queries.ts`: `listActiveProjectsForDashboard` (SPI per
  project via `lib/scheduler/spi.ts`, deliberately N+1 across the
  existing per-project `listTargets`/`getDailyActuals` rather than a
  hand-rolled batched query — reusing the exact functions the Scheduler
  page already trusts, so the two can never quietly disagree), plus
  crew-today via the existing `listOrgAssignmentsInRange` and the
  latest `project_estimates` row per project for forecast finish;
  `listShortagesAcrossProjects` (`material_reconciliation.to_order > 0`
  across every active project); `listUnresolvedBlockersAcrossProjects`
  (`blockers.resolved_at is null`, oldest first); `getCrewPerformanceSummary`
  (a samples-weighted blend across `getCrewRatesLookup`'s per-task
  rates — reuses sub-phase D's estimation brain directly, no new
  learning); `getTodayActivitySummary` (derived entirely from
  `installs`/`blockers`/`day_logs` — no new audit-log table).
- **`lib/scheduler/spi.ts`** — `computeProjectSpi` is
  `scheduler-workspace.tsx`'s own former inline `useMemo` formula,
  extracted verbatim (not re-derived) so the dashboard's SPI is
  guaranteed identical to the per-project Scheduler page's, not a
  second implementation. `classifySpi`/`RISK_TIER_CLASS`/
  `RISK_TIER_LABEL` formalize the existing success/primary/destructive
  three-tier convention (green ≥1.0, primary ≥0.8, destructive below —
  ADR-022) already used by the SPI badge and `week-view.tsx`'s per-day
  status; `scheduler-workspace.tsx` now calls these too instead of its
  own inline color logic.
- **`resolveBlocker`** (`lib/dashboard/actions.ts`, owner/pm, matches
  `blockers_update` RLS) — the first application code ever to touch
  `blockers.resolved_at`, which has existed in the schema since Batch 2
  with nothing reading or writing it. Without this, every blocker ever
  reported would show as "needing escalation" on the dashboard forever.
- **Crew performance** reuses sub-phase D's `getCrewRatesLookup`/
  `getCompanyRatesByTaskKey` directly (a samples-weighted blend across
  a crew's task_keys) rather than deriving a second per-crew
  productivity figure from `targets` — a more direct signal, and zero
  new computation.
- **Reports** (`lib/reports/`) — `data.ts`'s `buildProjectReportData`
  and `send.ts` use the **service-role admin client**, not the per-
  request cookie-scoped one: this module has two callers with very
  different auth contexts (a Vercel Cron request, with no user session
  and no `auth.uid()` at all — RLS would silently return nothing, not
  error; and the dashboard's manual "email now" button, gated by
  `requireRole` before ever reaching this code) — admin uniformly means
  one code path is provably correct for both. `render.ts` builds
  table-based HTML (no flexbox/grid — most email clients strip modern
  CSS) with a hot-linked signed drawing URL (not a base64 inline or
  attachment). `send.ts#sendReports(period, projectId?)` is the one
  function both the cron routes and `lib/reports/actions.ts#sendReportNow`
  (the manual button's Server Action) call — one email per active
  project (not a single company-wide digest), sent to every org owner/
  pm (`auth.admin.getUserById`, same admin-client email-lookup pattern
  as `lib/team/queries.ts`). Returns a result object instead of
  throwing on missing config, so both a cron run and a button click get
  a clean "not configured" signal rather than a 500.
- **`process.env.RESEND_API_KEY`** gates the whole feature (server-only,
  read inside `sendReports`); **`process.env.RESEND_FROM_EMAIL`**
  overrides the default sandbox sender (`Handy PM <onboarding@resend.dev>`).
  Live-verified against the real key already in `.env.local`: the
  integration correctly reaches Resend, and hit its own sandbox
  restriction — a sandbox/unverified-domain Resend account can only
  send to the account's own verified address, not arbitrary recipients
  (confirmed via a direct API call, not assumed). `EmailReportButton`'s
  message logic distinguishes "no active projects" from "every send
  failed" (`result.projectsAttempted` vs. `result.projectsSent`) and
  surfaces the real Resend error in the latter case — the original,
  simpler version would have shown a misleading "no active projects to
  report on" for this exact, likely-common case. See NEEDS-YOU for the
  domain-verification step this depends on for real delivery.
- **Vercel Cron** (`vercel.json`, `app/api/cron/reports/{daily,weekly}/route.ts`,
  schedules `0 23 * * *` / `0 23 * * 5`) — this deployment has no
  in-app scheduler of its own; Vercel Cron is the standard mechanism
  for a scheduled Route Handler on Vercel. Vercel automatically sends
  `Authorization: Bearer ${CRON_SECRET}` when that env var is set on
  the project — the route's own check is a plain string compare, not a
  custom auth scheme, and no-ops (allows the request through) when
  `CRON_SECRET` is unset, so the route works before that env var exists.
- **Closeout PDF** (`lib/pdf/closeout-pdf.tsx` + `app/api/projects/[id]/closeout-pdf/route.tsx`,
  owner/pm) — `@react-pdf/renderer`, not a headless browser: Puppeteer/
  Playwright-driven HTML-to-PDF needs a full Chromium binary, awkward
  and heavy in a Vercel serverless function; `@react-pdf/renderer` is
  pure JS, composes the document from its own primitives (`Document`/
  `Page`/`View`/`Text`/`Image`), and `renderToBuffer` runs directly in
  a Route Handler. Contents: org letterhead (name/address/logo, all
  from `organizations` — no phone/email columns exist yet),
  as-built drawing (the current marking drawing's signed URL),
  material reconciliation table, full blocker log (resolved and open),
  day-logs table, and a blank sign-off block (customer + org rep — no
  e-signature system exists, so this is a literal printed line).
  Downloadable from the project Overview tab (a plain link to the
  Route Handler, `owner`/`pm` only — matches the route's own gate).

## Packing-slip AI extraction (Sub-phase F, 2026-07-03)

`app/api/packing-slips/extract/route.ts` is the app's first Route
Handler under `app/api/` (everything else is Server Components/Actions).
`POST` body is `{storagePath}`; the route re-signs it
(`getSignedPackingSlipUrl`), fetches the bytes server-side, and calls
the Anthropic Messages API (`api.anthropic.com/v1/messages`) directly
via `fetch()` — no `@anthropic-ai/sdk` dependency for one call site.

- **Auth:** `process.env.ANTHROPIC_API_KEY`, read inside the handler
  (server-only — a Route Handler never ships to the browser bundle).
  Missing key → a `500` with a clear message, not a crash; there is no
  fallback path, since there's nothing sensible to extract without it.
- **Content-type branch:** `PackingSlipUpload`'s `<input type="file">`
  has no `accept` restriction, so the uploaded slip could be a PDF or a
  photo. The route reads the signed URL's response `content-type` header
  and sends either an `image` content block (real media type) or a
  `document` block (`media_type: "application/pdf"`) — the two aren't
  interchangeable on the Anthropic API.
- **Structured output via forced tool-use:** one tool
  (`record_materials`, `items: {code, description, size, qty}[]`) with
  `tool_choice: {type: "tool", name: "record_materials"}` forces a
  structured response instead of free text that would need parsing.
- **Review before save:** the route only extracts; nothing reaches
  `materials` until a human confirms.
  `components/projects/packing-slip-extract-dialog.tsx` renders every
  extracted line as an editable row (code/description/size/qty, remove,
  add-line), wired in twice — right after a fresh upload in
  `PackingSlipUpload`, and next to every previously-uploaded slip on the
  Materials page (`app/(protected)/app/project/[id]/materials/page.tsx`)
  — so extraction works on old slips too, not just the one just
  uploaded. "Replace the current list" mirrors `PasteMaterialsDialog`.
- **Save:** `confirmExtractedMaterials` (`lib/projects/actions.ts`)
  composes one `name` string per line — `[code, description,
  size].filter(Boolean).join(" ")` — which is what keeps two lines
  sharing a product code but differing in size (e.g. two beam lengths)
  distinguishable as separate rows. As of Batch 3 sub-phase D, `size` is
  ALSO persisted to its own `materials.size` column (previously folded
  into `name` only) and `task_key` is inferred from the extraction's own
  constrained description vocabulary (`inferTaskKeyFromDescription` —
  a case-insensitive keyword match, no extra AI call), so labor-unit
  computation is size-aware for packing-slip-confirmed materials too.
  Otherwise identical to `pasteMaterialList`: qty writes to both
  `total_needed` and `received`, an optional delete-first "replace"
  flag. See ADR-025 for the extraction reasoning, ADR-030 for the
  labor-unit side.

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
- `e2e/multi-page-flow.spec.ts` — first upload auto-becomes the marking
  page; a second upload defaults to view-only (a drag there is confirmed
  to create zero rows via a direct DB count, not just "no error
  appeared"); zoom and fullscreen still work on it; switching the
  marking page confirms *both* pages' roles flip correctly (the new page
  to `'marking'` and the old one back to `'reference'`), not just the
  new one. This work also caught a real bug unrelated to the test itself
  — see ADR-024 — that broke every drawing upload across the whole
  suite, a reminder that a shared code path's blast radius isn't
  contained to the one feature touching it.
- `e2e/packing-slip-extract-flow.spec.ts` — the first spec in this
  suite to conditionally exercise a live third-party API rather than
  only the app's own Supabase backend. Two tests, `test.skip` on
  opposite `ANTHROPIC_API_KEY`-configured conditions so exactly one runs
  in any given environment (never both, never silently neither): with
  no key, asserts the extraction route's graceful `500` surfaces as a
  clear error in the UI; with a key, screenshots a throwaway
  Playwright page rendering a synthetic packing slip (no binary fixture
  committed) and asserts the real extraction keeps two same-code/
  different-size lines distinct and drops a freight line, then confirms
  the save actually creates the right materials rows.
- `e2e/team-settings-flow.spec.ts` (2026-07-06) — crew assignment,
  own-name edit, and org settings (name/address/working days, confirmed
  against the DB directly — not just the UI) plus a logo upload (same
  synthetic-in-memory-image technique as the packing-slip test) all
  verified to persist. Its last test is this suite's first to sign in as
  a **different** user mid-run: creates a fresh crew-role account via
  the admin client, opens a genuinely separate `browser.newContext()`
  (the default `page` fixture reuses the seeded owner's storageState,
  which would defeat the point), signs in through the real `/login`
  form, and confirms direct navigation to `/scheduler`, `/app/team`, and
  `/app/settings` all redirect to `/app` — proving the new role guards
  are real page-level checks, not just hidden nav links. Found a real
  test-pollution bug while writing this: the crew-assignment test
  creates a crew via the UI but hadn't been cleaning it up, leaving
  permanent leftover rows that broke `scheduler-flow.spec.ts`'s
  `.filter({hasText: ...})` locator once more than one crew existed on
  the page (same "matches every ancestor" class of bug as elsewhere in
  this list) — fixed by deleting the crew by name in `afterAll`.
- `e2e/field-flow.spec.ts` extended (2026-07-06) — the day-close review
  screen is asserted against real logged data (net install qty, blocker
  count), not just that the screen appeared, plus a "← Back to edit"
  round trip and a synthetic end-of-day photo attach (not yet run
  live — see ADR-028); a second test confirms "My assignments today"
  actually highlights a project a crew was assigned to today.
- `e2e/voice-note-flow.spec.ts` (2026-07-06) — the browser-only
  `SpeechRecognition` half can't be driven in headless Chromium (no real
  microphone), so this tests the route it calls directly: a clean 500
  with no key configured, and (gated on a real key) that the AI both
  strips filler words and correctly flags a described stoppage as
  `MISSING_MATERIAL`. Also asserts a `401` for a genuinely
  unauthenticated request — found here that both `browser.newContext()`
  and `request.newContext()` inconsistently carried *some* valid session
  through to the server in this specific scenario (confirmed via a real,
  cookie-less `curl` to the same running server immediately after, which
  correctly got `401` — proving the server-side guard is sound, not the
  test's premise); resolved by using plain Node `fetch()`, which has no
  ambient cookie jar of any kind, for that one assertion.
- `e2e/crew-calendar-flow.spec.ts` (2026-07-06) — drags a project chip
  onto a crew's day cell via Playwright's `locator.dragTo()` (verified to
  correctly drive real `dragstart`/`dragover`/`drop` events against this
  app's native-HTML5-DnD implementation, not assumed), confirms the
  resulting assignment against the DB, then drags a second project onto
  the same cell and confirms the double-booking `window.confirm()`
  names the first project, and confirms removing one assignment leaves
  the other intact. Found a real test-timing issue: the drop handler is
  async (awaits `checkDoubleBooking` before ever calling `confirm()`),
  so `dragTo()` resolving doesn't mean the dialog has appeared yet — a
  `page.once("dialog", ...)` registered before the drag raced a
  synchronous assertion right after it and read an empty message; fixed
  by `Promise.all`-ing `page.waitForEvent("dialog")` with the drag call
  itself, so the assertion genuinely waits for the dialog to exist.
- `e2e/scheduler-flow.spec.ts` extended (2026-07-06) — tags a row with a
  phase, assigns it, and logs an install, then confirms both the Gantt
  timeline (a labeled bar) and the crew performance panel (a real SPI
  figure) render from that data — scoped via a new
  `data-testid="crew-performance-panel"` rather than a `hasText` div
  locator, avoiding the "matches every ancestor" bug class documented
  elsewhere in this list.
- `e2e/estimating-flow.spec.ts` (2026-07-06) — drafts an estimate,
  pastes a material list, classifies one line as `beam` with a size and
  waits (via an admin-client poll, not a UI timing guess) for that write
  to land before the next edit — the two go through the same
  "read-current-then-recompute" path in `updateMaterial`, so firing them
  back-to-back without waiting would race — then confirms the Labor
  column recomputes to the expected value. Confirms the Estimate tab's
  stats/breakdown/history, exercises the what-if crew-count input,
  saves an estimate, converts the draft to active, and confirms it
  moves from the estimating list to the real Projects list. A second
  test exercises the labor-standards editor and the "recompute crew
  rates" button. Adding Task/Size/Labor columns to the materials grid
  shifted `project-flow.spec.ts`'s positional `td`/`input` indices — a
  real regression this spec's own author (not a coincidence) caused;
  fixed by adding `data-testid`s to every materials-grid cell
  (`material-name-`, `material-task-`, `material-size-`,
  `material-needed-`, `material-received-`, `material-assigned-`,
  `material-left-`, `material-to-order-`, `material-labor-`,
  `material-qty-{materialId}-{rowId}`) and rewriting that test to use
  them instead of raw indices, so the next column addition won't repeat
  this.
- `e2e/layout-interaction-flow.spec.ts` (2026-07-06) — scoped to what the
  interaction rework (ADR-031) actually changed, not a re-test of
  `row-workspace.spec.ts`'s existing draw/select/resize/undo-redo
  coverage (confirmed still green, unmodified, throughout this rework):
  no mode-toggle buttons render; a plain click and Escape both deselect;
  a shift-drag marquee selects multiple rows at once; a middle-mouse-
  button drag directly over a row leaves its DB geometry completely
  unchanged while visibly shifting its on-screen position (proving the
  canvas panned, not the row); and — the actual bug fix — a dragged
  row's on-screen position is already correct immediately after drop
  (no wait, no poll) and stays exactly there once the write is confirmed
  server-side. Caught one bug in the test itself while writing it: an
  "empty space" click computed relative to the outer viewport landed
  outside the actual (smaller, letterboxed) stage rectangle and hit
  nothing — fixed by computing it relative to the drawing image's own
  bounding box instead.
- `e2e/dashboard-flow.spec.ts` (2026-07-06) — creates a project with a
  genuine shortage via a direct admin insert (`total_needed=100,
  received=20`), not the "Paste from packing slip" UI flow — that
  action sets `received = total_needed` by design (it assumes the
  pasted list IS what shipped), which would make `to_order` 0 and never
  produce a shortage to test against. Confirms the shortage and an open
  blocker both render on the dashboard, resolves the blocker via the
  UI and confirms both the list update and `blockers.resolved_at`
  landing in the DB, clicks "email now" and confirms a real
  Resend-backed result renders (not a stub — this environment's real
  `RESEND_API_KEY` is exercised), and downloads the closeout PDF via
  `page.request` (shares the page's own authenticated cookies
  automatically, unlike the standalone `request` fixture, which starts
  a separate cookie-less context) confirming real, non-empty bytes
  starting with the `%PDF-` header. Found and fixed a real, pre-existing,
  intermittent flake in `packing-slip-extract-flow.spec.ts` while
  running the full suite alongside this new spec: `PackingSlipExtractDialog`
  legitimately renders twice for the same slip (the fresh-upload
  confirmation, and the persistent uploaded-slips list which re-fetches
  immediately after upload) — the test's role-based locator had always
  been ambiguous, just reliably timing-lucky in isolation; fixed with
  an explicit `data-testid` on the fresh-upload instance.

- `e2e/materials-lifecycle-flow.spec.ts` (2026-07-06) — create a
  project, draw a row, add a material, then edit its Profile and
  Condition fields via the new `data-testid`-scoped locators and confirm
  each persists. Receiving: confirms the reorder list starts empty (a
  pasted material list sets `received = total_needed` by design, so a
  real shortfall needs a direct admin edit down, not the paste flow
  itself), logs a `'received'` check-in for the shortfall and polls the
  DB for `materials.received` to actually increment, logs a `'damaged'`
  flag and confirms it renders as flagged, then expands the History
  disclosure and confirms both entries appear newest-first. Row
  readiness: confirms a fresh row defaults to `blocked`, checks all
  three inputs, and polls the DB for all three columns to land. Scheduler
  warning: builds a real schedule first (assign buttons only render on
  days already in the built schedule), forces the row back to
  `materials_ready: false` for a deterministic check, and confirms
  `window.confirm()` fires with a message naming the row as blocked —
  the row-picker button itself is matched with `getByRole("button", {
  name: /Row 1/ })` (a regex, not exact text) since a blocked row's
  accessible name is prefixed "⚠ Row 1".
  - **A third distinct Playwright dialog-handling shape**, beyond the
    two already documented for this suite: `AssignCrewForm.handleSubmit`
    calls `window.confirm()` with **no preceding `await`** (unlike the
    crew calendar's `assignOrMove`, which awaits `checkDoubleBooking()`
    first). A synchronous-from-the-click dialog means `.click()` itself
    will not resolve until the dialog is handled — so the calendar
    test's own working pattern, `Promise.all([page.waitForEvent("dialog"),
    click()])`, **deadlocks** here: `click()` can't resolve without
    `dismiss()`, and `dismiss()` never runs because `Promise.all` is
    still awaiting `click()`. Fixed by registering `page.once("dialog",
    handler)` *before* the click, then `await`-ing the click alone (not
    wrapped in `Promise.all`) — the listener fires independently of the
    click's own promise and unblocks it.
  - Regression found and fixed in `estimating-flow.spec.ts`: adding the
    Condition column gave each materials-grid row a second `<select>`,
    making its bare `row.locator("select")` ambiguous — fixed with the
    existing `material-task-{id}` `data-testid` instead of a positional
    locator.
  - Regression found and fixed in `scheduler-flow.spec.ts`: two stray
    crews (`[E2E] Materials lifecycle crew <timestamp>`) leaked from
    earlier failed runs of this same new spec (each failure happened
    before reaching its own `afterAll` cleanup, back when the dialog
    deadlock above was still unfixed) and broke a `.locator("div",
    {hasText: CREW_NAME}).first()` locator once more than one crew
    existed on the page (`.first()` in document order matched an
    unrelated outer container, not the intended crew card — the same
    "matches every ancestor" bug class as `phases-flow.spec.ts`'s and
    `team-settings-flow.spec.ts`'s own entries above). Fixed by deleting
    the two stray crews via a one-off admin-client script, not by
    changing the now-fixed test.
- `e2e/import-bulk-flow.spec.ts` (2026-07-06) — creates a project, draws
  a row, imports a materials CSV (headers `Name,Total needed,Condition`
  auto-map with zero manual mapping-select interaction, confirming the
  guesser works on the common case), imports a row-assignments CSV
  (`Row,Material,Qty`) and polls the DB for the resulting
  `row_materials.required_qty`, bulk-sets both imported materials'
  condition and polls the DB, bulk-deletes one (via the same
  `page.once("dialog", ...)`-before-click pattern as
  `materials-lifecycle-flow.spec.ts`'s scheduler-warning test, since
  `MaterialsGrid`'s bulk-delete also calls a synchronous
  `window.confirm()`), then draws a second row and duplicates both as a
  block (`Duplicate range ×N`), confirming 4 rows exist both on-screen
  and in the DB.
  - **A genuine test-only race found while writing this spec**: the
    "duplicate range" step navigates back to the Layout tab (a fast
    client-side route change, unlike the initial upload) and draws
    immediately — the very first run intermittently read the drawing
    image's bounding box *before* zoom/pan's "fit to screen" `useEffect`
    had recomputed it, silently drawing (or, worse, entirely failing to
    draw) against the image's un-fitted natural size. Polling the
    bounding box for two consecutive stable reads did not reliably fix
    this. Fixed by clicking the real "Fit to screen" toolbar button
    first — its click handler recomputes the fit synchronously, so
    there's no effect-timing race left to lose.
- `e2e/drawing-versioning-flow.spec.ts` (2026-07-06) — uploads a first
  drawing and confirms it's auto-approved at v1 with no warning banner,
  uploads a second version via the version panel's own file input and
  confirms it becomes v2/pending with the warning banner now visible,
  approves it and confirms the badge flips and the banner clears, then
  expands the version-history disclosure and confirms both entries
  render. Scopes every "v1"/"v2" assertion through a dedicated
  `drawing-version-badge` `data-testid` and, for the history log, reads
  `innerText()` on the already-uniquely-scoped `drawing-history-{id}`
  element rather than a second round of `getByText()` calls — "v1"/"v2"
  legitimately appear twice on the page once history is expanded (the
  top badge and the entry's own label), so a bare `getByText("v2", {exact:
  true})` would be a strict-mode violation, the same "matches more than
  one real element" class of issue as elsewhere in this list, caught
  before it ever became a flaky failure rather than after.
- Regression found and fixed in `multi-page-flow.spec.ts`: a bare
  `input[type="file"]` locator became ambiguous once the new drawing-
  version panel gave any project with an existing drawing a *second*
  file input on the same Layout tab — fixed with new
  `drawing-upload-input`/`drawing-version-upload-input`
  `data-testid`s on the two inputs, used here and in this sub-phase's
  own new versioning spec.
- Regression found and fixed in `estimating-flow.spec.ts`: the
  materials grid's new leading bulk-select checkbox shifted every
  subsequent `<input>`'s position, breaking a positional
  `row.locator("input").nth(1)` (previously the Size input, now the
  Name input) — fixed with the existing `material-size-{id}`
  `data-testid`, the same lesson ADR-030 already logged once for a
  different column addition.
- Regression found and fixed in `field-flow.spec.ts` (mobile viewport)
  and `layout-interaction-flow.spec.ts`: the new drawing-version panel's
  added height pushed the canvas further down the page, leaving parts
  of it below the fold — a raw `page.mouse.move/down/up` sequence,
  unlike a locator `.click()`, never auto-scrolls its target into view.
  Fixed by calling `scrollIntoViewIfNeeded()` on the drawing image
  before reading its bounding box for pointer math, in both specs.
- `e2e/customer-portal-flow.spec.ts` (2026-07-06) — seeds a day-log
  note + photo (a synthetic image uploaded directly to the
  `daily-photos` bucket via the admin client, same throwaway-screenshot
  technique as `team-settings-flow.spec.ts`'s logo upload) and a
  throwaway shortage material via the admin client, generates a share
  link from the new Portal tab, approves the photo, then navigates to
  the real public `/portal/[token]` page (looking the token up in the
  DB, not scraping it from the office UI's own copy button) and
  confirms the project name/status/%/note/photo all render while the
  shortage material's name and the words "to order"/"reconciliation"
  never appear anywhere on the page. Revokes the link and confirms the
  public page falls back to the friendly invalid-link message.
  - **Found a real bug in the test itself while writing it**: the
    share-link status badge is styled with a plain CSS `capitalize`
    class over a lowercase literal ("active"/"revoked") — an unscoped
    `getByText("Active", {exact:true})` assertion had been silently
    matching the *wrong* element (the project header's own status
    pill, which genuinely is capitalized text, not CSS-transformed) and
    passing for the wrong reason; the bug only surfaced once a later
    `getByText("Revoked", ...)` assertion had no same-named decoy
    element to accidentally match and failed outright. Fixed both to
    check the actual lowercase DOM text, scoped to the specific token's
    own row (`page.locator("li").filter({hasText: "/portal/"})`) rather
    than an unscoped page-wide match.

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
7. `add_row_progress_ordering.sql` — `row_progress` gains `rows.created_at`
   (deterministic paint/click order for overlapping rows).
8. `batch3_estimating_readiness_versions.sql` (2026-07-06) — richer
   `materials` identity (`profile`/`capacity`/`condition`/
   `compatible_system`); `material_receipts` (append-only receiving log);
   `rows` readiness inputs (`materials_ready`/`area_accessible`/
   `drawing_approved`) plus a derived `crew_assigned` and computed
   `readiness_status` on `row_progress`; `drawing_versions` (upload
   history + approval-for-install, parallel to the existing `drawings`
   current-pointer table); `labor_standards` (org-scoped, seeded
   defaults) and `project_estimates` (append-only) for the estimation
   engine; `notifications` (per-user in-app inbox).
9. `org_settings_crew_assignment.sql` (2026-07-06) — `organizations.
   address`/`logo_path`/`default_working_days`; `profiles.crew_id`; the
   `org-logos` bucket; an `organizations_update` RLS policy (owner/pm).
10. `self_update_full_name.sql` (2026-07-06) — `update_own_full_name`
    RPC (see ADR-027 for why a narrow `security definer` function, not a
    broader RLS policy).
11. `day_log_photos.sql` (2026-07-06) — `day_logs.photo_paths text[]`.
    Initially blocked by a transient Supabase-platform-side error (see
    ADR-028); applied cleanly once the platform issue cleared later the
    same day, confirmed via a live E2E run.
12. `estimation_brain.sql` (2026-07-06) — `materials.task_key text`
    (free text, no CHECK — app-enforced against `labor_standards`, same
    relationship `crew_rates.task_key` already has); `projects.status`
    CHECK gains `'estimate'` as a fourth value, for pre-sale draft
    projects (see ADR-030). Everything else the estimation engine needed
    (`materials.labor_units`/`.size`, `crew_rates`, `labor_standards`,
    `project_estimates`, `projects.planned_days`) already existed from
    earlier migrations.

### Tables

Every table is scoped to an `organizations` row, directly (`org_id`) or
transitively via `project_id` → `projects.org_id` or `crew_id` →
`crews.org_id`.

| Table                                    | Scoped via                    | Purpose                                                                                                                                                                                                                                     |
| ---------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organizations`                          | —                             | Tenant boundary. One per Handy Equip-style deployment (see auth bootstrap below); multi-org support exists in the schema but isn't exercised yet. `address`/`logo_path`/`default_working_days` added 2026-07-06 (Org Settings) — was read-only for every role until then. |
| `profiles`                               | `org_id` (nullable)           | One row per `auth.users`, `role` ∈ `owner`/`pm`/`scheduler`/`crew`. `crew_id` (nullable, 2026-07-06) — a user's home crew, assigned from `/app/team`.                                                                                        |
| `projects`                               | `org_id`                      | A racking-install job. `status` ∈ `estimate`/`active`/`on_hold`/`complete` (`estimate` added 2026-07-06 for pre-sale drafts on the company estimating screen — see ADR-030). `planned_days` (Scheduler target math) and `mark_drawing_id` (the one markable page — see below) added 2026-07-03.                                                         |
| `crews` / `crew_members`                 | `org_id` / via `crews`        | Install crews and their members (Scheduler sub-phase).                                                                                                                                                                                      |
| `drawings`                               | `project_id`                  | One row per rendered page (`page_index` 0-based) of an uploaded layout PDF/image. `storage_path` points into the private `drawings` bucket. `role` ∈ `reference`/`marking` — see below.                                                     |
| `packing_slips`                          | `project_id`                  | Uploaded packing-slip files; `parsed` reserved for future OCR/extraction.                                                                                                                                                                   |
| `materials`                              | `project_id`                  | The job's material catalog — `total_needed` (job total) and `received` (from packing slips) live here; per-row requirements live in `row_materials`. `size`/`labor_units` (2026-07-03) and `profile`/`capacity`/`condition`/`compatible_system` (2026-07-06, richer identity for the estimating/receiving work) added since. `task_key` (2026-07-06) classifies a material against `labor_standards`, so `labor_units` computes size-aware instead of resting at its bare default — see ADR-030. |
| `material_receipts`                      | via `materials`                | Append-only receiving event log (2026-07-06) — `status` ∈ `ordered`/`received`/`verified`/`staged`/`short`/`damaged`/`wrong`, each row a fact ("N units reached this status"), not a single mutable state. `materials.received` stays the fast-read aggregate; a receiving check-in (sub-phase F) keeps both in sync. |
| `rows`                                   | `project_id` (+ `drawing_id`) | A marked rack section on a drawing page. `x/y/w/h` are **normalized 0..1** fractions of the drawing's rendered size, so marks stay correct at any zoom/display size. `phase_id` (nullable, 2026-07-03); `materials_ready`/`area_accessible`/`drawing_approved` readiness inputs (2026-07-06) — `crew_assigned` is deliberately NOT a column here, it's derived in `row_progress` from `assignments`.                                |
| `row_materials`                          | via `rows`                    | Required qty of a material for a specific row. `unique(row_id, material_id)`.                                                                                                                                                               |
| `installs`                               | via `rows`                    | Append-only log of installed qty per row/material/date. `qty` may be negative (a correction entry) — never edit history in place. `idempotency_key` (unique, nullable) + `device_id` added 2026-07-03 for the field app's offline queue.    |
| `phases`                                 | `project_id`                  | A named, colored grouping of rows — `color` renders on the drawing, `sort_order` controls legend/list order.                                                                                                                                |
| `blockers`                               | `project_id`                  | A logged reason work stopped — `code` is one of 10 fixed values, plus note/photo. `resolved_at` null until cleared.                                                                                                                         |
| `day_logs`                               | `project_id`                  | One row per crew/project/day (`unique(project_id, crew_id, work_date)`), filled in progressively and updated (not re-inserted) as the day closes out.                                                                                       |
| `assignments` / `targets` / `crew_rates` | `project_id` / `crew_id`      | Scheduling. Created in Phase 2 so FKs were clean from day one; built out by the Scheduler sub-phase. `crew_rates` (`crew_id`, `task_key`, `units_per_hour`, `samples`) sat unused until Batch 3 sub-phase D's `recomputeCrewRates` started actually learning and reading it — see ADR-030. |
| `project_schedule`                       | `project_id`                  | Presence of a row = a scheduled working day (`unique(project_id, work_date)`) — a date range can be picked and specific days skipped without a separate flag.                                                                               |
| `drawing_versions`                       | `project_id`                  | Upload history for a page (2026-07-06) — `drawings` stays the current pointer per page (rows.drawing_id keeps referencing it; same `id` across re-uploads), this is the parallel version/approval history. `approved_for_install` gates whether a version is considered safe to mark/install against. |
| `labor_standards`                        | `org_id`                       | Size-normalized labor baseline (2026-07-06) — `base_labor_units` (hours/unit at a standard pace) per `task_key`, seeded with reasonable defaults per org, editable from `/app/estimate`. Feeds `materials.labor_units` computation directly and `crew_rates`' standard-pace fallback (1.0) indirectly — see ADR-030. |
| `project_estimates`                      | `project_id`                  | Append-only estimate log (2026-07-06), like `installs` — recomputing inserts a new row rather than overwriting, so an estimate's history over a project's life isn't lost. Latest row = current estimate.                                   |
| `notifications`                          | `org_id` (+ `user_id`)         | Per-user in-app inbox (2026-07-06) — `select`/`update`/`delete` are strictly own-row (`user_id = auth.uid()`), unlike every other table here which is org-wide-readable; `insert` is org-scoped only, since a Server Action running as the caller creates notifications addressed to *other* org members. |
| `share_tokens`                           | `project_id`                  | Customer portal tokens (project_id/token/scope/expires_at existed since Phase 2; `revoked_at` added Batch 3 Sub-phase H). Not publicly RLS-readable — see below.                                                                                                                                                                    |
| `approved_photos`                        | `project_id`                  | Customer-visible photo curation (2026-07-06) — keyed by the photo's own `storage_path` (`unique(project_id, storage_path)`), sourced from either `day_logs.photo_paths` or `blockers.photo_path`. Nothing is customer-visible until explicitly approved here; see Customer portal section below. |

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

**Drawing version history (2026-07-06):** `drawing_versions` tracks every
upload for a page as its own row (`unique(project_id, page_index,
version)`), independent of `drawings` — re-uploading a page is meant to
insert a new version, mark the prior one `superseded_at`, and update the
existing `drawings` row's `storage_path` in place (same `id`, so
`rows.drawing_id` FKs never break). Existing drawings were backfilled as
version 1, pre-approved. The versioning UI itself (upload-as-new-version,
approve, supersede warnings) is sub-phase G scope — this migration only
lays down the schema.

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

**New tables (2026-07-06):** `material_receipts` and `drawing_versions`
mirror the access shape of the tables they extend (`materials`/`drawings`
— owner/pm write, org reads). `labor_standards` and `project_estimates`
follow `crew_rates`/`targets`'s existing owner/pm/scheduler-write shape
(estimating is scheduling-adjacent). `notifications` is the one table
that's **not** org-wide readable — `select`/`update`/`delete` require
`user_id = auth.uid()` (a personal inbox, not a shared feed); `insert`
only requires `org_id = current_org_id()`, since a Server Action running
as the calling user needs to create notifications addressed to someone
else in the org.

`share_tokens` is deliberately **not** readable via any anon RLS policy —
the customer portal (Batch 3, Sub-phase H) reads it through
`lib/portal/public.ts` using `lib/supabase/admin.ts` (service role,
bypasses RLS), never directly from the browser. Same posture for the new
`approved_photos` table (owner/pm read+write; the portal reads it via the
same admin-client module, not a dedicated anon policy).

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

**Row readiness (2026-07-06):** `row_progress` gains `materials_ready`/
`area_accessible`/`drawing_approved` (straight from `rows`), a derived
`crew_assigned` (`true` when an `assignments` row with `work_date >=
current_date` covers this row directly or via a whole-project
assignment — phase-scoped assignments already resolve to individual
per-row rows at assignment time, see ADR-022, so both assignment shapes
reduce to this one check), and a computed `readiness_status`:
`'complete'` if already fully installed (readiness stops mattering once
done); else `'blocked'` if materials aren't ready or the area isn't
accessible (the two *physical* prerequisites); else `'ready'` if every
prerequisite — physical and administrative (drawing approval, crew
assigned) — is met; else `'partial'`. Scheduler/dashboard work (later
sub-phases) reads this directly rather than recomputing it.

### Storage

Four private buckets: `drawings` and `packing-slips`, path convention
`{project_id}/{filename}`; `daily-photos` (added 2026-07-03), path
convention `{project_id}/{date}/{crew_id}/{filename}` — the extra path
segments don't change the org-scoping check below, since it only ever
looks at the _first_ segment; `org-logos` (added 2026-07-06), path
convention `{org_id}/{filename}` — org-scoped directly rather than via
`org_id_of_project()`, since a logo isn't project-scoped at all. RLS
policies on `storage.objects` derive the owning project from the first
path segment
(`(storage.foldername(name))[1]::uuid`) and check it against
`current_org_id()`. `daily-photos` allows INSERT from any org role
(crew uploads photos in the field); `drawings`/`packing-slips` stay
owner/pm-only for writes. The app always reads via short-lived signed URLs
(`lib/supabase/server.ts` → `storage.from(bucket).createSignedUrl(...)`),
never public bucket URLs.

### Types

`lib/supabase/database.types.ts` was hand-written to match the migrations
exactly through Batch 2 (no linked project/Docker available at the time —
see ADR-010). As of 2026-07-06, the project is linked and a
`SUPABASE_ACCESS_TOKEN` is available, so this is now genuinely
**generated** via `npx supabase gen types typescript --project-id <ref>`,
then hand-adjusted in two ways every regeneration needs to reapply: (1)
CHECK-constrained columns get this codebase's own literal union types
(`ProfileRole`, `DrawingRole`, `BlockerCode`, `MaterialCondition`,
`MaterialReceiptStatus`, `RowReadinessStatus`) in place of the
generator's plain `string` — Postgres CHECK constraints don't reach the
generated types at all, so this is an intentional improvement, not a
discrepancy (ADR-010); (2) the three views' `Row` types get their
genuinely-guaranteed-non-null columns un-nullabled — the generator
conservatively marks every view column nullable since it can't prove
otherwise from arbitrary view SQL, but e.g. `row_progress.pct` is wrapped
in `coalesce(...)` and can never actually be null. The file's own header
comment documents both adjustments. All four client factories
(`lib/supabase/{client,server,admin,proxy}.ts`) are generic over
`Database`.

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
