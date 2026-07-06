# Build log

Engineering journal. Newest entries at top.

---

## 2026-07-06 — Batch 4 kickoff + Sub-phase 0: PM Operating Layer schema

**What:** Batch 4 begins — the "PM Operating Layer," designed against
a real ~$200K project ("iBuy") that ran two weeks over for five
specific reasons (scope never captured, no owner, bad material found
mid-install, customer left in the dark, everything in one manager's
head). Sub-phase 0 is the schema for the whole batch: a reusable
8-stage gate template (handoff/scope/schedule/materials/mobilize/
execute/punch/closeout) copied per-project at creation, scope-of-work
beyond install, the sales→ops handoff survey, change orders, a
customer-comms audit log, hard crew-capacity settings, and the
closeout autopsy. Full reasoning in `docs/DECISIONS.md` ADR-037;
summary here.

**Credentials check (per this batch's own instruction to ask up front):**
none needed — Supabase access token, `RESEND_API_KEY`, and
`ANTHROPIC_API_KEY` were all already secured and deployed during
Batch 3. Batch 4 can run start to finish without a new credential gate.

**Build:** One migration (`20260707000000_batch4_operating_layer.sql`):
ten new tables (`gate_templates`, `gate_template_stages`,
`gate_template_items`, `project_stages`, `project_gate_items`,
`scope_items`, `handoff_surveys`, `change_orders`, `project_comms`,
`project_autopsies`), three new RLS helper functions, seven new
columns on `projects` (`pm_user_id`, `stage_key`, `last_activity_at`,
`customer_contact_name`, `customer_contact_email`,
`comms_weekly_report`, `comms_milestones`), one new column on
`organizations` (`num_crews`). RLS gives crew read-only access to
stage/scope tables, owner/pm full manage, and — per the brief's own
specific instruction — scheduler a narrow write exception scoped to
just the Schedule stage's own rows, not every stage. Seeded one
default gate template per existing org with the batch's own verbatim
29-item starter checklist (transcribed from the brief, not
paraphrased) so every org has a real, usable template from day one —
confirmed live: 1 template, 8 stages, 29 items. Types regenerated and
hand-adjusted with 8 new literal-union types
(`GateStageKey`/`ProjectStageStatus`/`ScopeWorkType`/`ScopeSource`/
`ChangeOrderReason`/`ChangeOrderStatus`/`CommsKind`/`CommsChannel`),
following the existing ADR-010 pattern.

**Deliberately deferred:** backfilling existing projects' OWN
`project_stages`/`project_gate_items` rows — unlike the template
(seeded now, since it's org-wide and needs no per-project judgment),
giving each existing, already-in-progress project a realistic current
stage and marking its genuinely-complete earlier stages `overridden`
requires actual judgment this migration shouldn't guess at. That's
sub-phase J's explicit job; sub-phase A's own data-access layer will
lazily create a project's stage rows from the current template the
first time they're needed, covering both brand-new and not-yet-touched
pre-Batch-4 projects in the meantime.

**Verified:** `npm run lint`/`typecheck`/`build` all green. Full E2E
suite green: 26 passed, 2 intentionally skipped — zero changes needed
to any existing code, confirming this migration is purely additive
(nothing yet reads/writes any of the new schema; that starts with
sub-phase A).

---

## 2026-07-06 — Batch 3 sub-phase I: Polish/QA/perf pass + production deploy (Batch 3 complete)

**What:** The final Batch 3 sub-phase — loading/empty/error states,
mobile pass, accessibility basics, performance at scale, and getting
production genuinely fully configured and redeployed. Full reasoning
in `docs/DECISIONS.md` ADR-036; summary here.

**Audit first:** dispatched a research agent to map the whole app for
missing `loading.tsx` files, error-boundary gaps, accessibility misses,
and performance risk points, every finding with an exact file:line
reference. Then fixed what was concrete and proportionate:

- **Error boundaries:** new root `app/error.tsx` — Next excludes a
  segment's own `layout.tsx` from that segment's `error.tsx`, so a
  failure in `app/(protected)/layout.tsx` itself was never actually
  caught, and `/portal/[token]` (public, outside `(protected)`
  entirely) had no error boundary anywhere. Shows a generic message,
  not `error.message` — unlike `(protected)/error.tsx`, this can fire
  before we know who's asking.
- **Accessibility:** `aria-label` added to 5 icon/glyph-only buttons
  (materials-grid delete, packing-slip-extract remove, field material-
  stepper's +/− buttons) and to `site-header.tsx`'s main `<nav>`.
- **Performance:** `listActiveProjectsForDashboard` was deliberately
  N+1 (per-project targets/actuals/estimate fetches, ~4 round trips ×
  active-project-count) to guarantee identical SPI numbers to the
  per-project Scheduler page — rewrote it to batch-fetch everything via
  `.in(...)` and group in memory, then call the exact same, unchanged
  `computeProjectSpi` per project — zero drift risk, far fewer round
  trips. `RowFillMarker` (renders every row on the marking canvas)
  wrapped in `React.memo` — every prop is a primitive, so this is a
  free, safe win for large drawings.
- **Loading states:** new shared `components/loading-panel.tsx` +
  `loading.tsx` for the 5 heaviest routes (scheduler/[projectId],
  materials, field/[projectId], dashboard, mark).

**Real mobile-layout bug found and fixed via a live 390px-viewport
pass** (screenshotted every major screen, not simulated): `app/
(protected)/layout.tsx`'s `<main>` had no `min-w-0`, so a flex item
containing the materials grid's wide table refused to shrink below the
table's intrinsic width — the *entire page* went wider than the
viewport on any project with materials, not just the grid itself. One
root-level fix instead of patching every wide-content page individually.
Also fixed: a long packing-slip filename with no `break-all` causing
the same class of overflow, and a non-wrapping control row on the Team
page.

**Vercel production, brought fully in line:** confirmed via `vercel env
ls production` that only the three original Phase-1 env vars were
live — `RESEND_API_KEY`, `CRON_SECRET`, `ANTHROPIC_API_KEY` (all added
locally during Batch 3) had never been pushed, silently degrading
emailed reports, the cron routes, and every AI feature in production.
Pushed all three directly via the Vercel CLI (piped from `.env.local`,
never printed), then ran `vercel deploy --prod` — env var changes don't
retroactively apply to an already-built deployment. Verified live:
`/login` 200, `/manifest.webmanifest` 200, `/sw.js` 200, and the cron
route's bearer check now correctly 401s an unauthenticated request
(previously a no-op before `CRON_SECRET` existed).

**Bug found via the full E2E suite (test-only):** the new
`aria-label`s on `material-stepper.tsx`'s quantity buttons changed
their accessible name from the bare "+"/"−" glyph to "Increase/Decrease
quantity" — correct, but broke `field-flow.spec.ts`'s locator, which
had been matching the glyph itself. Fixed the test to match the real,
new accessible name.

**Verified:** `npm run lint`/`typecheck`/`build` all green. Full E2E
suite green: 26 passed, 2 intentionally skipped — including
`dashboard-flow.spec.ts`, confirming the batched dashboard rewrite
produces identical results to the original N+1 version.

**Batch 3 is now complete** — sub-phases 0 through I all done and
verified live. See the closing Batch 3 report for the full NEEDS-YOU
list and the iBuy self-review.

---

## 2026-07-06 — Batch 3 sub-phase H: Customer portal

**What:** A public, unauthenticated, read-only customer status page at
`/portal/[token]` — project name, % complete, most recent update, next
planned milestone, and only office-approved photos. Never shortages,
costs, reconciliation, or internal notes. A new "Portal" project tab
(office-side, owner/pm) to generate/revoke share links and to approve
which photos (from day logs or blockers) are customer-visible. Full
reasoning in `docs/DECISIONS.md` ADR-035; summary here.

**Build:** One migration (`20260706193100_customer_portal.sql`):
`share_tokens.revoked_at` (the `share_tokens` table itself — project_id/
token/scope/expires_at — already existed in full since Phase 2, RLS
already anticipating "the portal reads this via service_role") and a new
`approved_photos` table (keyed by `storage_path`, `unique(project_id,
storage_path)`), RLS owner/pm both ways. Types regenerated and
hand-adjusted (new `PhotoSource` literal union). New `lib/portal/public.ts`
(admin client — the public route has no session for RLS to scope
against, narrow selects throughout so shortage-adjacent columns never
leak) and `lib/portal/{queries,actions}.ts` (RLS-scoped, office UI
only). New `components/portal/share-link-panel.tsx` +
`photo-approval-panel.tsx`. Rewrote the Phase-1 `/portal/[token]`
placeholder into a real page (valid token → real project data; invalid/
expired/revoked → one friendly "this link is no longer valid" message,
deliberately not distinguishing why). "Next milestone" reuses
`projects.deadline`, falling back to the latest saved
`project_estimates.forecast_finish` — no schema/computation invented
for this, since neither concept needed to be new.

**Verified:** `npm run lint`/`typecheck`/`build` all green. New
`e2e/customer-portal-flow.spec.ts`: seeds a day-log note + photo and a
throwaway material shortage via the admin client, generates a share
link from the new Portal tab, approves the photo, then loads the real
public `/portal/[token]` page and confirms the note/photo/% render
while the shortage material name, "to order," and "reconciliation"
never appear anywhere on the page — then revokes the link and confirms
the public page falls back to the friendly invalid-link message.

**Bug found via this new spec (test-only):** the share-link status
badge's CSS `capitalize` class only changes how "active"/"revoked"
*look*, not the actual lowercase DOM text `getByText()` matches — an
unscoped assertion had been silently passing against the wrong element
(the project header's own, properly-capitalized status pill) rather
than the token badge itself. Fixed both assertions to check the
lowercase text, scoped to the token's own row.

**Full suite green:** 26 passed, 2 intentionally skipped.

---

## 2026-07-06 — Batch 3 sub-phase G: CSV/XLSX import, row-range duplication, materials bulk ops, drawing versioning

**What:** Import a materials list or a row×material assignment sheet
from a CSV/XLSX file (column mapping + preview + confirm); duplicate a
multi-row selection as a repeating block ("rows 1-10" → "rows 11-20");
bulk-select materials to delete or set condition in one action; and a
real drawing-versioning UI (upload a new version, approve for install,
a warning banner when the latest version isn't approved yet, version
history) on top of sub-phase 0's previously-unused `drawing_versions`
table. Full reasoning in `docs/DECISIONS.md` ADR-034; summary here.

**Build:** No schema migration — every table this sub-phase touches
already existed. Installed `exceljs` + `papaparse` (NOT the `xlsx` npm
package, which carries an unpatched high-severity advisory). New
`lib/projects/parse-spreadsheet.ts` (browser-only CSV/XLSX → headers+rows,
plus a header-to-field auto-guesser). New
`components/projects/import-materials-dialog.tsx` — one dialog, a
materials/row-assignments mode toggle, live column mapping, a preview
table with per-row OK/skip status. New `lib/projects/actions.ts#importMaterials`;
row-assignment import resolves against the project's own already-loaded
rows/materials client-side (never auto-creates either) and commits via
the existing `upsertRowMaterialQtyMany` — no new action needed there.
New `components/projects/duplicate-range-dialog.tsx` + a
`handleDuplicateRange` in `row-marking-workspace.tsx` that calls the
existing `duplicateRows` action once per selected row with N
pre-offset copies — no new Server Action needed for this either. New
bulk-select checkboxes + action bar in `materials-grid.tsx`, backed by
new `deleteMaterialsBatch`/`bulkSetMaterialCondition` actions. New
`lib/drawings/{queries,actions}.ts` (`listDrawingVersionsByProject`,
`uploadDrawingVersion`, `approveDrawingVersion`) +
`components/projects/drawing-version-panel.tsx`; `recordDrawingUpload`
now also seeds a version-1 row for every newly uploaded page.

**Caught and fixed my own lint violation before it shipped:**
`DuplicateRangeDialog`'s "re-derive defaults when the dialog (re)opens"
logic first called `setState` inside a `useEffect` body — the exact
`react-hooks/set-state-in-effect` violation this session already hit
once and documented (layout editor snap-back fix). Fixed with the same
React-docs-sanctioned pattern: mirror the previous `open` prop in state,
call `setState` conditionally during render when it changes, no effect
at all.

**Two real test-only bugs found via the new specs, both documented in
ADR-034:** (1) a fast client-side tab navigation can read the drawing
image's bounding box before zoom/pan's "fit to screen" effect has
recomputed it — invisible in every existing test because they all
reach the canvas through a slow upload round trip that masks the race
by accident. Fixed by explicitly clicking "Fit to screen" (synchronous)
before computing pointer math, not by polling/waiting. (2) the new
drawing-version panel's added height pushed the canvas further down
the page, leaving it partly below the fold on a mobile viewport and in
a later step of an existing spec — raw `page.mouse` coordinates don't
auto-scroll the way a locator `.click()` does. Fixed with
`scrollIntoViewIfNeeded()` in both affected specs.

**Also fixed two regressions this sub-phase's own UI changes caused in
other, pre-existing tests** (same "shifted a positional/bare locator"
lesson as ADR-030, recurring): `multi-page-flow.spec.ts`'s bare
`input[type="file"]` locator became ambiguous once a project's Layout
tab could have two file inputs (drawing upload + version upload) —
fixed with new `data-testid`s on both. `estimating-flow.spec.ts`'s
positional `row.locator("input").nth(1)` shifted once the materials
grid gained a leading checkbox column — fixed with the existing
`material-size-{id}` `data-testid` instead.

**Verified:** `npm run lint`/`typecheck`/`build` all green. New
`e2e/import-bulk-flow.spec.ts` (CSV materials import → CSV row-assignment
import → bulk set-condition → bulk delete → duplicate range) and
`e2e/drawing-versioning-flow.spec.ts` (v1 auto-approved → new version
pending → warning banner → approve → history log). Full suite green:
25 passed, 2 intentionally skipped.

---

## 2026-07-06 — Batch 3 sub-phase F: Material status lifecycle, reorder list, row readiness

**What:** A new Receiving project tab (check materials in against a
per-status log — ordered/received/verified/staged/short/damaged/wrong —
with a reorder list and a per-material expandable history), row
readiness inputs (materials ready / area accessible / drawing approved,
surfaced as a colored dot on the drawing and a status badge), a
scheduler warning before assigning a crew to a row still flagged
blocked, and four new identity columns on the Materials grid (Profile,
Capacity, Condition, System). Full reasoning in `docs/DECISIONS.md`
ADR-033; summary here.

**Build:** No schema migration — sub-phase 0 already shipped
`material_receipts`, the `rows` readiness columns, `row_progress.
readiness_status`, and the richer `materials` columns; this sub-phase
is entirely UI + Server Actions on top of what already existed.
New `lib/materials/{queries,actions}.ts` (`recordMaterialReceipt`,
`getMaterialReceiptTotals`, `listMaterialReceiptHistoryByProject`).
New `components/materials/receiving-panel.tsx` +
`app/(protected)/app/project/[id]/receiving/page.tsx`. New
`components/projects/row-readiness-panel.tsx`, wired into
`row-command-panel.tsx`/`row-marking-workspace.tsx` (full undo/redo
support, same pattern as every other row edit) and into
`row-fill-marker.tsx` (a corner dot on both the editable and read-only
drawing views). `lib/rows/actions.ts` gained `updateRowReadiness`.
`assign-crew-form.tsx` now checks target rows' `readiness_status`
before submitting and warns by name if any are blocked.

**Two real bugs found and fixed along the way, both documented in
ADR-033:** (1) the readiness checkboxes snapped back to their stale
state on click — same class of bug as the layout editor's move/resize
snap-back (ADR-031), same fix (local `useState` seeded from props,
updated optimistically). (2) `AssignCrewForm`'s `window.confirm()` is
called with no preceding `await`, which deadlocks the calendar test's
own `Promise.all([waitForEvent, click()])` pattern — fixed by
registering `page.once("dialog", ...)` before the click and awaiting
the click alone. This is a third, distinct dialog-handling shape beyond
the two already in `docs/ARCHITECTURE.md`'s Testing section.

**Also fixed:** wired the already-written but unused
`listMaterialReceiptHistoryByProject` into a real "History" disclosure
per material on the Receiving tab, rather than shipping a dead export;
added four `data-testid`s to the new Materials grid columns and fixed
the resulting ambiguous-`<select>` regression in
`estimating-flow.spec.ts`; deleted two stray leftover crews (created by
earlier, failed runs of this sub-phase's own new test, before the
dialog-deadlock fix existed) that were breaking `scheduler-flow.
spec.ts`'s crew locator.

**Verified:** `npm run lint`/`typecheck`/`build` all green. New
`e2e/materials-lifecycle-flow.spec.ts` (create project → row → material
→ richer identity fields → receiving check-in → shortfall → reorder
list → flagged status → history log → row readiness defaults to
blocked → toggled true → scheduler warns before assigning). Full suite
green: 23 passed, 2 intentionally skipped.

---

## 2026-07-06 — Batch 3 sub-phase E: Exception dashboard + emailed reports + closeout PDF

**What:** A company-wide `/app/dashboard` (active projects with SPI
risk, cross-project material shortages, blockers needing escalation,
crew over/under-performance vs. standard pace, "what changed today"),
auto daily/weekly emailed per-project reports via Resend (plus a
manual "email now") with a marked-drawing image/%/today's installs/
blockers/on-track-at-risk, and a per-project closeout PDF (as-built
drawing, reconciliation, blocker log, day-logs, sign-off block). Full
reasoning in `docs/DECISIONS.md` ADR-032; summary here.

**Build:** No schema migration needed — every table this sub-phase
reads (`blockers`, `material_reconciliation`, `crew_rates`,
`project_estimates`) already existed. New `lib/scheduler/spi.ts`
extracts `computeProjectSpi`/`classifySpi` from what was inline in
`scheduler-workspace.tsx`'s own `useMemo` — reused by both, refactored
in place rather than duplicated a third time. New `lib/dashboard/`
(cross-project queries + `resolveBlocker` action) and `lib/reports/`
(`data.ts` gathers per-project report data via the service-role admin
client — needed since a Vercel Cron request has no user session for
RLS to scope against; `render.ts` builds the email HTML; `send.ts` is
the one function both the cron routes and the manual button call).
New `app/api/cron/reports/{daily,weekly}/route.ts` + `vercel.json`
(Vercel Cron, `CRON_SECRET` bearer check, no-ops until that env var is
set). New `lib/pdf/closeout-pdf.tsx` (`@react-pdf/renderer` — pure JS,
no headless browser needed in a serverless function) +
`app/api/projects/[id]/closeout-pdf/route.tsx`. Installed `resend` and
`@react-pdf/renderer`.

**Live-verified the real Resend integration**, not just compiled it:
called the actual API with the real key already in `.env.local` —
confirmed the request reaches Resend correctly, and hit its sandbox
restriction (can only send to the account's own verified email until a
domain is verified) sending to the seeded test org's
`qa+owner@handyequip.test`. Fixed the "email now" button's message
logic, which had been conflating "no active projects" with "every send
failed" — it now surfaces the real Resend error in the latter case.
See NEEDS-YOU for the domain-verification step this depends on.

**Also fixed, required to make "blockers needing escalation" mean
anything:** `blockers.resolved_at` has existed since Batch 2 but no
application code ever read or wrote it. Added `resolveBlocker` (owner/
pm, matches `blockers_update` RLS) + a "Mark resolved" button — without
it, every blocker ever reported would show as needing escalation
forever.

**Bug found via dogfooding, pre-existing, unrelated to this
sub-phase's own code:** `e2e/packing-slip-extract-flow.spec.ts` failed
intermittently under full-suite load (reliable alone). Its "Extract
with AI" locator was ambiguous the whole time — the same slip's button
legitimately renders twice (fresh-upload confirmation + the persistent
uploaded-slips list, which re-fetches immediately) — it had just always
been timing-lucky in isolation. Fixed with an explicit `data-testid` on
the fresh-upload instance.

**Verification:** `npm run lint`/`typecheck`/`build` all pass. New
`e2e/dashboard-flow.spec.ts` — creates a project with a real shortage
(`total_needed=100, received=20` inserted directly, not via the
"paste from packing slip" flow, which sets `received = total_needed`
by design and would never produce a shortage) and an open blocker,
confirms both render on the dashboard, resolves the blocker via the
UI and confirms it disappears + `resolved_at` is set in the DB, clicks
"email now" and confirms a real Resend-backed result renders, and
downloads the closeout PDF via `page.request` (shares the
authenticated page's cookies automatically, unlike the standalone
`request` fixture) confirming real, non-empty, `%PDF-`-prefixed bytes.
Full suite green: 22 passed, 2 intentionally skipped.

## 2026-07-06 — Layout editor interaction rework: modeless model, pan priority, snap-back fix

**What:** A user-requested interaction/UX-only rework of the row-marking
canvas — no data model, undo/redo, bulk-action, or coordinate changes.
Full reasoning in `docs/DECISIONS.md` ADR-031; summary here.

**Build:** Discovered the direct-manipulation model itself (drag draws,
click selects, drag-on-selected-row moves, shift-click/shift-drag
multi-select/marquee, 8 resize handles) was already built in an earlier
session — only the Pan (Hand icon) toggle button remained as an actual
"mode." Removed it entirely from `row-marking-workspace.tsx`'s toolbar
(and the now-unused `isPanMode` state/prop) in favor of two
always-available panning inputs: Space-held (existing, unchanged) and a
new middle-mouse button, checked first in every pointerdown handler
(row body, resize handle) via `event.button !== 0` — a non-primary
button returns immediately without `stopPropagation()`, letting it
bubble to the stage's own handler, which pans regardless of what's
under the cursor. Fixed the actual reported bug (row snaps back on drop,
then teleports once the round trip lands): `handlePointerUp` no longer
clears the optimistic `draftGeometries` on a successful move/resize —
the row now stays showing the dropped position immediately, reconciled
away only once the server-confirmed `rows` prop actually matches it, or
reverted immediately (plus a toast) if the persist rejects. `onMoveRows`/
`onResizeRow` now return the underlying persist promise instead of
firing-and-forgetting, so `RowStage` can react to failure.

**A `currentGeometry(row)` helper** feeds `beginRowMove`/`beginResize`'s
origin computation instead of reading the raw `rows` prop directly — a
second drag/resize starting on a row whose first move is still
persisting (draft showing, prop not caught up yet) would otherwise
silently compute its delta from the stale pre-first-move position.

**Also fixed:** a plain click on empty space now deselects (previously
only a shift-click-without-drag did — a real, if minor, pre-existing
gap found while implementing this), and Escape deselects (new, per the
request).

**A real ESLint surprise:** the reconciliation logic (drop a pending
optimistic draft once `rows` confirms it) hit TWO of this Next 16/React
19 setup's newer, compiler-aligned `eslint-plugin-react-hooks` rules —
first `react-hooks/set-state-in-effect` (a `useEffect` calling
`setState` directly, even conditionally, is now an error, not just
discouraged), then, after switching to a ref-based "remember the
previous prop" comparison, `react-hooks/refs` (reading a ref's
`.current` during render is now ALSO an error — the classic
`getDerivedStateFromProps`-via-ref workaround is no longer allowed).
Landed on React's own currently-documented pattern instead: store the
previous prop value in *state* (not a ref) and call `setState`
conditionally during render when it differs — the one mechanism the
newer rules still sanction for this exact "adjust state when a prop
changes" shape.

**Verification:** `npm run lint`/`typecheck`/`build` all pass — the
existing `e2e/row-workspace.spec.ts` (draw, zoom accuracy, select,
copy, move, resize, nudge, phase, undo/redo, reload persistence) stayed
green throughout with no changes needed, confirming nothing already
working regressed. New `e2e/layout-interaction-flow.spec.ts` covers
what's actually new: no mode-toggle buttons render at all, a plain
click and Escape both deselect, shift-drag marquee selects multiple,
middle-mouse-button pan over a row leaves its DB geometry untouched
while visibly shifting its on-screen position, and — the core fix — a
dragged row's on-screen position is already correct immediately after
drop (no wait, no poll) and stays exactly there once the write is
confirmed server-side, with no intermediate jump either way. One test
bug caught and fixed while writing it: an "empty space" click target
computed relative to the outer viewport landed outside the actual
(smaller, letterboxed) stage rectangle and hit nothing at all — fixed
by computing it relative to the drawing image's own bounding box
instead. Full suite green: 21 passed, 2 intentionally skipped.

## 2026-07-06 — Batch 3 sub-phase D: Estimation brain

**What:** Materials convert to size-normalized labor units; crews' real
install history feeds learned per-task efficiency rates; a per-project
estimate (labor units → hours → crew-days → forecast finish +
confidence) with an interactive what-if tool and a save-to-history
action; a company estimating screen for pre-sale material lists; an
optional AI "explain this estimate" assistant. Full reasoning in
`docs/DECISIONS.md` ADR-030; summary here.

**Build:** One migration (`20260706115120_estimation_brain.sql`) —
`materials.task_key` (free text, app-enforced against `labor_standards`)
and a fourth `projects.status` value, `'estimate'`. Everything else
(`materials.labor_units`/`.size`, `crew_rates`, `labor_standards`,
`project_estimates`, `projects.planned_days`) already existed, seeded in
earlier sub-phases specifically for this one. Types regenerated +
re-patched (the usual two categories: literal unions, non-null view
columns) — diff against the prior commit is exactly the new column plus
`ProjectStatus` gaining `'estimate'`, confirmed via `git diff`.

New `lib/estimating/`: `labor.ts` (pure — `computeLaborUnits`,
`resolveRate`'s three-tier crew→company→standard fallback,
`forecastFinishDate`'s working-day walk, `computeConfidence`'s coverage
heuristic), `queries.ts` (`computeProjectEstimate`, the one function
both the server-rendered Estimate tab and the client what-if tool call),
`actions.ts` (`recomputeCrewRates` — the actual "learn from history"
job, `saveProjectEstimate`, `createEstimateProject`,
`convertEstimateToActive`). New `lib/dates.ts` (`addDays`/`todayIso`) —
a third copy of date math already duplicated in `crew-calendar.tsx` and
`calendar/page.tsx` was one copy too many; the two existing ones are
untouched, only new code uses the shared version.

`lib/projects/actions.ts`'s material mutations (`addMaterial`,
`updateMaterial`, `pasteMaterialList`, `confirmExtractedMaterials`) all
now compute `labor_units` from `labor_standards` at write time instead
of resting on the bare column default. Packing-slip confirmation also
infers `task_key` from the AI extraction's own constrained description
vocabulary and persists `size` to its own column. `MaterialsGrid` gained
Task/Size/Labor columns.

New UI: `/app/estimate` (draft list, labor-standards editor, crew-rates
panel with a "recompute" button), `/app/project/[id]/estimate` (the
what-if panel, breakdown table, save + AI explain), a "Convert to active
project" button + status-aware `ProjectTabs` (Layout/Progress hidden for
drafts). `lib/scheduler/queries.ts#getProjectRemainingLaborUnits`
upgraded in place to apply real company-wide rates instead of the
sub-phase C 1:1 placeholder — no changes to the calendar/Gantt
components themselves, per ADR-029's own stated plan.

**Bug found via dogfooding:** `MaterialsGrid` fully replaced its
contents (including "Add material"/paste controls) with a placeholder
whenever a project had zero rows — blocking the exact "paste a material
list before there's a drawing" flow this sub-phase's estimating screen
needed. Fixed to only suppress the row-assignment columns, not the
whole grid.

**Verification:** `npm run lint`/`typecheck`/`build` all pass. New
`e2e/estimating-flow.spec.ts` — drafts an estimate, pastes materials,
classifies one as `beam` with a size and confirms the Labor column
recomputes to the expected value, confirms the Estimate tab's stats/
breakdown/history, exercises the what-if crew-count input, saves an
estimate, converts to active, and confirms it moves from the estimating
list to the main Projects list. A second test exercises the labor
standards editor and the "recompute crew rates" button against real
(if sparse) data. Adding the Task/Size/Labor columns shifted
`project-flow.spec.ts`'s positional `td`/`input` indices — a real
regression in an existing test, not a new one; fixed by adding
`data-testid`s to every materials-grid cell and rewriting that test to
use them instead of raw indices, so the next column addition won't
repeat this. Full suite green: 20 passed, 2 intentionally skipped.

## 2026-07-06 — Batch 3 sub-phase C: Scheduler to flagship

**What:** A crew calendar across every active project (not just one
project's own week view), drag-and-drop assignment with double-booking
warnings, a capacity view (planned labor load vs. available hours),
per-crew SPI alongside the existing per-project figure, and a
Gantt-style project timeline. Full reasoning in `docs/DECISIONS.md`
ADR-029; summary here.

**Build:** `lib/scheduler/queries.ts` gained
`getProjectRemainingLaborUnits`/`getProjectDailyLaborLoad` (remaining
material qty weighted by `materials.labor_units`, spread across
remaining scheduled days — same "split evenly, no rule specified"
reasoning as `generateTargets`), `listOrgAssignmentsInRange` (org-wide,
flat selects + JS joins, not embedded-resource syntax), `getPhaseTimelines`
(a phase's date range inferred from assignments to its rows — phases
have no date columns of their own), and `getCrewDailyActuals` (installs
totals per crew per day). `lib/scheduler/actions.ts` gained
`moveAssignment` and the read-only `checkDoubleBooking`. New
`app/(protected)/scheduler/calendar/page.tsx` +
`components/scheduler/crew-calendar.tsx` — a crew-×-day grid with native
HTML5 drag-and-drop (project chips from a sidebar create whole-project
assignments; existing chips move between cells), each cell showing a
"planned units / capacity hours" figure. New
`components/scheduler/project-timeline.tsx` (Gantt-style phase bars) and
`components/scheduler/crew-performance-panel.tsx` (per-crew SPI), both
wired into the existing per-project `SchedulerWorkspace`.

**Verification:** `npm run lint`/`typecheck`/`build` all pass. New
`e2e/crew-calendar-flow.spec.ts` — drags a project onto a crew's day
cell (confirmed via Playwright's `dragTo()`, which was verified to
correctly drive real HTML5 `dragstart`/`dragover`/`drop` events against
this implementation), confirms a second project dragged onto the same
cell triggers the double-booking `window.confirm()` naming the first
project, and confirms removing one assignment leaves the other intact.
Found a real test-timing issue while writing this: the drop handler is
async (awaits `checkDoubleBooking` before ever calling `confirm()`), so
`dragTo()` resolving doesn't mean the dialog has appeared yet — a
`page.once("dialog", ...)` registered before the drag raced a
synchronous assertion right after and read an empty message; fixed by
`Promise.all`-ing `page.waitForEvent("dialog")` with the drag itself.
`e2e/scheduler-flow.spec.ts` extended to tag a row with a phase, assign
it, and log an install, confirming both the Timeline (a labeled bar) and
per-crew performance panel (a real SPI figure) render from that data —
scoped via a new `data-testid` on the performance panel rather than a
`hasText` div locator, avoiding the "matches every ancestor" class of
bug documented elsewhere in this log. Full suite green: 18 passed, 2
intentionally skipped.

**Also resolved from sub-phase B:** the Supabase platform-side issue
that blocked `day_logs.photo_paths` cleared on its own; the migration
applied cleanly on retry, types were regenerated with an exact match to
the hand-patched version, and the photo-attach E2E step now passes
live. Sub-phase B is fully done, not just "mostly."

## 2026-07-06 — Batch 3 sub-phase B: Field to flagship

**What:** "My assignments today," a mandatory day-summary review before
closing the day, end-of-day documentation photos, and an optional
voice-to-note feature (browser speech-to-text + Claude cleanup). Full
reasoning in `docs/DECISIONS.md` ADR-028; summary here.

**Build:** `lib/field/queries.ts` gained `listTodayAssignments`,
`listTodayInstalls`, `getMyCrewId`, `getSignedDailyPhotoUrls`.
`useCrewSelection` now accepts a `defaultCrewId` (the signed-in user's
own `profiles.crew_id` from sub-phase A), falling back to it only when
no device-local pick exists yet. New `components/field/field-home.tsx`
— the top-level `/field` list now highlights "My assignments today"
above the general active-projects list, with its own crew picker.
`MaterialStepper` shows a "Today: +N" line alongside the cumulative
total. `DayLogPanel` reworked significantly: "Close the day" now opens
a review screen (times, net installs today, blocker count, note,
photos) with "← Back to edit" / "Confirm & close day," rather than
closing immediately; gained photo attach/remove (uploads to the
existing `daily-photos` bucket, recorded on a new `day_logs.photo_paths`
array); gained `VoiceNoteRecorder` (`components/field/
voice-note-recorder.tsx`, feature-detects `SpeechRecognition` and
renders nothing when unsupported) wired to a new
`app/api/field/voice-note` route (Claude cleans up the transcript,
forced tool-use, flags a likely blocker code) — the crew always reviews
the draft (accept as note / report as blocker / discard) before
anything saves. `BlockerForm` gained optional `initialCode`/
`initialNote` for that hand-off.

**Real gap found and fixed:** neither new-ish AI route (packing-slip
extraction, voice-note) had an explicit auth check. Packing-slip was
*indirectly* protected (would eventually fail inside
`getSignedPackingSlipUrl`, but as a raw exception); voice-note had
*zero* protection, since it never touches Supabase at all — anyone,
signed in or not, could have spent the `ANTHROPIC_API_KEY` quota. Both
now call the sub-phase A `requireOrg()` helper explicitly, returning a
clean 401 instead. Found this by asking "what actually stops an
anonymous POST here" while writing the route, not by a test catching it
— worth calling out since it's exactly the kind of gap ADR-027's audit
was meant to close, and these two routes were added *after* that audit.

**Blocked, honestly: one migration didn't apply this session.**
`day_logs.photo_paths` (`20260706105523_day_log_photos.sql`) hit a
persistent Supabase-platform-side error (`supabase db push` and the
Management API's own SQL endpoint both failed identically, alternating
between an "OOM... maxmemory" error and a 504, across roughly ten
attempts spread over several minutes with real work in between) — the
same access token applied three earlier Batch 3 migrations cleanly
minutes before, so this isn't a credentials or SQL problem. Code was
written defensively against the column not existing yet (`log.photo_paths
?? []` at the one call site that runs unconditionally on every Field
page load) so nothing currently live broke; `database.types.ts` was
hand-patched ahead of the migration landing (ADR-010's pattern). Will
retry and confirm once the platform issue clears — tracked, not
silently dropped.

**Update, later the same day:** the Supabase platform-side issue
cleared on its own; `db push` succeeded on the next retry, types were
regenerated with an exact match to the hand-patched version, and the
photo-attach E2E step now passes live. Sub-phase B is fully done.

**Verification:** `npm run lint`/`typecheck`/`build` all pass.
`e2e/field-flow.spec.ts` extended: the day-summary review is asserted
against real logged data (not just that a screen appeared), including a
"← Back to edit" round trip and a live photo-attach/remove step. New
`e2e/voice-note-flow.spec.ts` —
the browser-only `SpeechRecognition` half isn't E2E-testable in headless
Chromium (no real microphone), so this tests the route it calls
directly: a clean 500 when no key is configured, a 401 for a genuinely
unauthenticated request, and (gated on a real key) that the AI both
cleans up filler words and correctly flags a described stoppage as a
`MISSING_MATERIAL` blocker. Found a real Playwright quirk while writing
the 401 test: both `browser.newContext()` and `request.newContext()`
inconsistently carried *some* valid session through to the server (a
genuinely cookie-less `curl` to the same running server, immediately
after, correctly got 401 — proving the server-side guard itself is
sound) — resolved by using plain Node `fetch()` for that one assertion,
which has no ambient cookie jar of any kind. Full suite green: 17
passed, 2 intentionally skipped.

## 2026-07-06 — Batch 3 sub-phase A: user management, org settings, role guards

**What:** Complete user management (assign a team member to a crew),
org settings (name/address/logo/default working days), and a pass
adding real server-side role enforcement across every mutating Server
Action that didn't already have one. Full reasoning in
`docs/DECISIONS.md` ADR-027; summary here.

**Schema:** two small migrations —
`20260706100401_org_settings_crew_assignment.sql` (`organizations.
address`/`logo_path`/`default_working_days`, `profiles.crew_id`, the
`org-logos` storage bucket, an `organizations_update` RLS policy for
owner/pm) and `20260706100904_self_update_full_name.sql` (the
`update_own_full_name` RPC — see ADR-027 for why this needed a narrow
SECURITY DEFINER function rather than a broader RLS policy). Both
applied cleanly; types regenerated again the same way as sub-phase 0.

**Build:** `lib/auth/session.ts` — new `requireRole`/`requireOrg`
shared helpers. Applied across `lib/crews/actions.ts`,
`lib/phases/actions.ts`, `lib/rows/actions.ts`,
`lib/scheduler/actions.ts`, and the owner/pm-only mutations in
`lib/projects/actions.ts`; `lib/team/actions.ts` refactored onto the
same helper instead of its own private copy. New `lib/account/actions.ts`
(`updateOwnName`), `lib/org/{actions,queries}.ts` (org settings CRUD +
logo upload, mirroring `PackingSlipUpload`'s browser-upload-then-record
pattern), `app/(protected)/app/settings/page.tsx`,
`components/org/{org-settings-form,org-logo-upload}.tsx`. Team page
gained a crew-assignment `<select>` per member (`TeamMemberRow` +
`assignTeamMemberCrew`); Account page gained a display-name field.
`/scheduler` and `/scheduler/[projectId]` now redirect non-owner/pm/
scheduler callers to `/app` (crew's equivalent is Field, sub-phase B) —
simpler and more correct than threading role-conditional rendering
through `CrewManager`/`ScheduleBuilder`/`AssignCrewForm` individually;
`site-header.tsx`'s nav now hides Scheduler/Team/Settings links to
match.

**Verification:** `npm run lint`/`typecheck`/`build` all pass. New
`e2e/team-settings-flow.spec.ts`: crew assignment persists across
reload; own-name edit persists; org settings (name/address/working
days, confirmed via a direct DB read, not just the UI) plus a logo
upload (synthetic in-memory image, same technique as the packing-slip
test); and — the proof that guards are real, not hidden buttons — a
freshly-created crew-role user, signed in through a genuinely separate
browser context (not the shared owner storageState), is redirected away
from `/scheduler`, `/app/team`, and `/app/settings` on direct
navigation, with the corresponding nav links hidden too. Found and
fixed a real test-pollution bug along the way: this new spec's own
crew-creation step had no cleanup, leaving permanent leftover `crews`
rows that broke `scheduler-flow.spec.ts`'s `.filter({hasText: ...})`
locator (matches every ancestor containing that text, so with more than
one crew on the page it resolved to multiple elements) — fixed by
deleting the crew by name in `afterAll`, and manually cleared the two
already-leftover rows from earlier runs directly via the admin client.
Full suite green afterward: 14 passed, 1 intentionally skipped.

## 2026-07-06 — Batch 3 sub-phase 0: schema for estimating, readiness, versioning

**What:** Batch 3 kicked off — a large flagship push across user
management, Field, Scheduler, an estimation engine, an exception-first
dashboard + reporting, material status/supply-chain, import tooling +
drawing versioning, a customer portal, and a final polish/deploy pass.
Sub-phase 0 is the schema all of it builds on. Full reasoning in
`docs/DECISIONS.md` ADR-026; summary here.

**Build:** One migration,
`20260706093725_batch3_estimating_readiness_versions.sql`: `materials`
gains `profile`/`capacity`/`condition`/`compatible_system`;
`material_receipts` (append-only receiving event log, `org_id_of_material`
added as its RLS helper); `rows` gains `materials_ready`/
`area_accessible`/`drawing_approved`; `drawing_versions` (upload history +
approval, parallel to `drawings`, backfilled from existing drawings as
version 1); `labor_standards` (org-scoped, seeded with reasonable default
hours-per-unit for upright/beam/wire_deck/anchor/row_spacer/
end_barrier/post_protector/general) and `project_estimates` (append-only)
for the estimation engine; `notifications` (per-user inbox, the one new
table that's *not* org-wide readable). `row_progress` gains a derived
`crew_assigned` and a computed `readiness_status`
(complete/blocked/ready/partial — see ADR-026 for the exact precedence).
RLS on every new table follows the existing `current_org_id()`/
`current_user_role()`/`org_id_of_*()` pattern exactly.

**Applied and types genuinely regenerated for the first time:** pushed
cleanly on the first try (`supabase db push`, no errors). With a working
`SUPABASE_ACCESS_TOKEN` now available, `lib/supabase/database.types.ts`
was regenerated for real via `supabase gen types` instead of hand-written
— confirmed the Batch 1/2 hand-written version had been an exact match
all along, modulo two deliberate, documented deviations (literal union
types for CHECK columns; non-null view columns the SQL genuinely
guarantees) that were reapplied to the fresh output. This retires the
long-standing "hand-written, remember to regenerate" caveat from
`docs/ARCHITECTURE.md` entirely.

**Verification:** `npm run lint`, `npm run typecheck`, `npm run build`
all pass. Full `npm run test:e2e` surfaced one real, pre-existing test
bug unrelated to this migration: `scheduler-flow.spec.ts`'s
`getByText(/^0 \/ \d+$/)` threw a strict-mode violation because the
test's date-relative schedule happened to give every scheduled day the
identical target number this run (a latent, date-sensitivity issue —
which specific calendar days a "starting today" range covers shifts the
scheduled-day count, and therefore the per-day split, run to run). Fixed
by adding a `data-testid` to each day's container in `WeekView` and
scoping the assertion to today's specific day. Also fixed, while
live-validating packing-slip extraction moments earlier (see below): a
`data-testid="reconciliation-table"` on `ReconciliationCard`, for the
same reason — a page-wide locator had been quietly depending on which
`<table>` happened to render first. Full suite green afterward: 10
passed, 1 skipped (the no-key packing-slip path, correctly inactive now
that a key is configured).

## 2026-07-06 — Live-validated packing-slip extraction; received Batch 3 credentials

**What:** The user provided `ANTHROPIC_API_KEY`, `SUPABASE_ACCESS_TOKEN`,
and `RESEND_API_KEY` (all written straight to `.env.local`, never echoed
back in chat). With the Anthropic key now live, re-ran
`e2e/packing-slip-extract-flow.spec.ts`'s previously-skipped live test —
this is the batch-2 item that had been sitting in the NEEDS-YOU list.

**Found and fixed a real test bug (not an app bug) while validating:**
the first run's content assertions all passed *vacuously* — every review-
table cell is a real `<input>`, and an `<input>`'s current value is never
part of its `innerText`/`textContent` (no text node; the value is
rendered by the browser's own form-control widget). `allInnerTexts()` was
silently reading empty strings the whole time, so `not.toContain
("freight")` trivially passed on nothing. Switched to reading each field
via `inputValue()`. A second locator bug surfaced once that was fixed:
the post-confirm check assumed `page.locator("table").first()` was
`MaterialsGrid`, but this test's project has no rows (never visited the
Layout tab), so `MaterialsGrid` renders its "add rows first" empty state
(no table at all) and `.first()` fell through to `ReconciliationCard`'s
always-present summary table instead. Added `data-testid=
"reconciliation-table"` (this codebase's established fix for exactly
this class of ambiguity) and asserted against that directly — its cells
are plain text, actually simpler to read than the grid's inputs would
have been.

**Result — the feature itself is excellent:** with correct assertions,
the live test passes cleanly. All 4 line items extracted correctly, the
two `36SQ10` beam lines kept their distinct sizes (144"/96", not merged
into one), the freight line was correctly excluded, and the saved
`materials` rows matched exactly. Validating against the user's actual
real-world packing slip was offered and explicitly deferred by their own
choice (not blocked on anything) — can be revisited anytime.

**Batch 3 kickoff:** the same message that prompted re-validation also
opened Batch 3 (a large, multi-sub-phase flagship push) and pre-supplied
all three credentials it needs up front, per CLAUDE.md rule 7's
"prefer a one-time token" guidance. Noted for the record: `Supabase
projects list` confirmed the access token was NOT already persisted from
Batch 2 (the CLI reported "Access token not provided") — this time it's
saved directly in `.env.local` as `SUPABASE_ACCESS_TOKEN`, which the CLI
reads automatically, so this should be the last time this specific token
needs to be requested. Batch 3's own sub-phases are logged separately as
they land.

## 2026-07-03 — Sub-phase F: Packing-slip AI extraction

**What:** Batch 2's sub-phase F, the batch's last sub-phase. A server
route reads an uploaded packing slip (PDF or photo) and asks the
Anthropic API to extract material line items — code, description,
size, qty — skipping non-material lines (freight, permits, discounts).
Extraction always lands in a review/edit table; nothing saves to
`materials` until a human confirms. Full reasoning in
`docs/DECISIONS.md` ADR-025; summary here.

**Build:** `app/api/packing-slips/extract/route.ts` — reads
`ANTHROPIC_API_KEY` from the server environment (500 with a clear
message if unset), re-signs the requested packing slip's storage path,
fetches it, and sends it to `claude-sonnet-5` via plain `fetch()` (no
new SDK dependency) as either an `image` or `document` content block
depending on the file's actual content-type (the upload input accepts
any file type). A forced tool-use call (`record_materials`) gets
structured `{code, description, size, qty}[]` back instead of free
text. `components/projects/packing-slip-extract-dialog.tsx` — new: a
"✨ Extract with AI" button (shown after a fresh upload in
`PackingSlipUpload`, and next to every historical slip on the Materials
page) opens a dialog, calls the route, and renders every extracted line
as an editable row (code/description/size/qty inputs, remove, add-line)
with a "Replace the current list" option, matching
`PasteMaterialsDialog`'s existing convention. `confirmExtractedMaterials`
(`lib/projects/actions.ts`) composes `name` from
`[code, description, size].filter(Boolean).join(" ")` — the two
real-slip beam lines that share one product code (`36SQ10`) but differ
in length stay distinguishable this way instead of colliding into one
row — and otherwise writes exactly like `pasteMaterialList` (qty → both
`total_needed` and `received`).

**Verification:** `npm run lint`, `npm run typecheck`, `npm run build`
all pass. New `e2e/packing-slip-extract-flow.spec.ts` has two tests,
mutually exclusive on whether `ANTHROPIC_API_KEY` is configured
(`test.skip` on opposite conditions, so exactly one runs in any given
environment and neither is silently absent): with no key, asserts the
route's graceful `500` surfaces to the UI as a clear error; with a key,
renders a small synthetic packing-slip image in-memory (a Playwright
screenshot of a throwaway page — two beam lines sharing a code but
different sizes, plus a freight line that must be skipped) and asserts
the review table has exactly 4 rows, both beam sizes (144"/96") survive
as distinct rows, the freight line is absent, and confirming actually
creates 4 materials rows. No `ANTHROPIC_API_KEY` is configured in this
environment yet, so only the no-key path has actually run; ran the full
10-test suite once (`npm run test:e2e`) to confirm zero regressions
elsewhere first. Found and fixed two test-authoring bugs along the way
(not app bugs): copy-pasted a suffix-anchored regex (`/uploaded\.$/`)
from the drawing-upload test without checking `PackingSlipUpload`'s
actual message text (`"Uploaded {filename}."` — a prefix, not a
suffix); and a genuine locator ambiguity once a slip exists on a project
(the upload toast and the page's "Uploaded packing slips" heading both
match `/^Uploaded /`) — fixed with a `data-testid` on the toast message,
this codebase's established fix for this exact class of bug.

## 2026-07-03 — Sub-phase E: Multi-page drawings

**What:** Batch 2's sub-phase E. The schema for "exactly one marking
page per project" (`drawings.role`, `projects.mark_drawing_id`, a
partial unique index, `set_marking_drawing()`) was laid down in
sub-phase 0; this sub-phase builds the UI that actually enforces it —
browsing every uploaded page, designating which one is markable, and
making the rest view-only (still zoomable/pannable/fullscreen-able).
Full reasoning in `docs/DECISIONS.md` ADR-024; summary here.

**Build:** `recordDrawingUpload` (`lib/projects/actions.ts`) now
auto-designates a project's very first upload as its marking page (no
extra step for the common single-page case); a new `setMarkingDrawing`
action wraps the `set_marking_drawing` RPC for switching it later.
`RowStage` gained a `readOnly` prop: `handleStagePointerDown` skips
draw/marquee (pan still works), `handleRowPointerDown` skips select/
move, `handleKeyDown` skips nudge/delete, and resize handles are gated
`isSingleSelected && !readOnly`. `RowMarkingWorkspace`'s page tabs show
a ★ on the marking page; the toolbar area shows either "★ This is the
marking page" or "View-only reference page…" + a "Set as marking page"
button; "Auto rows" is disabled (with an explanatory `title`, not just
silently inert) while viewing a non-marking page.

**Real bug caught by the E2E suite, not self-review:**
`recordDrawingUpload`'s insert used
`.insert(...).select("id").order("page_index", ...)` to find the
first-inserted page for the auto-marking logic above — this throws
`column drawings.page_index does not exist`. Chaining `.order()` after
an insert-returning `.select()` resolves the ORDER against the
statement's own RETURNING context, not the underlying table, even
though the column obviously exists there. Every single E2E test that
uploads a drawing failed identically (field-flow, phases-flow,
project-flow, row-workspace, scheduler-flow — 5 of 9), which is exactly
the risk of touching a shared code path: the blast radius wasn't
contained to the one feature being built. Fixed by selecting
`id, page_index` and sorting in JS instead of asking Postgres to order
an insert's return.

**Verification:** `npm run lint`, `npm run typecheck`, `npm run build`,
and the full `npm run test:e2e` (9 tests now, zero regressions once the
bug above was fixed) all pass. New `e2e/multi-page-flow.spec.ts` covers:
first upload auto-becoming the marking page, a second upload defaulting
to view-only with "Auto rows" disabled, confirming a drag on the
view-only page creates no row at all (a direct DB count, not just "no
error shown"), zoom and fullscreen still working there, and switching
the marking page to page 2 — confirming both that page 2 flips to
`'marking'` *and* that page 1 flips back to `'reference'` (the "exactly
one" constraint enforced both ways, not just checking the new page).

## 2026-07-03 — Sub-phase D: Phases full UI

**What:** Batch 2's sub-phase D. Phase creation/assignment already
existed (ADR-020, from the Layout-tab rework); this sub-phase renders
each phase's rows in its color on the drawing, adds a legend with a
show/hide toggle, and filters the Materials and Progress tabs by phase.
Full reasoning in `docs/DECISIONS.md` ADR-023; summary here.

**Build:** `StageRow`/`ProjectRow`/`ReferenceRow` gained `phaseId`,
threaded from `row_progress.phase_id` through `mark/page.tsx` down to
`RowStage`. Both `RowStage` (editable) and `MaterialsReferenceStage`
(read-only) apply the phase's color as the row's border color via
inline `style` (arbitrary hex values can't be Tailwind classes) and,
in `RowStage`, filter hidden-phase rows out of the render entirely
(not just dimmed — a hidden row shouldn't be selectable/draggable
either). New `components/projects/phase-legend.tsx` (swatch + name +
show/hide, used above the Layout canvas). Materials tab: a phase filter
narrows which rows show on the reference drawing and as grid columns,
plus a compact "assigned to this phase" summary computed from
already-fetched `rowMaterials`. Progress tab: a phase filter
(`components/projects/phase-progress.tsx`) recomputes row count/rows
complete/pct client-side from already-fetched `row_progress` — no new
queries needed for either tab's filter.

**Verification:** `npm run lint`, `npm run typecheck`, `npm run build`,
and the full `npm run test:e2e` (8 tests now, zero regressions) all
pass. New `e2e/phases-flow.spec.ts` covers: assigning a row to a new
phase and confirming its border color actually changed (polled via
`getComputedStyle`, not just "the legend entry appeared"), hiding the
phase and confirming the row disappears from the drawing while the
other row stays, un-hiding it, filtering the Materials tab (confirms
the *other* row's label is no longer visible), and filtering the
Progress tab. The Progress-tab step caught a real test-design trap
worth remembering generally: the Materials and Progress tabs both have
a `<select>` labeled "Filter by phase," and clicking the "Progress" nav
link doesn't block until the client-side navigation finishes — a
`getByLabel("Filter by phase")` that fires too early silently resolves
to the *Materials* tab's still-mounted select instead (Next.js keeps
the outgoing page around until the incoming one's data is ready).
Fixed by waiting for a Progress-tab-specific element first.

## 2026-07-03 — Sub-phase C: Scheduler

**What:** Batch 2's sub-phase C. Crew CRUD, assigning a crew to a
project/rows/phase on a date, a date-range schedule (with per-day
skip, e.g. weekends/holidays), daily targets auto-suggested from
remaining material ÷ remaining scheduled days, actual-vs-target with a
Hit/Miss/Exceeded badge per day and an overall Schedule Performance
Index badge, and a week view. Full reasoning in `docs/DECISIONS.md`
ADR-022; summary here.

**New:** `/scheduler` (replaces the placeholder — crew management +
active-project list) and `/scheduler/[projectId]` (the workspace)
routes. `lib/crews/actions.ts` — `createCrew`/`updateCrew`/`deleteCrew`,
`addCrewMember`/`removeCrewMember` (crews/crew_members have existed
since Batch 1 with no UI until now). `lib/scheduler/{queries,actions}.ts`
— `listRemainingByMaterial` (assigned − installed per material — **not**
`material_reconciliation.left_qty`, which is a different number,
needed − assigned; see ADR-022), `getDailyActuals`, `setProjectSchedule`
(replace-the-whole-set), `generateTargets` (splits each material's
remaining qty evenly across every scheduled day from today forward,
project-wide), `createAssignment`/`deleteAssignment`, `upsertTarget`
(hand-rolled find-or-update-or-insert, same reasoning as `day_logs` in
ADR-021 — `targets` has no unique constraint at all). `components/scheduler/`:
`crew-manager.tsx`, `scheduler-workspace.tsx` (orchestrator: planned
days, SPI badge, schedule builder, week view), `schedule-builder.tsx`
(date range → candidate days → tap to exclude one → save),
`week-view.tsx` (prev/next week, per-day target/actual/status, assigned
crews), `assign-crew-form.tsx` (whole project / specific rows / a
phase's rows).

**Verification:** `npm run lint`, `npm run typecheck`, `npm run build`,
and the full `npm run test:e2e` (7 tests now, zero regressions) all pass.
New `e2e/scheduler-flow.spec.ts` covers, in one flow: creating a crew and
adding a member, building a 2-week schedule (confirming weekends were
actually skipped), generating targets, assigning the crew to today
(whole-project scope) and confirming it shows in the week view, and
unassigning it — each step confirmed against the database via
`expect.poll`, not just the UI. One assertion (today's row showing a
target number, not just the "done" toast) caught a real timing gap
worth knowing about: `router.refresh()` isn't awaited by the button
handler, so the "Targets set for N days" message can render a beat
before the week view's own re-render lands with the new numbers — not
a correctness bug (the data is right, confirmed by the DB poll), but the
test now explicitly waits for the UI to catch up rather than just the
toast, and a manual visual check hit this exact gap first (a screenshot
taken right after the toast showed no target yet; a second one taken
after the stronger assertion passed showed it correctly).

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
