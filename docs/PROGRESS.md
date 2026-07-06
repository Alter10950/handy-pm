# Progress

**Current status:** Phases 1–5 of this batch are all built AND now
**verified live** via an automated Playwright E2E suite
(`npm run test:e2e`) running against the real Supabase project — no more
manual click-through needed to trust this. That suite's first real run
caught and fixed a genuine bug (`NEXT_PUBLIC_*` env vars weren't reaching
the browser bundle on the sign-in/upload paths — see `docs/DECISIONS.md`
ADR-016) that five phases of self-review and `next build` had missed,
because none of that exercises a real browser. Org "Handy Equip" exists
(seeded by `scripts/seed.mjs`); the user is doing their own real
first/owner sign-in separately (see `docs/BUILD-LOG.md`).

**Production deploy:** live at `https://handy-pm.vercel.app` — the
`Internal Server Error` (missing Supabase env vars on Vercel) is fixed,
all three env vars are set for Production/Preview/Development, `/login`
confirmed returning 200.

**Auth:** switched from email magic-link to email + password (see
`docs/DECISIONS.md` ADR-017) — magic-link delivery was too slow/unreliable
to develop and sign in against. No public sign-up; accounts are created
from the new **Team** page (`/app/team`, owner/pm only), which also
supports changing a member's role and resetting their password. Also
added self-service password change at `/account` (any role). This removes
the earlier "needs a human to configure Supabase Auth Redirect URLs" item
entirely — password sign-in has no callback URL to register, on either
localhost or production.

**Layout tab:** zoom/pan/fullscreen, multi-select + bulk quantities, and
row duplication added on top of Phase 4 (see `docs/DECISIONS.md`
ADR-018) — real feedback from the first live layout (Bingo Warehouse):
big warehouses need to zoom/pan to draw precisely, and marking many
near-identical rows one at a time was too slow. Row coordinates are
still normalized 0..1 in the DB; zoom/pan is purely a view transform,
verified zoom-invariant against the DB directly in
`e2e/row-workspace.spec.ts`, not just by inspection.

**Batch 2 (in progress, 2026-07-03):** sub-phase 0's schema migration
(`phases`, `blockers`, `day_logs`, `project_schedule`,
`installs.idempotency_key`/`device_id`, `materials.size`/`labor_units`,
one-marking-page-per-project, `daily-photos` bucket — see ADR-019) is
**applied and confirmed live**. The user provided a one-time Supabase
personal access token; the 5 original Batch-1 migrations had been
applied by hand (via the SQL editor) so the CLI's remote migration
history didn't know about them — `supabase migration repair --status
applied` fixed that bookkeeping first, then `supabase db push` applied
the new migration. Its first attempt failed
(`cannot change name of view column "label" to "phase_id"` —
`CREATE OR REPLACE VIEW` only allows appending new columns at the _end_
of the list, and `phase_id` had been inserted in the middle; the whole
migration rolled back atomically, nothing partially applied). Fixed by
moving `phase_id` to the end of `row_progress`'s column list; re-ran
cleanly. Verified via `supabase gen types` against the live project and
diffed against the hand-written types — an exact match (the generator's
plain `string` for CHECK-constrained columns vs. this codebase's literal
union types, e.g. `BlockerCode`, is an intentional, valid improvement
per ADR-010, not a discrepancy). Sub-phase A (Team deactivate/reactivate)
is also done.

**Layout tab interaction-model rework + undo/redo — done and verified
live (2026-07-03, see ADR-020):** an interrupt arrived between sub-phase
A and B asking for undo/redo, then (before that landed) a full rework of
the Layout tab into one direct-manipulation canvas — no separate
Draw/Edit/Select tools; click/shift-click/drag directly on rows and
empty space. Rewriting `e2e/row-workspace.spec.ts` for the new model
found and fixed **three real app bugs**, not just test issues: resize
handles were unreliably grabbable (a clipping/z-order issue, worst on
corner handles); Ctrl+Z silently stopped working right after Delete (a
focus-loss bug — the just-clicked Delete button unmounts as part of
clearing the selection, and the browser moves focus to `<body>`, outside
the div-scoped listener that used to catch the shortcut); and row
paint/click order was non-deterministic (`listRowProgress` had no
`ORDER BY` — new migration `20260703172037_add_row_progress_ordering.sql`
adds `rows.created_at` to `row_progress` and the query now orders by it).
Full detail in `docs/BUILD-LOG.md` and ADR-020.

**Sub-phase B — Field/crew daily closeout — done and verified live
(2026-07-03, see ADR-021):** mobile-first `/field` — pick a project, pick
a row, log material installs (offline-queued if the connection drops,
with a pending-sync indicator — verified by actually going offline
mid-test, not just reasoned about), report a blocker with a photo,
confirm the day's times, close the day. `crews`/`crew_members`/etc. have
existed in the schema since Batch 1 (see `docs/ARCHITECTURE.md`'s data
model) but have no management UI yet — that's Sub-phase C; Field's crew
picker works against whatever crews already exist and degrades cleanly
to "no crew selected" otherwise.

**Sub-phase C — Scheduler — done and verified live (2026-07-03, see
ADR-022):** `/scheduler` now has real crew CRUD (name, size, cost/hour,
members) instead of just being a data source for Field's picker. Per
project: a date-range schedule builder (skip weekends/holidays), "Generate
targets" that splits each material's remaining qty (assigned − installed
— deliberately not `material_reconciliation.left_qty`, a different
number; see ADR-022) evenly across every remaining scheduled day, a week
view with per-day target/actual/Hit-Miss-Exceeded, an overall SPI badge,
and assigning a crew to a day at whole-project / specific-rows / a-phase
granularity.

**Sub-phase D — Phases full UI — done and verified live (2026-07-03, see
ADR-023):** each phase's rows now render in its color (an inline border
color, since colors are arbitrary hex values from `PhasePicker`'s swatch
picker — can't be a Tailwind class ahead of time) on both the Layout
tab's canvas and the Materials tab's read-only reference drawing. A
legend above the Layout canvas shows every phase with a show/hide toggle
— hiding one removes its rows from the render entirely, not just dims
them, so they're not selectable/draggable while hidden. The Materials
and Progress tabs each gained a phase filter (Materials: narrows which
rows show on the drawing/grid plus a compact per-phase assigned-qty
summary; Progress: phase-scoped row count/complete/pct), both computed
from data the pages already fetch — no new queries needed.

**Sub-phase E — Multi-page drawings — done and verified live (2026-07-03,
see ADR-024):** a project's first upload auto-becomes its marking page
(no extra step for the common single-page case); switching it later is
one click ("Set as marking page" on any other page). Non-marking pages
are fully zoomable/pannable/fullscreen-able but not markable —
`RowStage` gained a `readOnly` mode rather than a second component, so
that shared behavior doesn't fork. Caught a real bug along the way (an
`.order()` chained after an insert-returning `.select()` that broke
*every* drawing upload, not just the new auto-marking logic — see
ADR-024) before it reached the batch's final report.

**Sub-phase F — Packing-slip AI extraction — built, not yet
live-validated (2026-07-03, see ADR-025):** a new
`app/api/packing-slips/extract` route sends an uploaded packing slip
(PDF or photo — content-type detected, not assumed) to the Anthropic
API, forcing a tool-use call so the response is structured
`{code, description, size, qty}[]` rather than free text to parse.
Extraction always opens in an editable review table
(`PackingSlipExtractDialog`) — fix a misread field, remove a
non-material line, add one that was missed — before anything writes to
`materials`; confirming composes `name` from
`[code, description, size].filter(Boolean).join(" ")`, which is what
keeps two same-code-different-size lines (like the real slip's two
`36SQ10` beam lengths) distinguishable as separate rows instead of
colliding into one. `npm run lint`/`typecheck`/`build` all pass. New
`e2e/packing-slip-extract-flow.spec.ts` has two mutually-exclusive
tests keyed on whether `ANTHROPIC_API_KEY` is configured — one always
runs. **Update 2026-07-06:** the user provided the key; the live test
passed cleanly (correct code/description/size/qty for all 4 lines, the
two `36SQ10` beam lines kept distinct at 144"/96", freight correctly
skipped). Validation against the user's actual real-world packing slip
is deferred by their own choice, not blocked on anything.

**Batch 2 — complete (2026-07-06).** All six sub-phases (0, A, B, C, D,
E, F) plus the mid-batch Layout rework are built, verified live, and
documented. Full E2E suite green at close: 10 passed, 1 skipped
(intentionally — the packing-slip no-key test, inactive now that a key
is configured).

**Batch 4 (in progress, 2026-07-06):** the "PM Operating Layer" — a new
flagship push designed against a real ~$200K project ("iBuy") that ran two
weeks over because scope was never captured, no one owned the job, bad
material surfaced mid-install, the customer was never told the schedule,
and everything lived in one manager's head. Ten sub-phases (0, A-J) make
each of those structurally impossible: a stage-gate lifecycle (handoff →
scope → schedule → materials → mobilize → execute → punch → closeout),
PM-of-record + accountability, scope-of-work beyond install, the sales→ops
handoff survey, a hard material-verification gate, change orders, a hard
two-crew capacity board, customer communication (push, not just the
portal's pull), and a closeout autopsy. No new credentials needed — every
key Batch 4 requires (Supabase access token, `RESEND_API_KEY`,
`ANTHROPIC_API_KEY`) was already secured and deployed during Batch 3.

**Sub-phase 0 — schema — done and verified live (2026-07-06, see
ADR-037):** ten new tables for the whole batch — a reusable, org-editable
8-stage gate template (`gate_templates`/`gate_template_stages`/
`gate_template_items`) copied per-project at creation so later edits never
mutate the template; `project_stages` (one row per project per stage, a
single `locked`/`active`/`complete`/`overridden` status) + 
`project_gate_items` (the actual checklist, `done`/`done_by`/`done_at`,
optional photo/signoff/due-date); `scope_items` (everything beyond
install — teardown/remove-add-levels/relocate/repair/other — the work
that killed iBuy); `handoff_surveys` (site conditions, constraints, dual
estimator+PM sign-off); `change_orders`; `project_comms` (an auditable
customer-communication log); `project_autopsies` (estimated vs actual).
`projects` gains `pm_user_id`/`stage_key`/`last_activity_at` +
customer-contact/comms-preference columns; `organizations` gains
`num_crews` (a hard capacity constraint, enforced starting sub-phase G).
Seeded one default gate template per org with the batch's own verbatim
29-item starter checklist across all 8 stages — confirmed live: 1
template, 8 stages, 29 items. RLS gives crew read-only on stage/scope,
owner/pm full manage, and scheduler a narrow write exception scoped
specifically to the Schedule stage's own rows (per the batch's own precise
instruction), not a blanket role list. Deliberately did NOT backfill
existing projects' own stage rows in this migration — that needs actual
judgment about where each already-in-progress project realistically
stands, which is explicitly sub-phase J's job; sub-phase A's own
data-access layer will lazily create a project's stages from the current
template the first time they're needed. Purely additive: full E2E suite
green with zero changes needed anywhere else — 26 passed, 2 intentionally
skipped.

**Sub-phase A — stage-gate lifecycle engine, What's Next, notifications,
gate nags, template management — done and verified live (2026-07-06, see
ADR-038):** the actual application layer on Sub-phase 0's schema — an
8-stage stepper per project (`LifecyclePanel`), the active stage's
checklist expanded (check items, attach required photos, collect
sign-offs, add per-project items), Complete-stage blocked while items
are open (Override with a required reason as the accountable escape
hatch). "What's Next" (top 3 open items + anything overdue) renders per
project and, new, aggregates company-wide on the dashboard as a "Needs
attention" section — exceptions only (stalled or overdue), not a
redundant full project list. The STALLED flag
(`organizations.stalled_after_days`, default 3) is now live and
surfaced. Owner-only template management on `/app/settings` — edit,
add, or remove a stage's checklist items; a pm sees the same content
read-only; edits never retroactively touch an already-bootstrapped
project's own copy. First application code against the `notifications`
table (schema-only since Batch 3): a bell in the site header with
unread count, dropdown, and mark-read. A new gate-nags mechanism checks
every active project daily for overdue items and the STALLED flag,
always creates in-app notifications, and emails each affected recipient
one combined digest (gated on `RESEND_API_KEY`) — riding the existing
daily reports cron rather than a new route, since Vercel's Hobby plan
caps a project at 2 cron jobs and both were already spent. Found and
fixed a real ordering bug (`project_gate_items` had no stable position
column, so checklist order wasn't deterministic — fixed with a
follow-up migration), a real UX bug (the lifecycle panel didn't
auto-follow the newly-active stage after a completion/override), a
dozen pre-existing E2E specs broken by a new hidden file input on the
Overview page racing their bare `input[type="file"]` locators, and one
unrelated, previously-latent regression in `project-flow.spec.ts`'s
Progress-tab check (a same-text/same-class element from the Materials
tab transiently coexisting during a fast tab switch — the same race
shape as an earlier sub-phase's own zoom-fit finding). Full suite green:
29 passed, 2 intentionally skipped, confirmed zero leftover test data in
the shared org-wide gate template afterward.

**Sub-phase B — PM-of-record accountability — done and verified live
(2026-07-06, see ADR-039):** a PM of record is now required to create a
real project — the form defaults to the signed-in creator (always valid,
frictionless for the common case) rather than forcing an empty choice
that would've also broken every pre-existing "create a project" E2E
step. Shows everywhere: the project card, the Overview page (an inline
reassign control for owner/pm, read-only otherwise), and a new PM column
on the dashboard's project list — an active project missing one shows a
warning-styled "No PM assigned," while the pre-sale estimates list
correctly shows no PM row at all. Reassigning updates the DB, logs a new
`project_pm_history` audit row (previous/new/changed-by), and sends up
to two independent notifications (the incoming PM: "you're now the PM";
the outgoing PM, if any and if not the same person making the change:
"you're no longer the PM") — never a redundant self-notification when
an owner assigns themselves or hands off a project they never held. New
"My projects only" filter on `/app`. Full suite green: 30 passed, 2
intentionally skipped — including every pre-existing spec that creates
a project through the now-changed New Project form, none of which
needed a single edit.

**Batch 3 — ✅ COMPLETE (2026-07-06):** a large flagship push — full user
management/org settings, Field and Scheduler taken to "flagship," a
rules-based estimation engine, an exception-first dashboard + emailed
reports + closeout PDFs, material status/supply-chain tracking, CSV/XLSX
import + drawing versioning, a scoped customer portal, and a final
polish/QA/deploy pass. The user supplied `SUPABASE_ACCESS_TOKEN`,
`ANTHROPIC_API_KEY`, and `RESEND_API_KEY` up front so the whole batch could
run without stopping for credentials again. All ten sub-phases (0, A-I)
done and verified live; see the closing report in `docs/BUILD-LOG.md`'s
Sub-phase I entry for the full NEEDS-YOU list and the iBuy self-review.

**Sub-phase 0 — schema — done and verified live (2026-07-06, see
ADR-026):** richer `materials` identity (`profile`/`capacity`/
`condition`/`compatible_system`); `material_receipts` (append-only
receiving log); `rows` readiness inputs feeding a new computed
`readiness_status` (ready/partial/blocked/complete) on `row_progress`;
`drawing_versions` (upload history + approval, parallel to `drawings`);
`labor_standards` + `project_estimates` (the estimation engine's
foundation — `materials.labor_units`/`crew_rates` already existed from
Batch 2, seeded exactly for this); `notifications` (per-user inbox).
Applied cleanly on the first push. **Types are now genuinely
regenerated** via `supabase gen types` for the first time (previously
hand-written — see ADR-010) — confirmed an exact match against the old
hand-written file, modulo two deliberate, now-reapplied deviations
(literal union types for CHECK columns; non-null typing for view columns
the SQL genuinely guarantees non-null). Full E2E suite green afterward,
10 passed / 1 skipped — one real, pre-existing test bug found and fixed
along the way (`scheduler-flow.spec.ts`'s date-sensitive strict-mode
violation, unrelated to this migration; see ADR-026).

**Sub-phase A — user management, org settings, role guards — done and
verified live (2026-07-06, see ADR-027):** assign a team member to a
crew (new `profiles.crew_id`); org settings page (name, address, logo
upload, default working days); self-service display-name edit (a narrow
`update_own_full_name` RPC, since the existing `profiles_update` RLS
policy only ever let owner/pm touch profile rows, even their own). The
bigger piece: audited every mutating Server Action in the app and found
role enforcement relied *entirely* on RLS with no application-level
check anywhere — added a shared `requireRole`/`requireOrg` helper
(`lib/auth/session.ts`) and applied it across crews/phases/rows/
scheduler/projects/team actions, each matching its table's real RLS
role set exactly. `/scheduler` is now gated to owner/pm/scheduler at
the page level (crew's equivalent is Field) rather than trying to hide
every mutating control inside `CrewManager`/`ScheduleBuilder`
individually. New `e2e/team-settings-flow.spec.ts` proves the guards
are real: a freshly-created crew-role user, signed in through a
genuinely separate browser context, gets redirected away from
`/scheduler`/`/app/team`/`/app/settings` on direct navigation — not
just a hidden nav link. This is a deliberately scoped pass, not an
exhaustive UI audit — e.g. the Materials grid still renders editable
inputs for every role (blocked server-side, just not visually hidden);
full UI role-awareness is deferred to sub-phase I's polish pass. Full
suite green: 14 passed, 1 intentionally skipped.

**Update 2026-07-06, later the same day:** the Supabase-platform-side
issue cleared on its own; `day_logs.photo_paths` applied cleanly, types
regenerated with an exact match to the hand-patched version, and
`e2e/field-flow.spec.ts`'s photo-attach step now passes live. Sub-phase
B is fully done, not just "mostly."

**Sub-phase B — Field to flagship — done and verified live (2026-07-06,
see ADR-028):** "My assignments today" on the top-level `/field` list
(matched client-side by selected crew, same convention as
day_logs/blockers); the crew picker now defaults to the signed-in
user's own assigned crew (`profiles.crew_id`) when a device hasn't
picked one yet. "Close the day" now opens a mandatory review screen
(today's net installs per material, blocker count, times, note, photos)
with "← Back to edit" / "Confirm & close day" — edit/resume and the
day-summary confirmation compose into one flow rather than needing two
separate features. End-of-day documentation photos (distinct from a
blocker's own photo). An optional voice-to-note: the browser's own
speech recognition transcribes locally (free, no server round-trip),
then Claude cleans the transcript into a draft and flags a likely
blocker code — the crew always reviews before anything saves. Found and
fixed a real gap while building this: neither the packing-slip
extraction route nor the new voice-note route had an explicit
authentication check (voice-note had *none* at all, since it never
touches Supabase) — both now use sub-phase A's `requireOrg()` helper.

**Sub-phase H — Customer portal — done and verified live (2026-07-06,
see ADR-035):** a public, unauthenticated, read-only status page at
`/portal/[token]` — project name, % complete, most recent day-log
update, next planned milestone (project deadline, falling back to the
latest saved estimate's forecast finish), and only office-approved
photos. Never shortages, costs, reconciliation, or internal notes —
every query in the new admin-client-backed `lib/portal/public.ts`
selects narrowly by name, not `select("*")`, specifically to keep
shortage-adjacent columns from ever reaching this page. A new "Portal"
project tab lets an owner/pm generate or revoke share links (with an
optional expiry) and approve individual day-log/blocker photos for
customer visibility — nothing is customer-visible by default, a
blocker photo especially, since those usually document a problem, not
a highlight. The `share_tokens` table (project_id/token/scope/
expires_at) had actually existed in full since Phase 2, provisioned
ahead of time with RLS already anticipating this exact sub-phase — only
a `revoked_at` column needed adding, so a link could be explicitly
revoked as a distinguishable office action rather than just quietly
expired. Found a real bug in the sub-phase's own new E2E spec: a status
badge's CSS `capitalize` class only changes how the text *looks*, not
its actual lowercase DOM content — an unscoped assertion had been
silently passing against the wrong element (the project's own,
properly-capitalized status pill) instead of the token's own badge.
New `e2e/customer-portal-flow.spec.ts` (seeds a day-log photo + a
throwaway shortage material, generates a link, approves the photo,
loads the real public page and confirms the shortage material name
never appears anywhere on it, then revokes the link and confirms the
friendly invalid-link fallback). Full suite green: 26 passed, 2
intentionally skipped.

**Sub-phase I — Polish/QA/perf pass + production deploy — done and
verified live (2026-07-06, see ADR-036), Batch 3 now complete:** a
research agent audited the whole app for missing loading states,
error-boundary gaps, accessibility misses, and performance risk points
at 20+ projects, every finding with an exact file:line reference. Fixed
what was concrete and proportionate: a new root `app/error.tsx` closing
two real gaps (Next excludes a segment's own `layout.tsx` from that
segment's `error.tsx`, so `(protected)/layout.tsx`'s own auth/profile
lookup was never actually caught; `/portal/[token]`, fully public, had
no error boundary anywhere at all) — shows a generic message, not the
real error, since this can fire before we even know who's asking.
`aria-label`s added to 5 icon/glyph-only buttons. The dashboard's
self-documented N+1 (deliberate since sub-phase E, to guarantee
identical SPI numbers to the per-project Scheduler page) rewritten to
batch-fetch everything and group in memory, then call the exact same
unchanged SPI function per project — same numbers, far fewer round
trips. `RowFillMarker` (renders every row on the marking canvas)
memoized — a free win for large drawings, every prop already a
primitive. Five new `loading.tsx` files for the heaviest routes. A real
mobile-layout bug found via a genuine 390px-viewport pass (screenshotted
every major screen, not simulated): the protected layout's `<main>` had
no `min-w-0`, so a flex item containing the materials grid's wide table
refused to shrink, pushing the *entire page* wider than the viewport on
any project with materials — one root-level fix instead of patching
every wide-content page. Also fixed a long packing-slip filename with
no `break-all` causing the same class of overflow, and a non-wrapping
control row on the Team page. **Vercel production brought fully in
line**: `RESEND_API_KEY`/`CRON_SECRET`/`ANTHROPIC_API_KEY` had been
added locally during Batch 3 but never pushed — confirmed via `vercel
env ls production`, pushed all three via the CLI, then redeployed
(env var changes don't retroactively apply to an already-built
deployment) — live-verified `/login`/`/manifest.webmanifest`/`/sw.js`
all 200 and the cron route's bearer check now correctly 401s an
unauthenticated request. Found and fixed a real regression the new
aria-labels caused in `field-flow.spec.ts` (a locator matching the old
"+" glyph, now "Increase quantity"). Full suite green: 26 passed, 2
intentionally skipped.

**Sub-phase G — CSV/XLSX import + row-range duplication + materials
bulk ops + drawing versioning — done and verified live (2026-07-06, see
ADR-034):** the Materials tab gained an "Import from file" dialog —
one mode toggle for a materials list vs. a row×material assignment
sheet, live column mapping (auto-guessed, always editable) against
whatever headers the file has, and a preview table before anything
commits. Row assignments resolve against the project's own existing
rows/materials by name and never auto-create either — an unresolved
name is a visible skip, not a silent phantom row. Chose `exceljs` +
`papaparse` over the `xlsx` npm package specifically because the
latter carries an unpatched high-severity advisory. The Layout tab's
row command panel gained "Duplicate range ×N" — select a block of
rows (e.g. rows 1-10) and repeat it as a rigid pattern N times in
either direction, reusing the existing `duplicateRows` action
unmodified (it already supported many-copies-per-source; the feature
was entirely new client-side orchestration, no new Server Action).
Materials grid gained bulk-select checkboxes + a delete/set-condition
action bar. A real drawing-versioning UI now sits on top of sub-phase
0's `drawing_versions` table, which had shipped with zero application
code ever reading or writing it: upload a new version (auto-supersedes
the prior one, starts unapproved), approve for install, a warning
banner for everyone (crew included) when the latest version isn't
approved yet, a version history log — first-ever upload of a page
still auto-approves immediately, since there's nothing yet to review
against. Found and fixed a genuine test-only race while writing the
new E2E specs: a fast client-side tab navigation can read the
drawing's bounding box before the zoom/pan "fit to screen" effect has
recomputed it (every *existing* test happened to avoid this by
reaching the canvas through a slow upload round trip) — fixed by
clicking the real "Fit to screen" button for a synchronous, guaranteed
recompute instead of guessing at a wait. Also fixed two regressions
this sub-phase's own grid/upload changes caused in other pre-existing
tests (a newly-ambiguous file-input locator, a shifted positional
input index) — the same "positional locator survives until the next
column/input is added" lesson logged once already in sub-phase D. New
`e2e/import-bulk-flow.spec.ts` and `e2e/drawing-versioning-flow.spec.ts`.
Full suite green: 25 passed, 2 intentionally skipped.

**Sub-phase F — Material status lifecycle + reorder list + row
readiness — done and verified live (2026-07-06, see ADR-033):** a new
Receiving project tab logs receiving events per material (ordered/
received/verified/staged/short/damaged/wrong — `material_receipts`, an
append-only log from sub-phase 0) with a reorder list (reusing the
existing `material_reconciliation.to_order`, no new math) and an
expandable per-material history. Only `status='received'` also bumps
the fast `materials.received` aggregate reconciliation already depends
on — every other status is log-only. Row readiness (materials ready /
area accessible / drawing approved) is now editable from the Layout
tab's row command panel — a colored corner dot on the drawing (both
the editable and read-only reference views) and a status badge
(ready/partial/blocked/complete, `row_progress`'s own precedence) —
with full undo/redo, matching every other row edit. The scheduler now
warns (`window.confirm()`, names the row, doesn't hard-block — that's
an explicit later job) before assigning a crew to a row still flagged
blocked. Materials grid gained Profile/Capacity/Condition/System
columns. Found and fixed a real bug identical in class to the layout
editor's snap-back (ADR-031): the readiness checkboxes were fully
server-controlled and visually reverted on click before the persist
round-trip landed — fixed with local state seeded from props, same
pattern. Also found a genuine Playwright deadlock while testing:
`AssignCrewForm`'s `window.confirm()` fires with no preceding `await`,
which hangs the calendar test's own `Promise.all([waitForEvent,
click()])` pattern forever — fixed with a `page.once("dialog", ...)`
listener registered before the click, awaited independently. New
`e2e/materials-lifecycle-flow.spec.ts`. Full suite green: 23 passed, 2
intentionally skipped.

**Sub-phase E — Exception dashboard + emailed reports + closeout PDF —
done and verified live (2026-07-06, see ADR-032):** a new
`/app/dashboard` — active projects with SPI risk (extracted into
shared `lib/scheduler/spi.ts`, no longer duplicated), cross-project
material shortages, blockers needing escalation (with a new "Mark
resolved" action — `blockers.resolved_at` had sat unused in the schema
since Batch 2), crew over/under-performance vs. standard pace (reusing
sub-phase D's `crew_rates`, no new computation), and "what changed
today." Auto daily/weekly emailed per-project reports via Resend
(Vercel Cron + `CRON_SECRET`) plus a manual "email now" — live-verified
against the real Resend API key: the integration works correctly, and
hit Resend's own sandbox restriction (can only send to the account's
verified email until a domain is verified), which prompted fixing the
button's message to surface that real error instead of a misleading
"no active projects." A per-project closeout PDF
(`@react-pdf/renderer` — no headless browser needed) with the as-built
drawing, reconciliation, blocker log, day-logs, and a sign-off block.
New `e2e/dashboard-flow.spec.ts`. Also fixed a real, pre-existing,
intermittent E2E flake in `packing-slip-extract-flow.spec.ts` found
along the way (an always-ambiguous locator that had only ever been
timing-lucky). Full suite green: 22 passed, 2 intentionally skipped.

**Sub-phase D — Estimation brain — done and verified live (2026-07-06,
see ADR-030):** materials now carry a `task_key` and size-aware
`labor_units` (auto-recomputed from `labor_standards` on every add/edit/
paste/AI-confirm — no manual override needed). `recomputeCrewRates`
learns each crew's real efficiency per task from install history
(90-day rolling window, blocked days excluded, hours allocated
proportional to output since day-logs don't break down by task) into
the `crew_rates` table that's existed since Phase 2 but was never
populated until now. A three-tier rate fallback (crew → company blend →
standard 1.0 pace) powers a per-project Estimate tab (full-scope +
remaining-to-finish hours, crew-days, forecast finish, a coverage-based
confidence heuristic) with an interactive what-if tool (crew count/
specific crews) and a save-to-history action, plus an optional AI
"explain this estimate" assistant (hidden outright, not just
error-prone, when `ANTHROPIC_API_KEY` is unset). A company estimating
screen (`/app/estimate`) reuses the real `projects`/`materials` tables
via a new `'estimate'` project status — paste a future job's material
list, see days and a forecast, convert to a real active project with
one click, all through the existing Materials-tab pipeline rather than
a parallel data model. Sub-phase C's capacity-view placeholder
(`materials.labor_units` read 1:1 as hours) is now upgraded in place to
real company-wide rates — zero changes needed to the calendar/Gantt
components themselves. Found and fixed a real pre-existing bug via
dogfooding: the Materials tab fully blocked adding materials on any
project with zero rows (fine before, since real projects always marked
a drawing first — a hard blocker for a pre-sale draft that never has
rows at all). New `e2e/estimating-flow.spec.ts` (draft → classify →
forecast → save → convert → appears on the real Projects list; labor
standards + crew-rates panels). Adding Task/Size/Labor columns to the
materials grid shifted an existing test's positional indices — fixed by
adding `data-testid`s throughout and rewriting `project-flow.spec.ts` to
use them. Full suite green: 20 passed, 2 intentionally skipped.

**Sub-phase C — Scheduler to flagship — done and verified live
(2026-07-06, see ADR-029):** a crew calendar across every active
project (`/scheduler/calendar`, a crew-×-day grid — the existing
per-project week view only ever shows one project), with native HTML5
drag-and-drop: drag a project onto a crew's day to assign it, drag an
existing whole-project chip to move it, with a `window.confirm()`
double-booking warning naming the conflicting project(s) before either
proceeds. A capacity figure per crew-day (planned labor load vs.
`crew.size × 8` hours) and a per-crew SPI panel, both using an explicit,
documented placeholder (`materials.labor_units` read 1:1 as hours) until
sub-phase D's learned per-crew rates replace it — genuinely useful
today, not blocked on work two sub-phases don't share. A Gantt-style
project timeline infers each phase's date range from its rows'
assignments (phases have no date columns of their own) rather than a
manually-set schedule. New `e2e/crew-calendar-flow.spec.ts` (drag
create, double-booking warning, remove) and an extension to
`e2e/scheduler-flow.spec.ts` (Timeline + per-crew SPI render from real
phase/assignment/install data). Full suite green: 18 passed, 2
intentionally skipped.

This roadmap (Phase 1 = done) is confirmed by the user — no longer a draft:

2. DB schema/RLS/storage/types
3. Projects + drawing & packing-slip uploads + materials
4. Drawing marking / row setup
5. Materials × rows grid + reconciliation + reference drawing
6. Field/Crew PWA
7. Scheduler
8. Customer portal
9. Dashboards/reports/polish

---

## Phase 1 — Foundation ✅ complete (2026-07-02)

- [x] Documentation system: `CLAUDE.md`, `docs/PROGRESS.md`,
      `docs/BUILD-LOG.md`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`.
- [x] Next.js App Router + TypeScript (strict) scaffold, ESLint, `@/*` alias.
- [x] Tailwind CSS v4 + shadcn/ui, Handy Equip theme tokens as CSS variables.
- [x] Prettier + ESLint/Prettier compatibility; `dev`/`build`/`start`/`lint`/
      `typecheck`/`format` npm scripts.
- [x] Git repo initialized, `.gitignore`, conventional-commit history.
- [x] Supabase clients (browser, server, admin) reading env vars;
      `.env.local.example` documented.
- [x] Email magic-link auth: `/login`, `/auth/callback`, sign-out.
- [x] Route guard: `proxy.ts` (middleware) + protected-layout backstop for
      `/app`, `/scheduler`, `/field`; `/portal/[token]` public.
- [x] Responsive Handy Equip-themed app shell: header, nav, signed-in user,
      sign-out.
- [x] Placeholder pages: `/app`, `/scheduler`, `/field`, `/portal/[token]`.
- [x] PWA: manifest, generated icons (192/512/512-maskable + favicon/apple
      touch icon), hand-rolled service worker, apple web-app meta tags.
- [x] README with setup, env vars, and Vercel deploy steps.
- [x] Quality gates passing (lint, typecheck, build).

## Phase 2 — DB schema/RLS/storage/types

- [x] Supabase CLI initialized, `supabase/migrations/`.
- [x] Schema: organizations, profiles, projects, drawings, packing_slips,
      materials, rows, row_materials, installs, crews, crew_members,
      assignments, targets, crew_rates, share_tokens + indexes.
- [x] Auth bootstrap trigger (`auth.users` insert → `profiles`, first user
      becomes `owner` of a new org).
- [x] RLS enabled on every table, org-scoped, `crew` role restricted.
- [x] Storage buckets `drawings` + `packing-slips`, org-scoped policies.
- [x] Views: `row_progress`, `project_progress`, `material_reconciliation`.
- [x] TypeScript `Database` types wired into Supabase clients.
- [x] **Migration applied and confirmed live** — verified read-only via the
      REST API (all tables/views/buckets present). Renamed `current_role()`
      → `current_user_role()` (collided with a reserved Postgres keyword);
      see `docs/DECISIONS.md` ADR-008 update and `docs/BUILD-LOG.md`.

## Phase 3 — Projects + drawing & packing-slip uploads + materials ✅ built (2026-07-02)

- [x] `/app` real projects list (from `project_progress`) + New project
      dialog.
- [x] `/app/project/[id]` tab shell: Overview, Layout ("mark" route),
      Materials, Progress.
- [x] Drawing upload: PDF → per-page images via pdf.js, or single image.
- [x] Packing slip upload + paste-material-list parser.
- [x] Materials inline-edit table (superseded by the Phase 5 grid — see
      below).
- [x] Overview tab: meta, stats, drawing thumbnail.
- [x] **Verified live** via `npm run test:e2e` (see Phase "Testing" below)
      — create-project-through-upload-materials flow confirmed working
      against the real Supabase project, not just self-review.

## Phase 4 — Drawing marking / row setup ✅ built (2026-07-02, reworked + multi-page 2026-07-03)

- [x] Layout tab: drawing stage with row overlays (`RowStage`).
- [x] Auto rows tool (drag box → split N equal, orientation choice).
- [x] Multi-page drawings (Sub-phase E, 2026-07-03, see ADR-024): browse
      every uploaded page; exactly one is the marking page (a project's
      first upload auto-designates, switching later is one click); every
      other page is fully zoomable/pannable/fullscreen-able but not
      markable — no drawing, moving, resizing, or keyboard shortcuts.
- [x] One direct-manipulation canvas — no separate Draw/Edit/Select
      tools (reworked 2026-07-03, see ADR-020): click to select
      (shift/ctrl-click for multi, shift-drag to marquee), drag a
      selected row's body to move the whole selection, drag empty space
      to draw, 8 resize handles on a single selection, arrow keys nudge,
      Delete/Backspace to delete.
- [x] Undo/redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) covering every mutation
      above plus rename/duplicate/auto-rows-batch/bulk assignment, each
      reverting the actual database change, not just the on-screen
      state — see ADR-020.
- [x] Sequential auto-naming, immediate persistence, multi-page aware.
- [x] Row fill % + hazard indicator for unassigned rows.
- [x] Zoom (wheel/ctrl+wheel/pinch toward cursor, +/−/Fit buttons) + pan
      (middle-mouse button or space-drag — no toggle button, see below —
      plus two-finger touch) + Fullscreen — a pure view transform, row
      coordinates stay normalized 0..1 in the DB.
- [x] Multi-select: set materials or set/create a phase for the whole
      selection in one action (`RowCommandPanel` + `BulkMaterialsPanel` /
      `PhasePicker`).
- [x] Copy a row (same geometry, placed adjacent, auto-named), with or
      without copying its material assignments.
- [x] **Verified live** — `e2e/row-workspace.spec.ts`, one continuous
      flow: draws a row at fit-zoom and again after zooming 4x over the
      same content, confirming normalized geometry matches within
      tolerance directly against the DB; click + shift-click
      multi-select with an exact row-boundary materials check; copy +
      rename; drag-move; handle-resize; arrow-key nudge; create-and-
      assign a phase; delete → undo → redo (each step confirmed via a
      real network response, not optimistic UI); reload persistence.
- [x] **Verified live** — the fixed pixel-vs-normalized fill-orientation
      bug (self-review catch, 2026-07-02) and three real bugs the
      rework's E2E pass caught (resize-handle clip boundary, Ctrl+Z
      focus loss after Delete, non-deterministic row paint order — all
      three in ADR-020) are all exercised by the E2E suite.
- [x] **Interaction rework, 2026-07-06 (see ADR-031):** removed the last
      remaining mode button (Pan/Hand toggle) — panning is now always
      available via the middle mouse button (highest input priority,
      works even over a row) or holding Space, never a mode you switch
      into. Fixed a real bug: a moved/resized row visibly snapped back
      to its old position on drop, then jumped to the new one once the
      network round trip landed — local-first optimistic geometry now
      stays showing the dropped position immediately, reconciled
      against the server-confirmed value (or reverted + toasted on
      failure) instead of clearing eagerly. Also: plain click on empty
      space and Escape both now deselect (a real UX gap, and a new
      request, respectively). New `e2e/layout-interaction-flow.spec.ts`;
      `e2e/row-workspace.spec.ts` stayed green throughout, unmodified.

## Phase 5 — Materials × rows grid + reconciliation + reference drawing ✅ built (2026-07-02)

- [x] Read-only reference drawing overlay, click-to-focus grid column.
- [x] Spreadsheet grid: sticky column/header, computed + editable cells.
- [x] Add material / paste from packing slip.
- [x] Reconciliation card (installed/assigned/needed/received/to-order, %).
- [x] **Verified live** — the E2E suite pastes a material list, assigns
      quantities across 3 rows, and asserts exact Assigned/Left/To-order
      numbers in both the grid and the reconciliation card.

## Sub-phase 0 — Schema for Field/Scheduler/Phases ✅ applied and verified live (2026-07-03)

- [x] Migration written: `phases`, `blockers`, `day_logs`,
      `project_schedule` tables; `materials.size`/`labor_units`;
      `installs.idempotency_key`/`device_id`; `rows.phase_id`;
      `drawings.role`/`projects.mark_drawing_id` (one marking page per
      project, DB-enforced via a partial unique index +
      `set_marking_drawing()`); `daily-photos` storage bucket; RLS on
      every new table; `row_progress.phase_id`. See ADR-019.
- [x] `lib/supabase/database.types.ts` hand-updated to match (ADR-010's
      pattern), so sub-phases A–F could be built and typechecked against
      the new shape immediately.
- [x] **Applied to the live Supabase project** — user provided a
      one-time personal access token; `supabase migration repair` fixed
      the remote migration history first (Batch 1's 5 migrations were
      originally applied by hand via the SQL editor, so the CLI's
      ledger didn't know about them), then `supabase db push`. Fixed a
      real bug the push caught: `row_progress`'s `CREATE OR REPLACE
    VIEW` failed because `phase_id` was inserted mid-list rather than
      appended at the end (Postgres compares view columns positionally
      on replace). Confirmed live via `supabase gen types` diffed
      against the hand-written types — exact match.

## Auth — email + password, Team management ✅ built (2026-07-03)

- [x] `/login` — email + password (`supabase.auth.signInWithPassword`),
      magic-link flow and `/auth/callback` removed entirely (ADR-017).
- [x] No public sign-up. `/app/team` (owner/pm only) — create accounts
      (email + temp password + role), change an existing member's role,
      reset their password.
- [x] `/account` — self-service change-password, any signed-in role.
- [x] Deactivate/reactivate a team member (sub-phase A, 2026-07-03) — a
      ~100-year Supabase Auth ban / lifted ban, not a delete; blocks
      sign-in and token refresh (an already-active session can keep
      working up to its natural ~1h expiry). Self-lockout guarded, same
      as the role-change action.
- [x] **Verified live** — `e2e/team-flow.spec.ts` creates a member,
      changes their role (confirmed persisted across a real page reload,
      not just optimistic client state), resets their password,
      deactivates then reactivates them (confirmed via the admin API's
      `banned_until`), and exercises the self-service change-password
      flow. This run is also the standing proof that email+password
      login works end to end on localhost; production
      (`https://handy-pm.vercel.app`) was verified separately the same
      way it was built (see `docs/BUILD-LOG.md` 2026-07-03 entries).

## Testing ✅ built (2026-07-02, extended 2026-07-03)

- [x] `scripts/seed.mjs` — idempotent org + confirmed test user (+ known
      password, reset every run), replaces the old manual "rename the
      org" one-off SQL snippet.
- [x] Playwright E2E suite (`npm run test:e2e`) against the live Supabase
      project: real `/login` form sign-in (no admin backdoor needed now
      that auth is password-based), full create-project→mark-rows→
      assign-materials→verify-reconciliation flow, self-cleaning.
- [x] `e2e/team-flow.spec.ts` — Team screen create/role-change/
      password-reset + self-service change-password, self-cleaning.
- [x] `e2e/row-workspace.spec.ts` — zoom-invariant drawing accuracy
      (verified against the DB), multi-select + bulk quantities with an
      exact-boundary check, duplicate-with-materials, reload persistence.
- [x] Found and fixed a real bug on its first run — see ADR-016.
- [x] `e2e/field-flow.spec.ts` (2026-07-03, mobile viewport) — project
      pick, crew pick, material install, blocker + photo, offline queue
      (genuinely goes offline mid-test), day confirm + close.
- [x] `e2e/scheduler-flow.spec.ts` (2026-07-03) — crew + member creation,
      schedule build (confirms weekends actually skipped), target
      generation, assign + unassign a crew, each verified against the DB.
- [x] `e2e/phases-flow.spec.ts` (2026-07-03) — assign a row to a new
      phase and confirm its border color actually changed (polled via
      `getComputedStyle`), hide/un-hide the phase, filter Materials and
      Progress by phase.
- [x] `e2e/multi-page-flow.spec.ts` (2026-07-03) — first upload
      auto-marks; a second page is view-only (confirms a drag there
      creates zero rows, via a direct DB count); zoom/fullscreen still
      work on it; switching the marking page flips both pages' roles
      correctly.
- [x] `e2e/packing-slip-extract-flow.spec.ts` (2026-07-03) — two tests,
      mutually exclusive on whether `ANTHROPIC_API_KEY` is configured
      (`test.skip` guards so exactly one runs anywhere): the no-key path
      always runs and asserts a graceful error; the live path (needs a
      real key) renders a synthetic packing-slip image in-memory and
      checks the AI keeps two same-code/different-size lines distinct
      while dropping a freight line.
- [x] `e2e/team-settings-flow.spec.ts` (2026-07-06) — crew assignment,
      own-name edit, org settings + logo upload all confirmed to
      persist; a crew-role user in a genuinely separate browser context
      (not the shared owner storageState) is confirmed redirected away
      from every owner/pm/scheduler-gated page on direct navigation.
- [x] `e2e/voice-note-flow.spec.ts` (2026-07-06) — the no-key and live
      (AI cleanup + blocker-code flagging) paths, plus a 401 check for a
      genuinely unauthenticated request (via plain `fetch()` — both
      Playwright's `browser.newContext()` and `request.newContext()`
      were found to inconsistently carry some valid session through in
      this specific scenario, confirmed via a real cookie-less `curl` to
      the same server that correctly got 401, so the server-side guard
      itself is sound — a Playwright quirk, not a security bug).

## Phase 6 — Field/Crew PWA ✅ built (2026-07-03)

- [x] `/field` — active projects list (name, address, %).
- [x] `/field/[projectId]` — rows colored by phase, % or "no materials";
      tap a row for its material steppers.
- [x] Per-material qty stepper: +/− adjust a pending amount, "Log +N"
      records an install delta, "Correct −N" for a mis-count (the
      `installs` log is append-only; a correction is a negative entry,
      never an edit/delete of a prior one).
- [x] Offline queue for install deltas: queues in `localStorage` when the
      request fails or the browser is already offline, shows a "N
      updates pending sync" indicator, drains automatically on
      reconnect. Idempotency-key-safe — a retried delta after a dropped
      connection can't double-count.
- [x] Report a blocker (10 fixed codes, note, optional photo → the
      `daily-photos` bucket), scoped to a row or the whole project.
- [x] Confirm the day: arrived / offload start+end / install start+end,
      each a tap-to-mark-now (with reset), plus a note; "Close the day"
      sets departed_at.
- [x] Crew picker: remembered per-device (`localStorage`), not tied to
      login — matches a shared job-site phone better than a personal
      account would. Degrades cleanly to "no crew selected."
- [x] **Verified live** — `e2e/field-flow.spec.ts`, including the
      offline queue actually going offline and back (not simulated by
      mocking) and draining into the database on reconnect.

## Phase 7 — Scheduler ✅ built (2026-07-03)

- [x] `/scheduler` — crew CRUD (name, size, cost/hour) + members
      (add/remove), active-project list linking into each project's
      scheduler workspace.
- [x] `/scheduler/[projectId]` — planned days, a date-range schedule
      builder (skip weekends by default, tap any day to exclude it e.g.
      a holiday, rebuildable).
- [x] "Generate targets from today forward": splits each material's
      remaining qty (assigned − installed, not the Materials tab's
      `left_qty` — a different number, see ADR-022) evenly across every
      remaining scheduled day, project-wide.
- [x] Week view (prev/next navigation): per scheduled day, assigned
      crews (+ unassign), target vs. actual, and a Hit/Miss/Exceeded
      badge; not-scheduled days shown dimmed for context.
- [x] Assign a crew to a day at whole-project, specific-rows, or
      a-phase's-rows granularity.
- [x] Overall Schedule Performance Index badge (actual ÷ planned,
      cumulative to today), green/amber/red.
- [x] **Verified live** — `e2e/scheduler-flow.spec.ts`.

## Sub-phase F — Packing-slip AI extraction ✅ built, ⏳ not yet live-validated (2026-07-03)

- [x] `app/api/packing-slips/extract/route.ts` — signs and fetches the
      requested packing slip, sends it to the Anthropic Messages API
      (`claude-sonnet-5`, plain `fetch()`, no new SDK dependency) as an
      `image` or `document` block depending on actual content-type, with
      a forced tool-use call for structured `{code, description, size,
      qty}[]` output. Returns a clean 500 if `ANTHROPIC_API_KEY` isn't
      configured.
- [x] `PackingSlipExtractDialog` — review/edit table (add/remove/edit
      any field) between extraction and save; "Replace the current
      list" option, same convention as `PasteMaterialsDialog`. Wired
      into both `PackingSlipUpload` (right after a fresh upload) and the
      Materials page's list of previously-uploaded slips.
- [x] `confirmExtractedMaterials` (`lib/projects/actions.ts`) — folds
      code+description+size into one `name` (keeps same-code/
      different-size lines distinguishable), writes qty to both
      `total_needed` and `received`, same shape as `pasteMaterialList`.
- [x] `.env.local.example` documents `ANTHROPIC_API_KEY` (server-only).
- [x] `npm run lint` / `typecheck` / `build` all pass.
- [x] `e2e/packing-slip-extract-flow.spec.ts` — one test asserts the
      no-key graceful-error path (always runs); one drives a real
      extraction against a synthetic in-memory packing-slip image and
      checks distinct sizes survive + non-material lines are skipped
      (skipped unless `ANTHROPIC_API_KEY` is configured).
- [x] **Live-validated (2026-07-06)** — the user provided
      `ANTHROPIC_API_KEY`; the gated E2E test ran for real against the
      synthetic packing-slip image and passed: all 4 lines extracted
      correctly, the two `36SQ10` beam lines kept their distinct sizes
      (144"/96", not merged), the freight line was correctly skipped, and
      the saved materials matched exactly. Found and fixed a test-only
      bug while validating (not an app bug): `allInnerTexts()` on the
      review table read nothing, since every cell is a real `<input>`
      and an input's value is never part of `innerText`/`textContent` —
      switched to `inputValue()` per field. Validation against the
      user's actual real-world packing slip (42"x24' upright, wire deck,
      spacers/barriers/protectors, two anchor types) is deferred by the
      user's own choice, not blocked on anything — can be revisited
      anytime by pointing the route at that file.

## Batch 4, Sub-phase 0 — PM Operating Layer schema ✅ done (2026-07-06)

- [x] `gate_templates`/`gate_template_stages`/`gate_template_items` — a
      reusable, org-editable 8-stage checklist definition (handoff/
      scope/schedule/materials/mobilize/execute/punch/closeout).
- [x] `project_stages` (one row per project per stage, single
      `locked`/`active`/`complete`/`overridden` status +
      `overridden_by`/`override_reason`) + `project_gate_items` (the
      actual checklist copied from the template at project creation).
- [x] `projects` gains `pm_user_id` (nullable — "required" is an
      application rule for sub-phase B), `stage_key` (defaults
      `'handoff'`), `last_activity_at`, `customer_contact_name`/
      `customer_contact_email`, `comms_weekly_report`/`comms_milestones`.
- [x] `scope_items` — work beyond install (teardown/remove_levels/
      add_levels/relocate/repair/other), optionally attached to a row
      or phase, sourced from handoff/estimate/change_order.
- [x] `handoff_surveys` — site conditions, constraints (jsonb), photo
      paths, dual estimator+PM sign-off columns.
- [x] `change_orders` — numbered per project, reason/status enums,
      labor_units/added_days/price, customer-approval tracking.
- [x] `project_comms` — an auditable log of everything the customer
      was told (kind/channel/recipient/subject/body snapshot).
- [x] `organizations.num_crews` (default 2) — a hard capacity
      constraint, enforced starting sub-phase G.
- [x] `project_autopsies` — estimated vs actual (days/hours/labor
      units/material variance/change orders/blocker days) + narrative.
- [x] RLS: crew read-only on stage/scope; owner/pm full manage;
      scheduler gets a narrow write exception scoped specifically to
      the Schedule stage's own rows, not every stage. Gate templates
      are owner/pm read, owner-only write ("Template management
      (owner)").
- [x] Seeded one default gate template per existing org with the
      batch's own verbatim 29-item starter checklist across all 8
      stages — confirmed live: 1 template, 8 stages, 29 items.
- [x] Types regenerated + 8 new literal-union types added
      (`GateStageKey`/`ProjectStageStatus`/`ScopeWorkType`/
      `ScopeSource`/`ChangeOrderReason`/`ChangeOrderStatus`/
      `CommsKind`/`CommsChannel`), same ADR-010 pattern as before.
- [x] Deliberately deferred: backfilling EXISTING projects' own
      `project_stages` rows — needs real judgment about where each
      project already stands, explicitly sub-phase J's job.
- [x] `npm run lint`/`typecheck`/`build` all pass. Full E2E suite
      green: 26 passed, 2 intentionally skipped — purely additive,
      zero changes needed anywhere else in the app.

## Batch 4, Sub-phase A — Stage-gate lifecycle engine, What's Next, notifications, gate nags, template management ✅ done (2026-07-06)

- [x] `ensureProjectStages` — idempotent, admin-client bootstrap of a
      project's `project_stages`/`project_gate_items` from the org's
      default template; called from the Overview page (avoids a
      circular import with `lib/projects/actions.ts`).
- [x] `project_gate_items.position` (new follow-up migration) — fixes a
      real bug where checklist order wasn't deterministic (bulk-inserted
      rows had no reliable `created_at` tiebreaker).
- [x] Gate actions: `toggleGateItem`/`signOffGateItem`/`addGateItem`/
      `removeGateItem`/`completeStage`/`overrideStage` — Complete blocked
      while items are open; Override requires a non-empty reason;
      completing/overriding unlocks the next stage and syncs
      `projects.stage_key`.
- [x] `LifecyclePanel` (8-stage stepper + expanded checklist: check
      items, attach required photos, sign off, add per-project items,
      Complete/Override) and `WhatsNextPanel` (top-3-open-plus-overdue),
      wired into the Overview page.
- [x] `listOrgWideNextActions` — dashboard-level aggregation
      (batch-fetched company-wide, same convention as
      `lib/dashboard/queries.ts`), rendered as a new "Needs attention"
      dashboard section — only stalled/overdue projects, not a
      redundant full list.
- [x] STALLED flag (`organizations.stalled_after_days`, default 3, new
      follow-up migration) — `isProjectStalled` now live and surfaced
      on the dashboard.
- [x] Owner-only template management on `/app/settings`
      (`TemplateEditor`) — add/edit-label/toggle-photo/set-signoff-role/
      remove a stage's checklist items; pm sees the same content
      read-only; never retroactively touches an already-bootstrapped
      project's own copy (`ON DELETE SET NULL` makes removal safe).
- [x] `lib/notifications/` — first application code against the
      `notifications` table (schema-only since Batch 3):
      `listMyNotifications`/`getUnreadNotificationCount`,
      `markNotificationRead`/`markAllNotificationsRead`, and a
      `notifyUsers` helper taking an already-scoped client (admin for
      the cron, cookie-scoped for future session-based call sites). A
      bell in `SiteHeader` (unread badge + dropdown + mark-read), fed by
      `(protected)/layout.tsx`.
- [x] `sendGateNags` — checks every active project daily for overdue
      items + the STALLED flag; always creates in-app notifications;
      emails each affected recipient one combined digest (gated on
      `RESEND_API_KEY`). Rides the existing daily reports cron
      (`Promise.all([sendReports("daily"), sendGateNags()])`) rather
      than a new route — Vercel's Hobby plan caps a project at 2 cron
      jobs and both were already spent.
- [x] Found and fixed: a real UX bug (`LifecyclePanel` not
      auto-following the newly-active stage after completion/override —
      "previous prop in state" pattern); a dozen pre-existing E2E specs
      broken by a new hidden file input on the Overview page racing
      their bare `input[type="file"]` locators (fixed to use the
      already-established `drawing-upload-input`/
      `packing-slip-upload-input` testids); one unrelated,
      previously-latent regression in `project-flow.spec.ts`'s
      Progress-tab check (same race-condition shape as an earlier
      sub-phase's zoom-fit finding — a same-text/same-class element
      from a different tab transiently coexisting mid-navigation).
- [x] `npm run lint`/`typecheck`/`build` all pass. New
      `e2e/gate-template-and-nags-flow.spec.ts` — template CRUD +
      role-read-only + the real cron route's actual notification/digest
      behavior end to end. Full suite green: 29 passed, 2 intentionally
      skipped; confirmed zero leftover test data in the shared org-wide
      gate template afterward.

## Batch 4, Sub-phase B — PM-of-record accountability ✅ done (2026-07-06)

- [x] `pm_user_id` required to create a real project — New Project
      form's PM dropdown defaults to the signed-in creator (always a
      valid owner/pm candidate); `createProject` server-validates
      whatever's submitted.
- [x] `reassignProjectPm` — updates `projects.pm_user_id`, inserts a
      `project_pm_history` audit row (previous/new/changed_by), sends
      up to two independent notifications (incoming PM / outgoing PM,
      skipping either leg that would just notify the actor themselves).
- [x] New `project_pm_history` table (owner/pm select+insert,
      append-only) + `project_progress` view gains `pm_user_id`
      (appended at the end, same positional-column rule as ADR-019).
- [x] PM shows everywhere: project card (`PM: name` / warning-styled
      "No PM assigned" for an active project missing one — no row at
      all on the pre-sale estimates list), Overview page
      (`PmAssignment` — inline reassign for owner/pm, read-only
      otherwise), dashboard's project list (new PM column).
- [x] "My projects only" filter on `/app` (`ProjectList`, client-side
      toggle against the signed-in user's id).
- [x] New `NotificationKind` `pm_reassigned`.
- [x] `npm run lint`/`typecheck`/`build` all pass. New
      `e2e/pm-of-record-flow.spec.ts` — confirms the default-to-creator
      value actually submits, PM shows everywhere, reassignment updates
      DB + logs history + notifies correctly (including the
      no-self-notification cases), the "My projects only" filter
      actually filters, dashboard shows the PM column. Full suite green:
      30 passed, 2 intentionally skipped — every pre-existing spec that
      creates a project through the changed form needed zero edits.

## Batch 3, Sub-phase 0 — Schema for estimating/readiness/versioning ✅ done (2026-07-06)

- [x] `materials`: `profile`/`capacity`/`condition`/`compatible_system`.
- [x] `material_receipts` — append-only receiving event log
      (ordered/received/verified/staged/short/damaged/wrong), plus the
      `org_id_of_material` RLS helper.
- [x] `rows`: `materials_ready`/`area_accessible`/`drawing_approved`;
      `row_progress` gains derived `crew_assigned` and computed
      `readiness_status` (ready/partial/blocked/complete).
- [x] `drawing_versions` — upload history + approval-for-install,
      parallel to `drawings`; existing drawings backfilled as version 1.
- [x] `labor_standards` (seeded defaults per org) + `project_estimates`
      (append-only) — the estimation engine's schema foundation.
- [x] `notifications` — per-user in-app inbox.
- [x] RLS on every new table, same `current_org_id()`/
      `current_user_role()`/`org_id_of_*()` pattern as always.
- [x] **Applied to the live Supabase project** — clean first push, no
      repair/retry needed this time.
- [x] **Types genuinely regenerated** via `supabase gen types` (first
      time ever — previously hand-written, see ADR-010) — confirmed an
      exact match modulo two deliberate, documented deviations.
- [x] `npm run lint`/`typecheck`/`build` all pass; full `npm run
      test:e2e` green (10 passed, 1 intentionally skipped) after fixing
      one real, pre-existing, date-sensitive test bug in
      `scheduler-flow.spec.ts` (unrelated to this migration).

## Batch 3, Sub-phase A — User management, org settings, role guards ✅ done (2026-07-06)

- [x] Assign a team member to a crew (`profiles.crew_id`, a `<select>`
      per row on `/app/team`).
- [x] Org settings (`/app/settings`, owner/pm only): name, address, logo
      upload (`org-logos` bucket), default working days.
- [x] Self-service display-name edit on `/account`, via a narrow
      `update_own_full_name` RPC (existing `profiles_update` RLS only
      ever let owner/pm touch profile rows, even the caller's own).
- [x] Shared `requireRole`/`requireOrg` helper (`lib/auth/session.ts`),
      applied across every mutating Server Action that previously relied
      solely on RLS with no application-level check: crews, phases,
      rows, scheduler, projects/materials/drawings, team.
- [x] `/scheduler` + `/scheduler/[projectId]` gated to owner/pm/
      scheduler at the page level (crew redirected to `/app`); nav
      updated to match.
- [x] `npm run lint`/`typecheck`/`build` all pass.
- [x] New `e2e/team-settings-flow.spec.ts` — crew assignment, own-name
      edit, and org settings (incl. logo upload) each verified to
      persist; a freshly-created crew-role user in a genuinely separate
      browser context is confirmed redirected away from every
      newly-gated page, proving the guards are real and not just hidden
      nav links. Full suite green: 14 passed, 1 intentionally skipped.
- [ ] **Not yet done, deliberately deferred to sub-phase I:** a full
      role-aware-rendering pass across every remaining screen (e.g. the
      Materials grid still shows editable inputs to every role — writes
      are blocked server-side, just not visually hidden yet).

## Batch 3, Sub-phase B — Field to flagship ✅ done (2026-07-06)

- [x] "My assignments today" on `/field`, matched client-side by crew;
      crew picker defaults to the signed-in user's own `profiles.crew_id`.
- [x] Material stepper shows "Today: +N" alongside the cumulative total
      (`listTodayInstalls`, net per crew).
- [x] Day-close review screen (times, net installs, blocker count, note,
      photos) with "← Back to edit" / "Confirm & close day" — edit/
      resume and the day-summary confirmation as one flow.
- [x] End-of-day documentation photos (`day_logs.photo_paths`, distinct
      from a blocker's own photo) — live E2E verified.
- [x] Voice-to-note: browser `SpeechRecognition` (feature-detected, no
      dead button on unsupported browsers) transcribes locally; Claude
      (`/api/field/voice-note`) cleans the transcript and flags a likely
      blocker code; crew reviews before anything saves.
- [x] Real gap found and fixed: neither the packing-slip extraction nor
      the new voice-note route had an explicit auth check (voice-note
      had none at all) — both now use `requireOrg()`.
- [x] `npm run lint`/`typecheck`/`build` all pass.
- [x] `e2e/field-flow.spec.ts` extended (day-summary review verified
      against real data, back-to-edit round trip, live photo attach/
      remove) and `e2e/voice-note-flow.spec.ts` new (no-key error, 401
      for a genuinely unauthenticated request via plain `fetch()`, and —
      gated on a real key — correct cleanup + blocker-code flagging).

## Batch 3, Sub-phase C — Scheduler to flagship ✅ done (2026-07-06)

- [x] Cross-project crew calendar (`/scheduler/calendar`) — crew-×-day
      grid across every active project, native HTML5 drag-and-drop
      (project → cell creates; chip → cell moves), double-booking
      warning via `window.confirm()` before either proceeds.
- [x] Capacity view per crew-day: planned labor load vs. `crew.size × 8`
      hours — an explicit, documented placeholder
      (`materials.labor_units` read 1:1 as hours) until sub-phase D's
      learned per-crew rates replace it.
- [x] Per-crew SPI panel alongside the existing per-project figure, same
      even-split attribution reasoning as capacity, applied to `targets`.
- [x] Gantt-style project timeline — each phase's date range inferred
      from its rows' assignments (phases have no date columns of their
      own); a phase with nothing scheduled yet has no bar.
- [x] `npm run lint`/`typecheck`/`build` all pass.
- [x] New `e2e/crew-calendar-flow.spec.ts` (drag-create, double-booking
      warning, remove — all confirmed against the DB) and an extension
      to `e2e/scheduler-flow.spec.ts` (Timeline + per-crew SPI render
      from real data). Full suite green: 18 passed, 2 intentionally
      skipped.

## Batch 3, Sub-phase D — Estimation brain ✅ done (2026-07-06)

- [x] Materials carry `task_key` + size-aware `labor_units`, recomputed
      automatically on add/edit/paste/AI-confirm (no manual override
      field) — `materials-grid.tsx` gained Task/Size/Labor columns.
- [x] `recomputeCrewRates` learns `crew_rates.units_per_hour` per crew
      per task from real install history — 90-day rolling window,
      blocked days excluded, hours allocated proportional to that day's
      labor-unit output (day-logs have no per-task time breakdown).
- [x] Three-tier rate resolution (crew-specific, once sampled enough →
      company-wide blend → standard 1.0 pace) feeds both the per-project
      estimate and the scheduler's capacity view.
- [x] Per-project Estimate tab: full-scope + remaining-to-finish hours,
      crew-days, forecast finish date, a coverage-based confidence
      heuristic, an interactive what-if tool (crew count / specific
      crews), save-to-history, optional AI "explain this estimate"
      (hidden, not just erroring, when `ANTHROPIC_API_KEY` is unset).
- [x] Company estimating screen (`/app/estimate`): paste a future job's
      material list against a real project with a new `'estimate'`
      status, see days + forecast, convert to active with one click —
      reuses the existing Materials-tab pipeline, no parallel model.
- [x] Labor standards editor + crew rates panel (with a "recompute from
      install history" action) on the estimating screen.
- [x] Sub-phase C's capacity-view placeholder upgraded in place to real
      learned rates — zero changes to the calendar/Gantt UI components.
- [x] Bug fix (found via dogfooding, pre-existing): Materials tab no
      longer blocks adding materials on a project with zero rows.
- [x] `npm run lint`/`typecheck`/`build` all pass.
- [x] New `e2e/estimating-flow.spec.ts` (draft → paste → classify →
      forecast → what-if → save → convert → shows on the real Projects
      list; labor standards + crew-rates panels). Fixed a real regression
      the new grid columns caused in `project-flow.spec.ts` (positional
      indices shifted) by adding `data-testid`s throughout instead of
      just renumbering. Full suite green: 20 passed, 2 intentionally
      skipped.

## Batch 3, Sub-phase H — Customer portal ✅ done (2026-07-06)

- [x] Public, unauthenticated, read-only status page at
      `/portal/[token]` — project name, % complete, most recent
      day-log update, next planned milestone (deadline, falling back
      to the latest saved estimate's forecast finish), only
      office-approved photos. Friendly "this link is no longer valid"
      fallback for an invalid/expired/revoked token.
- [x] New "Portal" project tab (owner/pm, hidden on `'estimate'`
      status): generate/revoke share links (optional expiry), approve
      individual day-log/blocker photos for customer visibility.
- [x] Schema: `share_tokens.revoked_at` (the table itself already
      existed in full since Phase 2) + new `approved_photos` table.
- [x] `lib/portal/public.ts` (admin client, narrow selects only —
      shortage/cost-adjacent columns never leak) vs.
      `lib/portal/{queries,actions}.ts` (RLS-scoped, office UI only) —
      deliberately split by auth context.
- [x] `npm run lint`/`typecheck`/`build` all pass.
- [x] New `e2e/customer-portal-flow.spec.ts` (seed a day-log photo +
      throwaway shortage material → generate link → approve photo →
      public page shows safe data, shortage material name never
      appears → revoke → friendly invalid-link fallback). Found and
      fixed a real test bug: an unscoped status-badge assertion had
      been silently matching the wrong element (CSS `capitalize`
      doesn't change the actual DOM text). Full suite green: 26
      passed, 2 intentionally skipped.

## Batch 3, Sub-phase I — Polish/QA/perf pass + production deploy ✅ done (2026-07-06) — BATCH 3 COMPLETE

- [x] Read-only audit (research agent) of loading states, error
      boundaries, accessibility, and performance at scale across the
      whole app — every finding with an exact file:line reference.
- [x] New root `app/error.tsx` — closes two real gaps: `(protected)/
      layout.tsx`'s own auth/profile lookup was never caught by the
      existing themed boundary (Next excludes a segment's own
      layout.tsx from that segment's error.tsx), and `/portal/[token]`
      (public, outside `(protected)`) had no error boundary at all.
- [x] `aria-label` added to 5 icon/glyph-only buttons (materials-grid
      delete, packing-slip-extract remove, field material-stepper
      +/−) + `site-header.tsx`'s main `<nav>`.
- [x] Dashboard's self-documented N+1 (`listActiveProjectsForDashboard`)
      rewritten to batch-fetch via `.in(...)` + group in memory, then
      call the same unchanged `computeProjectSpi` per project — same
      numbers, far fewer round trips at 20+ active projects.
- [x] `RowFillMarker` (every row on the marking canvas) wrapped in
      `React.memo` — every prop already a primitive, a free win at
      scale on large drawings.
- [x] New shared `components/loading-panel.tsx` + `loading.tsx` for the
      5 heaviest routes (scheduler/[projectId], materials,
      field/[projectId], dashboard, mark).
- [x] Real mobile-layout bug found via a genuine 390px-viewport pass
      (screenshotted every major screen) and fixed: `(protected)/
      layout.tsx`'s `<main>` had no `min-w-0`, so a flex item
      containing a wide table refused to shrink, pushing the entire
      page wider than the viewport — one root-level fix. Also fixed a
      long packing-slip filename missing `break-all`, and a
      non-wrapping control row on the Team page.
- [x] Vercel production env vars confirmed and completed:
      `RESEND_API_KEY`/`CRON_SECRET`/`ANTHROPIC_API_KEY` had been added
      locally during Batch 3 but never pushed to Production — pushed
      via the CLI and redeployed. Live-verified `/login`,
      `/manifest.webmanifest`, `/sw.js` all 200, and the cron route's
      bearer check now correctly 401s an unauthenticated request.
- [x] `npm run lint`/`typecheck`/`build` all pass.
- [x] Full E2E suite green: 26 passed, 2 intentionally skipped —
      including `dashboard-flow.spec.ts`, confirming the batched
      dashboard rewrite produces identical results. Found and fixed a
      real regression the new aria-labels caused in
      `field-flow.spec.ts` (locator matching the old "+" glyph).

## Batch 3, Sub-phase G — CSV/XLSX import, row-range duplication, materials bulk ops, drawing versioning ✅ done (2026-07-06)

- [x] "Import from file" dialog on the Materials tab: mode toggle
      (materials list / row assignments), auto-guessed but always
      user-editable column mapping, a preview table (per-row OK/skip
      status), replace-existing toggle for materials mode.
- [x] Row-assignment import resolves row label + material name against
      the project's existing records only — never auto-creates either;
      unresolved lines show a specific skip reason.
- [x] Installed `exceljs` + `papaparse` (not the `xlsx` npm package,
      which has an unpatched high-severity prototype-pollution advisory).
- [x] "Duplicate range ×N": select a block of 2+ rows, repeat it as one
      rigid pattern N times (right or below), with a real "also copy
      materials" checkbox (previously hardcoded true on the single-row
      Copy button) — reuses the existing `duplicateRows` action, no new
      Server Action needed.
- [x] Materials grid: bulk-select checkboxes, bulk delete, bulk
      set-condition action bar.
- [x] Drawing versioning: `lib/drawings/{queries,actions}.ts` on top of
      sub-phase 0's previously-unused `drawing_versions` table — upload
      a new version (supersedes the prior one, starts unapproved),
      approve for install, a warning banner (all roles) when the latest
      version isn't approved, version history log. First upload of a
      page auto-approves (nothing yet to review against).
- [x] `npm run lint`/`typecheck`/`build` all pass.
- [x] New `e2e/import-bulk-flow.spec.ts` (CSV materials import → CSV
      row-assignment import → bulk condition/delete → duplicate range)
      and `e2e/drawing-versioning-flow.spec.ts` (v1 auto-approved → new
      version pending → warning banner → approve → history log). Found
      and fixed a genuine test-only zoom-fit race (fixed by clicking
      "Fit to screen" for a synchronous recompute) and two regressions
      in pre-existing tests (ambiguous file-input locator, shifted
      positional input index). Full suite green: 25 passed, 2
      intentionally skipped.

## Batch 3, Sub-phase F — Material status lifecycle, reorder list, row readiness ✅ done (2026-07-06)

- [x] New Receiving project tab (hidden on `'estimate'` status, same
      convention as Layout/Progress): per-material check-in form
      (status/qty/note) against `material_receipts`; only `'received'`
      also bumps the `materials.received` aggregate, every other status
      (ordered/verified/staged/short/damaged/wrong) is log-only.
- [x] Reorder list reuses the existing `material_reconciliation.to_order`
      (no new shortage math) plus a per-status count breakdown and a
      flagged banner when short/damaged/wrong has ever been logged.
- [x] Expandable per-material "History" log (`listMaterialReceiptHistoryByProject`,
      one bulk query, newest first).
- [x] Row readiness (materials ready / area accessible / drawing
      approved) editable from the Layout tab's row command panel — full
      undo/redo, a colored corner dot on both the editable and
      read-only drawing views, and a status badge (ready/partial/
      blocked/complete, `row_progress`'s own precedence).
- [x] Scheduler warns (`window.confirm()`, names the row) before
      assigning a crew to a row still flagged blocked — warn, not
      hard-block, consistent with the double-booking warning (ADR-029).
- [x] Materials grid gained Profile/Capacity/Condition/System columns.
- [x] Bug fix: readiness checkboxes snapped back to stale state on
      click (same class as the layout editor's ADR-031 fix) — fixed
      with local `useState` seeded from props.
- [x] `npm run lint`/`typecheck`/`build` all pass.
- [x] New `e2e/materials-lifecycle-flow.spec.ts` (identity fields →
      receiving check-in → shortfall → reorder list → flagged status →
      history log → row readiness defaults to blocked → toggled →
      scheduler warning). Found and fixed a genuine Playwright dialog
      deadlock (`window.confirm()` with no preceding `await` hangs the
      calendar test's own `Promise.all` pattern) and a test-pollution
      regression in `scheduler-flow.spec.ts` (stray leftover crews from
      earlier failed runs). Full suite green: 23 passed, 2 intentionally
      skipped.

## Batch 3, Sub-phase E — Exception dashboard + emailed reports + closeout PDF ✅ done (2026-07-06)

- [x] `/app/dashboard` (owner/pm/scheduler): active projects with SPI
      risk, cross-project material shortages, blockers needing
      escalation (with a new "Mark resolved" action), crew over/under-
      performance vs. standard pace, "what changed today."
- [x] SPI logic extracted to shared `lib/scheduler/spi.ts`
      (`computeProjectSpi`/`classifySpi`) — `scheduler-workspace.tsx`
      refactored to use it instead of its own inline copy.
- [x] Auto daily/weekly emailed per-project reports (Resend, Vercel
      Cron + `CRON_SECRET`) with a marked-drawing image, %, period
      installs, blockers, on-track/at-risk — plus a manual "email now."
      Live-verified against the real Resend API key.
- [x] Per-project closeout PDF (`@react-pdf/renderer`): as-built
      drawing, material reconciliation, blocker log, day-logs, sign-off
      block. Downloadable from the project Overview tab (owner/pm).
- [x] `npm run lint`/`typecheck`/`build` all pass.
- [x] New `e2e/dashboard-flow.spec.ts` (real shortage + open blocker →
      dashboard shows both → resolve blocker → email report now → real
      Resend result → closeout PDF downloads as real, non-empty,
      valid-header PDF bytes). Fixed a real, pre-existing, intermittent
      flake in `packing-slip-extract-flow.spec.ts` found along the way.
      Full suite green: 22 passed, 2 intentionally skipped.

## Phase 8 — Customer portal ✅ built (2026-07-06, see Batch 3 Sub-phase H above)

## Phase 9 — Dashboards/reports/polish (not started)
