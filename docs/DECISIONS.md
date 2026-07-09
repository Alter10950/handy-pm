# Decisions

ADR-style log. Newest at top. Each entry: Decision, Context, Choice,
Consequences.

---

## ADR-055: Design pass v3 F1 — schedule board on the existing per-day assignment model

**Decision.** The drag-drop schedule board introduces NO new schema. A
"bar" is defined as the set of whole-project (`row_id null`) assignment
rows a crew has for a project; days inside the span with no row are
"painted off". Move/resize/reassign/paint/tray-drop/auto-plan all reduce
to one server primitive, `writeProjectBar`, which is therefore the
single enforcement point for the dispatch gate (ADR-042) and the
distinct-projects-per-day capacity hard limit (ADR-044), and the single
place that keeps `project_schedule` in sync (add newly crewed days;
remove only days the edit abandoned that no other assignment covers —
manually planned crew-less days are never touched).

**Why.** Per-day rows already model partial weeks, split crews and skip
days for free; a start/end-column "bars" table would duplicate state the
calendar and targets already read. Conflict math is pure and shared
(`lib/scheduler/board.ts`, node --test) so the client's live drag
preview and the server's authoritative check can't drift.

**Board-interaction rules learned the hard way (regression-tested):**
nothing may mount in-flow or change lane heights during a drag (the
candidate-crew hit-test reads live geometry — the ghost is an overlay,
the status pill is `fixed`), and no synchronous `window.confirm`
inside a drop dispatch (blocks dragend; yield the event loop first).

## ADR-054: Design pass v3 D2 — one FilterBar pattern, client-side, per-screen persisted

**Decision.** Every list/table filters through `useFilterState(key)` +
`<FilterBar>`: search + multi-select facets + saved views, persisted in
localStorage per user per screen (`handy-pm:filters:<key>`), filtering
in-memory on already-fetched rows. Not server-side querying, not URL
params.

**Why.** Every list in the app is org-scoped and small (dozens–hundreds
of rows) — client filtering is instant, keeps Server Components' data
fetching untouched, and localStorage gives "my screen, how I left it"
without a settings table. URL params were rejected: they leak filter
state into shared links (a PM's saved view is personal). The audit-log
table is the one exception (server-side, behind the pending migration).

## ADR-053: Phase 16 — application-level, append-only audit log

**Decision date:** 2026-07-08

**Context:** the batch calls for an audit trail (role changes, gate
overrides, CO approvals, destructive actions). Options: trigger-based CDC
on every table, or application-level events at the moments that matter.

**Choice:** one narrow `audit_events` table (org, actor, action,
entity, project, human `summary`, jsonb detail), written by
`lib/audit/log.ts#recordAudit` from the server actions themselves —
the same pattern `pm_history` already established. RLS: owner/pm read;
insert-only (no update/delete policies at all → append-only at the
policy level). Audit writes are fire-and-forget: a logging failure
(including the table not existing until the migration is approved) never
breaks the action it documents.

**Consequences:** auditable actions opt in explicitly (grep
`recordAudit` for coverage); no write amplification on hot paths
(installs/QC ticks deliberately not audited — they ARE the product's own
append-only records).

---

## ADR-052: Phase 14/15 — QC, punch list, photo phases, per-SKU flywheel

**Decision date:** 2026-07-08

**Context:** product depth on execution: "is each row DONE-done"
(quality), "what blocks closeout" (punch), a before/after photo story,
and estimates that sharpen from actuals. Receiving/staging, readiness,
targets/SPI, closeout PDF, and reports already exist from prior batches
— Phase 14/15 fill the genuine gaps rather than rebuild.

**Choices:**

- **`row_qc_checks`** — per-row checklist rows keyed by an app-defined
  vocabulary (`lib/qc/shared.ts`: plumb/anchors/shims/beam locks/decks/
  labels). Crew-writable (same trust as logging installs). Row QC status
  derives from passed-count; no separate status column to drift.
- **`punch_items`** — open/done items, optional row link + photo,
  crew-raisable, `resolved_by/at` stamped. Open items are surfaced as
  the closeout blocker signal.
- **`approved_photos.phase`** (before/during/after) — the CURATED set
  (portal + closeout) gets the story arc; raw `day_logs.photo_paths`
  stay untagged.
- **`recomputeCrewSkuRates`** (`lib/estimating/flywheel.ts`) — learns
  hours-per-unit per (crew, SKU) from the same rolling window /
  blocker-exclusion / proportional-attribution rules the task-key
  learner uses (weights = engine STANDARD hours, not the poisoned stored
  labor_units). Only SKU-linked materials teach, so the flywheel
  self-activates after the Phase 13 backfill and feeds
  `resolveStandard()`'s top tier.
- **Everything ships dark behind guarded reads** (ADR-051 pattern):
  missing relations render "awaiting migration" panels, actions throw a
  clear pending-migration message, and the new E2E spec skips itself
  until `punch_items` exists.

---

## ADR-051: Phase 13 wiring — read-time attributes now, catalog tiers on migration

**Decision date:** 2026-07-08

**Context:** the corrective migration
(`20260708120000_sku_catalog_labor_standards.sql`) and backfill script
are authored, but `supabase db push` against the LIVE production
database was blocked by the session's permission gate (it contains
data-mutating UPDATEs to `labor_standards`; a human should approve).
The 25,268-hour estimate bug shouldn't wait on that approval.

**Choice — the fix ships in two self-activating layers.**
Layer 1 (no schema change): `lib/estimating/standards.ts` parses SKU
attributes at read time from each material's (name, size) via
`lib/skus/parse.ts` and resolves standards through the pure engine.
`labor_standards` rows participate ONLY if their `unit_basis` is
per-each/per-piece — the poisoned `per_linear_ft`/`per_ft_height` seed
rows are ignored in favor of the engine's in-code
`CATEGORY_DEFAULT_HOURS`, so estimates are sane immediately, before any
DB change. Layer 2 (after Alter approves the push + backfill): the SKU
catalog persists parsed attributes (office-editable, `needs_review`
flow), materials point at `sku_id`, and the per-SKU / learned crew×SKU
tiers activate through the same `resolveStandard()` precedence — no
further code change. Reads of the new tables are guarded so a missing
relation degrades to Layer 1 instead of erroring.

**Choice — old `crew_rates` are quarantined from the new engine.** Their
`units_per_hour` was learned against the poisoned labor_units and would
re-import the corruption; V2 confidence comes from standard-source
coverage until `crew_sku_rates` accumulates real samples (Phase 15
flywheel).

**Choice — stored `materials.labor_units` is repaired by recompute.**
It's derived data (hours/unit at standard pace); the backfill recomputes
it from the corrected model while leaving every raw input (name, size,
task_key, quantities, installs) untouched — that's the "lossless
backfill."

**Consequences:** the Estimate tab is correct from this commit onward;
the migration becomes a pure enhancement (catalog + overrides +
learning) rather than a prerequisite; a NEEDS ME item tracks the
approval.

---

## ADR-050: Phase 11 — component library strategy (generate, then refine)

**Decision date:** 2026-07-08

**Context:** Phase 11 rebuilds the shared component layer. Two sourcing
options: hand-write everything, or generate from the shadcn base-nova
registry (the project's existing component pipeline) and refine.

**Choice — generate what the registry has, hand-build what it doesn't,
and allow surgical refinement of generated files.** Generated via CLI:
tooltip, popover, dropdown-menu, sheet, tabs, select, checkbox, switch,
card, breadcrumb, spinner, sonner, combobox, input-group. Hand-built on
Base UI primitives: `NumberStepper` (number-field), `FileDropzone`,
`ConfirmDialog`, plus the pure-Tailwind primitives (`DataGrid`,
`StatTile`, `StatusPill`, `Segmented`, `ProgressBar/Ring`, `PageHeader`,
`EmptyState` family, `Toolbar`, `Sparkline`). CLAUDE.md's "don't
hand-edit `components/ui`" rule is relaxed to "generated files may be
refined when the design system requires it, and the refinement is
documented": Button gains brand hover/pressed ramps (opacity ramps washed
yellow out on white), a `loading` prop, `destructive-solid`, and 44px
`field`/`icon-field` sizes; Sonner's Toaster reads our `html.dark` class
via `useSyncExternalStore` instead of `next-themes` (dependency removed).
Date entry stays native `<input type="date">` — mobile browsers give
crews the OS picker, which beats any JS calendar on a jobsite phone.

**Choice — AppShell replaces SiteHeader.** Desktop gets a fixed 240px
sidebar (grouped, role-gated nav; active = raised neutral chip + 2px
brand bar — never a yellow slab); mobile gets a top bar + a bottom tab
bar (first four nav items + "More" sheet, ≥44px targets, safe-area
padding for the PWA). `components/site-header.tsx` deleted. E2E nav
assertions hold: role-gating logic is identical, and Playwright's
visibility assertions ignore the `lg:hidden` duplicate nav.

**Consequences:** every screen redesign (Phase 12) composes these
primitives instead of bespoke markup; `/styleguide` renders the full
gallery so drift is visible immediately; `npm run test:unit` covers the
estimate engine/parser without a test-framework dependency.

---

## ADR-049: Phase 13 core — pure unit-typed estimate engine

**Decision date:** 2026-07-08

**Context:** the live estimate lumped every SKU under one per-task rate
and fed raw inches into a per-foot rate (144" stepbeam → 7.20 h). Full
scope read 25,268 h / "forecast finish Jul 5 2036."

**Choice:** `lib/estimating/engine.ts` is pure and dependency-free — no
Supabase, no parsing, no Date. Dimensions are typed inches;
`inchesToFeet()` is the module's only conversion. Beam labor is
per-PIECE with length/weight as bounded modifiers. Standards resolve
learned (crew×SKU, ≥3 samples) → per-SKU → category default×modifiers,
each line carrying source + confidence. Guardrails
(`standardWarnings`, `MAX_SANE_CREW_DAYS`) make implausible outputs
loud. Free-text parsing lives only in `lib/skus/parse.ts` and runs at
backfill/import time; bare numbers are inches, feet only via explicit
`'`/`ft` marks. 14 `node:test` unit tests (incl. the 144"-beam
regression and a Bingo-scale sanity range) run via `npm run test:unit`
(`allowImportingTsExtensions` added for Node's native type stripping).

**Consequences:** the inches-as-feet class of bug is unrepresentable at
calc time; Phase 13's migrations only need to load typed rows and call
`computeProjectLines`/`computeCrewDays`.

---

## ADR-048: Phase 10 — light-first design system foundation

**Decision date:** 2026-07-08

**Context:** the owner's verdict on the live UI: "looks set up stupid,
like AI only has two or three features" — a default-shadcn dark scaffold
with yellow flooding nav pills, buttons, and bars. The Phases 10–16 batch
replaces the presentation layer. Phase 10 lays the token foundation
everything else consumes.

**Choice — light becomes the DEFAULT theme; dark becomes the opt-in.**
This inverts CLAUDE.md's original "single fixed dark theme" rule by
explicit product direction. Implementation is a token-value swap, not a
component rewrite: every screen already consumes semantic classes
(`bg-background`, `text-foreground`, `border-border`, …), so re-pointing
`:root` at the light values flips the whole app at once, and the `.dark`
class carries the warm-charcoal set behind a `<ThemeToggle/>` persisted at
`localStorage["handy-pm:theme"]` and applied pre-paint by an inline
script in the root layout (no flash). `.force-light` re-applies the light
set on a subtree — `app/portal/layout.tsx` wraps everything
customer-facing so the Portal (and print) are always light. Verified
visually post-flip: canvas #F7F7F5, white cards, hairline borders, ink
text; Bingo Warehouse loads intact.

**Choice — `--accent` stays the neutral hover wash; brand yellow lives on
`--primary`/`--brand`.** The batch spec names `--accent` for brand
yellow, but shadcn's `accent` token is the neutral interaction wash every
existing component consumes (`hover:bg-accent`, `aria-expanded:bg-accent`)
— redefining it to yellow would turn every hover state yellow, the exact
"yellow everywhere" disease this system kills. So: `--brand`,
`--brand-hover`, `--brand-pressed`, `--brand-subtle` carry the spec's
accent roles; `--accent` remains neutral; documented prominently in
DESIGN-SYSTEM.md.

**Choice — warning is hue-shifted orange (#D97706).** On a light UI,
amber and brand yellow collide; semantic warning must never read as
brand. Success #16A34A, danger #DC2626, info #2563EB, each with `-subtle`
backgrounds and `-fg` text variants tuned for white.

**Choice — depth via elevation tokens, not color.** Four soft, low-spread
shadows (`--elevation-1..4`, exposed as `shadow-e1..e4`) plus three border
weights; the off-white canvas under pure-white cards does the rest.
Spacing on a 4px base, radius 6/10/14/20/pill, motion 120/180/220ms with
standard/emphasized easings, a global keyboard-only focus ring (2px
yellow, offset), and `prefers-reduced-motion` collapsing all animation
globally.

**Choice — type scale as utility classes** (`type-display-lg` …
`type-overline`): size/line-height/tracking/weight pairs on Geist
(retained — it's on the spec's approved list and already self-hosted via
next/font), with `.num`/tabular figures as the numeric style for all
tables/stats. The scale lives in globals.css so the styleguide and every
Phase 11/12 component share one definition.

**Choice — /styleguide as the living source of truth**, office-gated:
renders the full palette with LIVE WCAG contrast ratios (computed from
the resolved CSS variables, re-reading on theme flips via a
MutationObserver-backed `useSyncExternalStore`), the type scale, spacing/
radius/elevation/motion samples, and a primitives section that grows with
Phase 11. A hydration gate returns empty tokens until mounted so server
and hydration markup agree.

**Consequences:** `app/globals.css` rewritten as the single token layer
(light `:root`/`.force-light`, dark `.dark`, Tailwind `@theme` mappings
including new `surface/border-subtle/brand/semantic-subtle/fg/chart-1..8/
shadow-e*` utilities); root layout gains the pre-paint theme script,
light `themeColor`, and default status-bar style; new
`components/theme-toggle.tsx`, `app/portal/layout.tsx`,
`app/(protected)/styleguide/` + `components/styleguide/styleguide-view.tsx`;
new `docs/DESIGN-SYSTEM.md`. Old shadcn radius multipliers replaced by
fixed 6/10/14/20. CLAUDE.md's theme section to be updated with the batch
(light-first) so the operating manual matches reality. Screens keep their
existing markup this phase — the yellow-slab nav/toggles remain until
Phases 11–12 restyle them; the full E2E suite verifies the flip broke no
functionality.

---

## ADR-047: Batch 4, Sub-phase J — polish, QA, backfill, deploy

**Decision date:** 2026-07-07

**Context:** the batch's closing pass — states/mobile/roles audits, the
full-lifecycle integration walk, dashboard scale check, backfilling the
two real pre-Batch-4 projects, and production deployment.

**Choice — evidence-based backfill, not a blanket stage:**
`scripts/backfill-batch4.mjs` (idempotent; only touches ACTIVE projects
with NO stage rows) bootstraps stages from the org template, then
positions each project by what the database can actually prove:
installs → execute; a committed schedule → materials; layout rows →
schedule; nothing → handoff. Earlier stages get
`status='overridden', override_reason='pre-Batch-4 backfill'` — visible
on the dashboard's override list like any other accountable skip.
Run against the live DB: Bingo Warehouse (has a layout) → schedule
with handoff/scope overridden; CNC Building 5 (no in-app data) → a
clean handoff start. Verified idempotent (second run: both skipped).

**Choice — one segment-level loading skeleton, not per-route
spinners:** the codebase had NO loading.tsx anywhere (all pages are
force-dynamic and fast locally, but slow connections stare at the
previous page during navigation). One `app/(protected)/loading.tsx`
skeleton covers every protected navigation; empty/error states were
verified already built into each new screen during its own sub-phase
(every new page has an explicit empty state; every form surfaces
action errors; page throws land in the existing error boundary).

**Role-permission audit result:** every mutating Server Action across
the batch's nine new/changed action modules calls
requireRole/requireOrg first (grep-verified per module), with exactly
two deliberate exceptions — the tokenized CO approve/decline
(`public-actions.ts`, ADR-043's single-use-token trust model) — and
the AI routes split correctly (handoff-draft: requireOrg, touches no
role-gated data; autopsy-narrative: requireRole owner/pm, reads
office-only data). RLS remains the second, independent layer under all
of it.

**The lifecycle walk (e2e/full-lifecycle-flow.spec.ts):** one project
driven creation → closeout through every gate with every transition
asserted in the DB: handoff completed LEGITIMATELY (survey + photo +
estimator sign-off + a real pm-role user's sign-off in a second
session), scope as the override path, schedule committed (capacity +
customer-notified auto-ticks; "Crew assigned" hand-ticked — the
checklist item means "crew identified"; the assignment itself is the
dispatch act and stays correctly blocked until Mobilize, which the
walk proves by attempting it and asserting the rejection + zero rows),
materials verified on the worksheet (server recompute passes), the
same dispatch succeeding after Materials completes, an approved CO
mid-Execute (merged material asserted), punch, and closeout with the
autopsy auto-ticking its item — final state: 7 complete + 1 overridden,
stage_key='closeout'. Passed first try, 54s.

**Mobile + scale (e2e/polish-qa-flow.spec.ts):** at 390×844 the
lifecycle stepper, verification worksheet (touch targets ≥44px,
one-tap confirm works), and capacity board (wide grid scrolls in its
own container) all operate with zero page-body horizontal overflow;
the dashboard renders 25 admin-created active projects well inside a
15s dev budget (~1s actual) — the batched org-wide query pattern
(ADR-031/038/042) holding at scale.

**A latent test bug the backfill exposed:** lifecycle-flow polled
`project_gate_items` by label alone with `.single()` — fine while only
one project had bootstrapped stages, ambiguous the moment the two real
backfilled projects carried the same seeded labels. Fixed by scoping
through the project's own stage id; audited every other spec's
gate-item queries (all already scoped).

**Deploy state and the one NEEDS-YOU:** every push this batch built on
Vercel — but as PREVIEW deployments; the project's production branch
setting doesn't match `master`, so production still runs pre-Batch-4
code. Promoting a build to production is deliberately left to Alter
(the auto-mode permission boundary agrees): either promote the latest
preview (`npx vercel promote <latest-preview-url>`) or — the permanent
fix — set the production branch to `master` in Vercel → Settings →
Git, after which the next push deploys production automatically. The
backfill has already run against the live database (shared by preview
and production), so the data is ready the moment the code lands.

**Consequences:** New `app/(protected)/loading.tsx`,
`scripts/backfill-batch4.mjs` (run + verified live),
`e2e/full-lifecycle-flow.spec.ts`, `e2e/polish-qa-flow.spec.ts`, and
the lifecycle-flow scoping fix. Full suite green: 41 passed, 3
intentionally skipped; zero leftover test data; the org's two real
projects positioned correctly with auditable backfill overrides.

---

## ADR-046: Batch 4, Sub-phase I — closeout autopsy

**Decision date:** 2026-07-06

**Context:** without a structured look-back, every estimate repeats the
last one's mistakes — iBuy's overrun taught nothing because nothing
recorded what "over" even was. Sub-phase 0 created `project_autopsies`;
this sub-phase computes it, renders it, feeds it back into the
estimation brain, and trends it company-wide.

**Choice — the estimated side is the ORIGINAL estimate, not the
latest:** the baseline judged against is
`projects.original_estimate_*` (the deal-time snapshot, ADR-043),
falling back to the FIRST saved `project_estimates` row — the earliest
belief is the honest one; judging against the latest estimate (already
corrected mid-job) would grade the test after erasing the wrong
answers. Actuals: distinct install dates (days on site), summed
day-log install windows (productive hours), installs × per-unit labor
plus completed scope items (labor units), the reconciliation rows
verbatim (material variance jsonb), approved COs (count + added days),
and blockers as distinct affected days — total and per code (new
`blocker_breakdown` jsonb column, the one schema addition).

**Choice — verdicts are ±10% bands computed at render, never stored:**
under/on/over + signed % (`verdict()` in lib/autopsy/shared) — storing
them would just create a second copy to drift. Regeneration is safe and
expected (numbers recompute from ground truth; the narrative — human
text — survives via upsert semantics that never touch it).

**Choice — feeding the estimation brain is two existing mechanisms, not
a new one:** (1) generating an autopsy triggers `recomputeCrewRates()`
— the rolling window already makes recent actuals the highest-weight
data by construction, so "actuals become the highest-weight data" is
the existing learner run at the moment new history lands; (2)
`listLaborStandardDivergence` compares the company-blended learned
rates (≥3 samples, the estimator's own trust bar) against the 1.0
units/hour definition — a task_key far from 1.0 means its seed
hours-per-unit is wrong by about that factor, flagged on the company
view with a plain-language direction ("quotes will run ~40% over at
this seed").

**Choice — the AI narrative is optional, numbers-first, and lands in an
editable box:** `/api/autopsy/narrative` follows the established
bare-fetch/forced-tool pattern (ADR-025) but gates on
`requireRole(["owner","pm"])` rather than requireOrg — unlike the
packing-slip/voice-note routes it READS office-only data (the autopsy
row) to build its prompt. Max 5 lines, explicitly told the numbers are
the source of truth; the draft only ever fills the textarea, and
`saveAutopsyNarrative` persists whatever the human left there.

**Choice — surfaces:** the AutopsyPanel lives on the Progress tab
(owner/pm only — project_autopsies RLS is office-only, so other roles
don't even query), generation auto-ticks the seeded "Autopsy generated"
closeout item (same label sync as ADR-041/042/044), the closeout PDF
gains an estimated-vs-actual section with verdict text, "Email to
owners" sends a summary to owner-role emails (owners are the
bid-accuracy audience), and `/app/estimate` gains the company view —
every autopsied project's day/labor variance in one table plus the
labor-standard divergence flags, right above the labor standards
editor those flags tell you to adjust.

**Found while building:** a `"use server"` file can't even re-export a
TYPE (`export type { AutopsyRow }`) — the actions-module transform
emits a runtime re-export for every export name and crashes the page
with `ReferenceError: AutopsyRow is not defined`. Also (test-side):
react-pdf's `<Image>` decodes raster formats only — an SVG behind the
marking-drawing row trips its font machinery ("Font family not
registered: sans-serif"); real uploads are always JPEG (the client
re-encode), so this only ever bites admin-fabricated fixtures.

**Consequences:** New migration
`20260707200000_autopsy_blocker_breakdown.sql`. New
`lib/autopsy/{shared,queries,actions}.ts`,
`components/autopsy/{autopsy-panel,estimate-accuracy}.tsx`,
`/api/autopsy/narrative`, the Progress-tab panel, the closeout-PDF
autopsy section, and the `/app/estimate` accuracy view. New
`e2e/autopsy-flow.spec.ts` — fabricates a finished project (20 lu / 10
days estimated vs 24 lu / 12 days / 24 h actual, 3 blocker days across
2 codes, one approved CO) and asserts the exact stored numbers, the
"20% over estimate" verdicts in the UI, the auto-ticked gate item, a
live AI narrative draft + save, the owner-email path (accepting
Resend's sandbox rejection as proof the full path ran — domain
verification is a standing NEEDS-YOU), the PDF including the section,
and the company view showing +20%. Full suite green: 38 passed, 3
intentionally skipped.

---

## ADR-045: Batch 4, Sub-phase H — customer communication plan

**Decision date:** 2026-07-06

**Context:** iBuy's customer was never told the schedule — slips were
discovered, not communicated. Sub-phase 0 gave `projects` the contact/
preference columns and created `project_comms` (the audit log of
everything the customer was told); the portal (Batch 3) is the pull
channel. This sub-phase builds the push channel: auto milestones, an
auto weekly customer report, proactive slip notices, and manual logging
— all landing in one per-project Comms tab.

**Choice — milestones are hooked to the events themselves, sent via the
admin client, and deduped by their own log:** `lib/comms/milestones.ts`
is called from the success paths that ARE the milestones —
`setProjectSchedule` (schedule confirmed), `completeStage`/
`overrideStage` via the stage that just finished (mobilize→install
started, punch→punch complete, closeout→closed out), and
`logInstallDelta` (50% crossed; a phase's rows all complete). The admin
client is deliberate: the triggering session varies from scheduler to
owner to CREW (whose RLS can't insert into office-only project_comms),
and the milestone is the org talking to its customer, not the
individual user (same reasoning as the report sender, ADR-032). Dedupe
is an exact (project, kind='milestone', subject) match against
project_comms itself — the log of what was sent doubles as the guard
against sending it twice, so the hooks only ever detect "the condition
holds now," never "it just changed." Every hook is best-effort: a comms
hiccup must never fail a schedule save or a crew's install log.
Ordering nuance: an overridden stage still fires its milestone (the
customer-facing fact — install started — holds either way), but
"Customer notified of schedule" only auto-ticks when the milestone
actually SENT, never on a skip.

**Choice — the finish-changed notice is deliberately half-automatic:**
the estimate panel detects the change (this save's forecast vs the last
SAVED estimate) and prompts; the REASON is typed by a human, because the
brief's safety layer ("material logistics," not "supplier shipped wrong
beams") is a judgment no lookup table makes safely. There is no
automatic internal→customer phrase translation anywhere — customer-visible
free text is always human-authored, and the automated
templates contain only facts (dates, percentages, phase names).
`sendFinishChangedNotice` throws with a specific message when it can't
send (no email / opted out / no Resend), because a PM who clicked
"Notify customer" must know the customer was NOT notified.

**Choice — the weekly customer report is a separate SAFE composer, not
a filtered internal report:** `lib/comms/customer-report.ts` builds
from scratch — % complete, units + days worked this week, scheduled
days next week, expected finish — so internal signals (shortages,
costs, SPI/risk labels, blockers, reconciliation) are excluded by
construction rather than by remembering to strip them. The E2E test
asserts the logged `body_snapshot` contains no internal markers. It
rides the existing weekly cron (`Promise.all` with the internal
reports — the Vercel Hobby 2-cron cap again, ADR-038) filtered to
active + opted-in + Execute/Punch stage + email on file ("default on
while in Execute": the schema default is true, the stage filter is what
keeps a project from mailing before work starts or after closeout). A
"Send update now" button on the Comms tab sends the same report on
demand, bypassing the stage filter — the explicit click is the opt-in.

**Choice — every send logs its exact payload:** `body_snapshot` stores
the full HTML that went out, and the Comms tab renders it (email
snapshots are app-composed HTML; manual entries render as text). The
comms log being the COMPLETE record — including phone calls via the
manual form (kind 'manual', channel logged_call/logged_other) — is the
whole point: "what does the customer know?" has one answer, in one
place.

**Consequences:** New `lib/comms/{milestones,customer-report,queries,
actions}.ts`, `components/comms/comms-workspace.tsx`, a "Comms" tab
(office-only, same two-layer gating as Handoff/COs), hooks in
`setProjectSchedule`/`completeStage`/`overrideStage`/`logInstallDelta`,
the finish-changed prompt in `ProjectEstimatePanel`, and the weekly
cron route sending customer reports alongside internal ones. No new
tables — Sub-phase 0's schema covered it. New `e2e/comms-flow.spec.ts`
drives every milestone kind end to end with REAL Resend sends
(schedule confirmed + gate-item tick, install started via five UI
overrides, 50% and phase-complete via real field-app stepper taps,
finish-changed via the prompt with old→new+reason asserted in the
logged body, punch + closeout, the safe report's snapshot asserted to
contain NO internal markers, and a manual call log) — all verified
against project_comms in the DB, not just the UI. Full suite green: 37
passed, 3 intentionally skipped.

---

## ADR-044: Batch 4, Sub-phase G — two-crew capacity board (enforce, don't warn)

**Decision date:** 2026-07-06

**Context:** iBuy ran long partly because dates were promised that the
org's two crews could never keep. `organizations.num_crews` existed
since Sub-phase 0 (default 2) with nothing enforcing it; the Batch-3
crew calendar warns about double-booking one CREW, but nothing stopped
committing more concurrent PROJECTS than there are crews at all.

**Choice — the capacity model is deliberately coarse: one scheduled
project-day = one crew-day:** a project with work scheduled on a date
needs at least one crew there, so the number of distinct ACTIVE projects
scheduled on any date can't exceed num_crews. No fractional crew-days,
no size-weighted math — the failure this prevents (promising two
customers the same crew) lives at the day-of-commitment level, and a
finer model would demand data nobody enters at scheduling time. Only
`status='active'` projects consume capacity (an estimate draft or a
completed job holding stale schedule rows blocks no one).

**Choice — `setProjectSchedule` is the enforcement point and returns
conflicts instead of throwing:** committing dates IS the promise, so
that's where the gate lives (`checkScheduleCapacity` → per-date
conflicting project names + the first feasible start). The action now
returns a discriminated result (`{ok:false, conflicts, suggestedStart,
numCrews}`) rather than throwing a stringly-typed error — the
ScheduleBuilder renders the explanation, a one-click "Use this start"
(shifting the same window length), and the owner-only override path.
The first-feasible-start scan walks the org's default_working_days for
a same-length conflict-free run, bounded at a year — if a year out is
still full it honestly returns null rather than inventing a date.
Assignments (`createAssignment`) are deliberately NOT capacity-gated:
they're bounded by real crews existing, already warn on double-booking
(ADR-029), and Sub-phase E's dispatch gate covers them; the capacity
constraint is about the schedule promise.

**Choice — owner override, logged to its own table, surfaced on the
dashboard:** `capacity_overrides` (project, required reason, the
conflicting dates as a snapshot, who, when) — insert-only, owner-only
write per the brief's "Owner override with reason," read by
owner/pm/scheduler. Surfaced as a "Capacity overrides" dashboard
section beside "Overridden gates" — same exceptions-only convention
(ADR-042), because an override nobody sees isn't accountable. A
capacity-overridden save deliberately does NOT auto-tick the "Dates
committed within capacity" gate item — the dates are not within
capacity, and the checklist shouldn't say they are.

**Choice — the Capacity Board reads at two levels:** a month grid
(`/scheduler/capacity`, prev/next month links) whose "Committed" row
shows the capacity-consuming truth (scheduled projects per day,
over-capacity days red) and whose crew lanes below show actual
whole-project assignments — commitments and gaps at a glance, per the
brief's "what you look at before promising a customer a date." It's a
read-only Server Component: committing/fixing happens in the
per-project builder, dispatching in the crew calendar; the board is the
view that tells you which of those to open.

**Choice — gate items auto-tick from real events, tick-only:** "Dates
committed within capacity" ticks on a conflict-free schedule save;
"Crew assigned" (same Schedule stage, literally this event) ticks on
createAssignment — both via the same label-lookup sync as
handoff/materials (ADR-041/042).

**Known coupling, documented not hidden:** the E2E suite runs against
the org's real capacity. Today the two real projects hold no future
schedule rows, so specs scheduling today+13 pass; the day real
schedules fill a week, schedule-saving specs will surface the capacity
panel — which is the feature working, not flaking. The fix then is
pointing those specs at far-future windows, not weakening the gate.

**A race found by the full suite, fixed at the root (in Sub-phase F's
code):** the public CO decision page intermittently replaced its
"Approved — thank you!" card with the invalid-link shell. Deciding
nulls the single-use token BY DESIGN; both a manual `router.refresh()`
and — subtler — `revalidatePath` calls inside the public server action
make the customer's own router refetch the now-unresolvable page,
unmounting the confirmation mid-read. Both removed: the local decided
state is the terminal UI, and the office pages those revalidations
would have freshened are all force-dynamic anyway. Passed twice
standalone before the loaded full-suite run exposed the ordering — the
same lesson as ADR-040's detour: a test that only fails under load is
still a real bug.

**Consequences:** New migration
`20260707190000_capacity_overrides.sql`. New `lib/scheduler/capacity.ts`
(`checkScheduleCapacity`, `getCapacityBoardData`,
`listCapacityOverrides`), `/scheduler/capacity` page + nav link,
`components/dashboard/capacity-override-list.tsx`, ScheduleBuilder's
conflict panel + owner override UI (`isOwner` threaded from the page),
`setProjectSchedule(projectId, dates, override?)` returning
`SetScheduleResult`, and the two Schedule-stage gate-item syncs. New
`e2e/capacity-flow.spec.ts` (clean save auto-ticks the item; a third
project over 2-crew capacity is blocked with both conflicting projects
named + a feasible start; owner override saves, logs with reason/dates,
and leaves the item unticked; dashboard shows the override; the board
shows all three commitments on the over-committed month). Full suite
green: 36 passed, 3 intentionally skipped.

---

## ADR-043: Batch 4, Sub-phase F — change orders

**Decision date:** 2026-07-06

**Context:** iBuy's margin died by a thousand silent cuts — teardown
nobody priced, materials added mid-install, days added without anyone
deciding they were billable. Sub-phase 0 created the `change_orders`
table (numbered per project, reason/status enums, price + approval
bookkeeping columns); this sub-phase builds the entire workflow on it:
draft → lines → send-or-record → approve/reject → merge.

**Choice — draft lines live in their own `change_order_items` table and
merge into scope_items/materials only on approval:** the alternative
(create real scope_items/materials rows immediately, tagged with the CO,
filtered out while unapproved) would have required a CO-status join in
every consumer that exists today — estimator, scheduler, field app,
reconciliation view, Scope tab — and any future one that forgets the
filter silently counts unapproved work. Draft-then-merge inverts the
risk: unapproved work is structurally invisible everywhere, and the one
merge function is the single place approval semantics live. The draft
rows are deliberately kept after merge as the CO's own permanent record
of exactly what it added; merged rows carry `change_order_id`
(scope_items had it since Sub-phase 0; materials gained it here) for
traceability in the other direction.

**Choice — "original vs current approved" is one snapshot plus live
arithmetic, not two stored numbers:** `projects` gains
`original_estimate_labor_units/days/saved_at`, written exactly once by
`ensureOriginalEstimate` — at estimate→active conversion (the moment the
estimate becomes the deal), or lazily at first CO send/manual-approval
for projects created directly active. Current approved =
original + Σ approved COs' labor/days, computed live by
`getApprovedChangeOrderTotals` wherever it's displayed (the Estimate
tab's new baseline card) — no second stored figure to drift. The
snapshot deliberately happens BEFORE the merge inside every approval
path, so "original" can never include CO work. The scheduler's own
numbers update by construction: merged scope/materials flow into
`getProjectRemainingLaborUnits` through the same queries as everything
else.

**Choice — CO labor/days suggestions are standard-pace, stored per line,
never re-derived at merge:** a line's labor is priced when it's entered
(scope: work_type's base units × qty, same as the Scope tab's
suggestion; material: the "general" standard per unit × qty, same as
addMaterial's default), summed onto the CO (`labor_units`), and
converted to `added_days` at the estimator's own 8-hour crew day —
standard pace rather than computeProjectEstimate's crew-rate blend,
because a draft CO is a quote-time figure the office reviews and can
overwrite (both fields stay editable until sent). At merge the stored
line values are copied verbatim (materials back-derive per-unit =
line total ÷ qty) — re-deriving would both disagree with what the
customer approved and be impossible on the public path, where
labor_standards isn't readable (no session).

**Choice — the tokenized approve/decline page is the app's first and
only unauthenticated write path, and it's deliberately tiny:** the
read-only portal's trust model (ADR-035: an unguessable token IS the
authorization, admin client because RLS has nothing to scope against)
extends to exactly two transitions on exactly one row.
`change_orders.approval_token` (32-hex, minted per send, `unique`) is
single-purpose and single-use: nulled by whichever decision lands first,
and every public update carries `.eq("status", "pending_customer")` so a
replay (double click, stale tab, forwarded email) matches zero rows and
falls through to the already-decided screen. A dedicated column beat
reusing `share_tokens` because a CO token's lifecycle (one decision,
then dead) is nothing like a portal token's (long-lived, revocable,
project-scoped). The decline path appends the customer's optional note
onto the CO description rather than adding a column. Approval requires a
typed name (`customer_approver_name`); the public merge failure is
logged, never surfaced to the customer as "your approval failed,"
because the approval row itself already stood.

**Choice — manual approval is a first-class path, not a fallback:**
`recordManualApproval(via: verbal|written, approverName)` — the brief's
"who/when/how" maps onto the existing free-text
`customer_approved_via` + `customer_approved_at` + name columns. Small
customers approve on the phone; requiring the email round-trip would
just mean the CO never gets recorded. Sending requires `RESEND_API_KEY`
and a customer email (an inline field on the CO page sets
`projects.customer_contact_email` — full customer-comms management is
Sub-phase H's job, but a CO shouldn't be blocked on it); the send is
logged to `project_comms` with a new `change_order` kind (CHECK
constraint extended), since a CO going out IS a customer communication.

**Choice — the scope-growth guard is a computed banner on the Materials
tab, not a write-time interceptor:** "new materials added mid-Execute"
is detected by comparing `materials.created_at` (no CO attached) against
the Mobilize stage's `completed_at` — everything before mobilization was
planning, everything after is growth until a CO says otherwise. A
banner on the page where the PM already works beats intercepting
addMaterial/import/paste with a modal (those are bulk paths where a
prompt-per-row would be hostile, and the brief wants a prompt, not a
block). "Installed exceeds estimated scope" has no honest signal today —
the reconciliation view caps installed at assigned by design (ADR-013),
so overinstall is invisible at the data layer; noted as future work
rather than shipping a misleading proxy.

**Choice — COs appear in the closeout PDF and the period reports:** the
closeout PDF gains a Change orders table (number/title/status/days/
price/approved-how); `buildProjectReportData` gains
`changeOrdersInPeriod` (created OR decided in the window — week-old COs
approved yesterday are this week's news) rendered as a section that
only appears when non-empty. The report still goes to owner/pm
recipients (customer-facing sends are Sub-phase H); the section is in
place for when the audience widens.

**Consequences:** New migration
`20260707180000_change_orders_workflow.sql` (`change_order_items` +
`org_id_of_change_order` RLS helper, `change_orders.approval_token/
sent_at/sent_to`, `materials.change_order_id`, `projects.original_
estimate_*`, `project_comms.kind` + 'change_order'). New modules:
`lib/change-orders/{shared,queries,actions,merge,public,public-actions}.ts`,
`components/change-orders/{change-order-list,change-order-detail,
change-order-decision}.tsx`, pages `/app/project/[id]/change-orders`
(+ `[coId]`) and public `/portal/co/[token]`. `project-tabs.tsx`'s
role-gated prop generalized (`canViewHandoff` → `canViewOfficeTabs`)
to cover the new COs tab. `convertEstimateToActive` now snapshots the
baseline. Found and fixed while building: the CO detail's figure inputs
went stale after a line change (useState initials don't re-run on
router.refresh — fixed with the same adjust-state-during-render pattern
as LifecyclePanel, ADR-038). New `e2e/change-order-flow.spec.ts` covers
the full arc: draft + auto-suggested figures, manual approval → merge
(scope item + received-0 material) + baseline snapshot verified against
the DB, the estimate tab's original-vs-approved card, a REAL Resend
send minting a token + comms log, the customer approving CO-2 and
declining CO-3 from a genuinely cookieless browser context, replay
protection (nulled token), closeout PDF, and the scope-growth banner
firing only for a post-mobilize, no-CO material. Full suite green: 35
passed, 3 intentionally skipped.

---

## ADR-042: Batch 4, Sub-phase E — material verification gate ("no verified material, no crew dispatch")

**Decision date:** 2026-07-06

**Context:** iBuy's third failure — bad material surfaced mid-install at
the customer's site. Batch 3 built the receiving lifecycle
(`material_receipts`: ordered→received→verified→staged→short/damaged/
wrong) but nothing consumed it as a constraint: the scheduler's only
guard was a dismissible row-level `window.confirm`, the field app
rendered its full working UI unconditionally, and the seeded Materials-
stage checklist was pure checkbox theater (hand-tickable with zero
receiving data behind it). `docs/ARCHITECTURE.md` had already named this
exact gap: "turning 'no verified material, no crew dispatch' into an
actual block is an explicit later (Batch 4) job."

**Choice — `received` means USABLE units, so `to_order` stays the single
reorder truth:** the worksheet's two gestures write disjoint quantities —
"✓ Received + verified" logs the good count (received + verified events,
received-bumps the aggregate), "Flag problem" logs the bad count (a
short/damaged/wrong event, NO received bump). A flagged unit therefore
never counts as received, which means `needed - received` (`to_order`,
unchanged since Batch 1's view) automatically carries every flagged unit
onto the existing reorder list — no parallel shortage math, no
double-count, and the "flags auto-land on the reorder list" requirement
falls out of the data model rather than being bolted on. The legacy
CheckInForm still lets someone log received-100-then-damaged-10 (which
under this definition is a mis-entry: 90 + 10); the reconciliation
card's numbers make that visible and correctable, and the worksheet
makes the right entry the path of least resistance.

**Choice — flags are "open" until explicitly resolved
(`material_receipts.resolved_at`/`resolved_by`), and open flags block
the gate:** discovering damage is an event; deciding it's dealt with
(replacement received, or shortfall accepted) is a judgment that needed
a place to live. Two new columns on the same event row — not a separate
resolution log — because a flag has exactly one resolution and the
history view already renders receipts chronologically. Resolution is
owner/pm (`resolveMaterialFlag`), mirrors the seeded "Shortages/damage
resolved or accepted" checklist item, and is E2E-verified to clear both
the gate and the open-flags UI.

**Choice — readiness is COMPUTED server-side and re-verified at stage
completion, not trusted from checkboxes:** `getMaterialsReadiness`
(lib/materials/queries.ts) derives % received, % verified (each capped
per-material at needed), and open-flag totals from
`material_reconciliation`'s two new appended columns (`verified`,
`open_flag_qty` — appended at the END of the select list per ADR-019).
`completeStage` now recomputes it whenever `stage_key === 'materials'`
and throws with the specific blocked reason if it isn't green — the
first stage in this codebase whose completion is verified against real
data instead of item state, closing the hand-tick loophole the gate
engine shipped with (every checkbox was always interactive regardless of
stage status). `overrideStage` remains the accountable escape hatch,
unchanged. A ZERO-material project is deliberately NOT ready ("No
materials loaded yet") — an unloaded BOM is exactly the iBuy failure
mode; the genuine no-materials job (customer-supplied) is what override
exists for.

**Choice — "crew dispatch" = `createAssignment`/`moveAssignment`, and
the block is the Mobilize stage's own lock state:** this data model has
no "dispatched" flag anywhere — assigning a crew to a work day IS the
dispatch act, so those two Server Actions are the enforcement point
(`requireClearedForDispatch`: ensureProjectStages, then reject while the
mobilize stage row is `locked`). Planning stays free on purpose:
`setProjectSchedule` (which days are working days) is NOT gated — you
schedule next month's job before its steel ships all the time; you just
can't commit a crew to it. No new state was invented: "cleared" is
simply mobilize ∈ active/complete/overridden, which `advanceToNextStage`
already maintains — the Materials stage completing (now impossible to
fake) or being overridden (logged) is exactly what unlocks Mobilize.
The pre-existing row-level readiness warning in AssignCrewForm (ADR-029,
dismissible) is deliberately untouched — that's about one row's physical
state, this is the project-level gate; both fire independently.

**Choice — the field app withholds the working UI entirely
(`clearedForInstall`), with a legacy grace:** a crew opening a locked
project sees a "Not cleared for install" panel instead of steppers/day
close/blockers — UI-level enforcement per the brief ("the field app
shows crews a 'not cleared for install' state"), while the server-level
half lives on the dispatch actions. A project with NO mobilize stage row
at all (pre-Batch-4, stages never bootstrapped — sub-phase J's backfill
hasn't run) is treated as CLEARED on the field side: bricking a live
legacy project's crew mid-install would be worse than the gap, and the
dispatch-side check bootstraps stages itself so new assignments are
airtight either way.

**Choice — the verification worksheet is a separate tablet-first screen,
additive to the Receiving tab:** `/app/project/[id]/receiving/verify` —
one card per BOM line, 48px tap targets, qty prefilled with the
outstanding amount so the common case ("whole remaining delivery arrived
and checks out") is literally one tap, flags inline (kind + qty + note),
fully-verified lines sink to the bottom. The Receiving tab keeps the
finer-grained CheckInForm (all 7 statuses, incl. `staged`) and gains the
gate summary card + per-flag Resolve controls. Receiving stays owner/pm
(existing `material_receipts_write` RLS unchanged) — "the warehouse guy"
at Handy Equip is an owner/pm in practice; widening RLS to crew was not
asked for and stays out of scope.

**Choice — "Material staged/ready" stays a manual checklist item:** the
other three seeded Materials items auto-tick from computed readiness
(same best-effort label-lookup sync as ADR-041's handoff items,
tick-only). Staging is a physical act in the warehouse, and leaving it
manual keeps one deliberate human confirmation between "the numbers are
green" and "the stage is complete" — the gate's job is stopping
unverified dispatch, not removing humans from the loop.

**Choice — overridden gates finally surface on the dashboard
(`listOverriddenStages` + `GateOverrideList`):** Sub-phase 0's migration
comment promised overrides would "surface as a dashboard exception in a
later sub-phase," and nothing had shipped — overrides were only visible
inside each project's own expanded stage card. The brief's "override
(with reason, logged, dashboard-flagged)" makes this that sub-phase:
every overridden stage on an active project, org-wide, with who/why/
when, in a new "Overridden gates" dashboard section — same
exceptions-only batch-fetch shape as listShortagesAcrossProjects.

**Consequences:** New migration
`20260707170000_material_verification_gate.sql` (receipt resolution
columns + `material_reconciliation` gains `verified`/`open_flag_qty`).
New: `getMaterialsReadiness`, `logVerifiedReceipt`/`flagMaterial`/
`resolveMaterialFlag` (+ `material_flagged` NotificationKind, in-app,
same-day, PM-of-record else all owner/pm, never the flagger themselves),
`isProjectClearedForInstall`/`listOverriddenStages`,
`requireClearedForDispatch` inside scheduler actions, the worksheet
screen, the field lock panel, the scheduler's dispatch-gate banner, and
dashboard override surfacing. `AssignCrewForm` and the crew calendar
gained real error surfacing (a gate rejection used to be an unhandled
promise — found while wiring the block). Pre-existing specs that
dispatch crews or open the field detail on unverified projects
(scheduler-flow, crew-calendar-flow, field-flow, scope-of-work-flow) now
call a shared `clearDispatchGate` helper — the honest admin-side
equivalent of the office completing the gate; materials-lifecycle-flow's
old static "Flagged:" assertion updated to the new open-flags/resolve
UI. New `e2e/material-gate-flow.spec.ts` covers the whole arc:
hand-ticked checklist rejected server-side, dispatch blocked with a
visible error and zero DB rows, field locked, flag → PM notification +
reorder list, resolve → green → stage completes → the same assignment
that was blocked succeeds → field unlocked → overrides visible on the
dashboard. Full suite green: 34 passed, 3 intentionally skipped.

---

## ADR-041: Batch 4, Sub-phase D — sales→ops handoff survey

**Decision date:** 2026-07-06

**Context:** iBuy's second failure was "the sale closed and ops never got a
real briefing — no site survey, no photo record, no one owned confirming
what the crew would actually walk into." Sub-phase D builds the Handoff
tab on Sub-phase 0's `handoff_surveys` schema: a structured survey, site
photos, a reference to whatever drawing already exists, dual estimator+PM
sign-off, a printable PDF, and an optional AI draft-from-notes assist.

**Choice — hide the Handoff tab per-role, not just per-status:** every
other tab in this codebase (Layout/Materials/Scope/Receiving/Progress/
Portal/Estimate) is visible to any signed-in role and gates WRITE access
internally via a `canManage` flag — reading is never restricted. Handoff
breaks that pattern deliberately: `handoff_surveys` RLS
(`handoff_surveys_select`) is owner/pm-only, matching its own migration
comment ("office-only both ways ... not crew-facing concerns anywhere
else in this codebase either"). Showing the tab to a scheduler/crew user
would render a permanently-empty form regardless of whether a real survey
exists (RLS silently filters the row to nothing), which is actively
misleading, not just an inert extra tab. `app/(protected)/app/project/
[id]/layout.tsx` now fetches the caller's role once and passes
`canViewHandoff` to `ProjectTabs`; the page itself additionally redirects
a direct URL visit by any other role to the Overview page — the exact
same two-layer posture (hidden nav + page-level redirect) already
established by `/app/team` for the same reason (fully office-only data,
not partially-role-gated).

**Choice — dual sign-off is two clicks, not two system roles:** the
brief calls for "dual sign-off (estimator AND PM)," but this codebase's
`ProfileRole` enum has no `estimator` role — only owner/pm/scheduler/crew
exist. `signHandoffAsEstimator`/`signHandoffAsPm` are therefore both
gated identically (`requireRole(["owner","pm"])`); either can be clicked
by any owner/pm, including the same person clicking both. "Dual" here
means two distinct affirmative records (two user ids, two timestamps),
not two technically-exclusive roles — appropriate for a small operation
where the estimator and the PM are often the same person, or where
either could plausibly stand in for the other. The one place this
distinction bites is `signOffGateItem`'s pre-existing (not new)
`requires_signoff_role` check on the Handoff stage's seeded "PM sign-off"
checklist item (`requires_signoff_role='pm'`, but NOT set on "Estimator
sign-off") — an owner calling `signHandoffAsPm` still correctly updates
`handoff_surveys.pm_signoff_user_id`/`pm_signed_at` (HANDOFF_MANAGERS
allows it), but the checklist item itself only flips for a caller whose
own role is literally `pm`. Confirmed this live with a real second
`pm`-role user in a separate browser session rather than asserting around
it — the survey field is the source of truth either way (see the next
choice), so the checklist gap for an owner-as-PM signer is cosmetic, not
a correctness bug.

**Choice — best-effort, label-matched checklist auto-sync, survey fields
stay the real source of truth:** `markHandoffItemDone`/
`signOffHandoffItem` (`lib/handoff/actions.ts`) look up the Handoff
stage's `project_gate_items` row by its exact seeded label text and
silently no-op (try/catch, `console.error`) if it's missing or the
signoff role check fails. There is no foreign key from `handoff_surveys`
back to a specific gate item — deliberately, since Template Management
(Sub-phase A) lets an owner rename or remove any seeded item, and this
sub-phase shouldn't need a migration every time that happens. The
survey's own columns are what actually gate downstream behavior (e.g.
the auto-created scope item); the checklist sync is purely a convenience
so a PM doesn't have to duplicate a manual click.

**Choice — PDF and AI-draft features copy existing patterns wholesale,
zero new conventions:** a dispatched research pass confirmed the
closeout-PDF route's exact construction shape (react-pdf `Document`/
`Page`/`View`/`Text`/`Image`, `requireRole` + `Promise.all`-batched
queries + signed URLs, `renderToBuffer` → `Uint8Array` →
`content-disposition: attachment`) and the packing-slip/voice-note
routes' exact AI shape (bare `fetch` to the Messages API, no SDK per
ADR-025, `model: "claude-sonnet-5"`, forced `tool_choice`, `requireOrg`
not `requireRole` since the call itself touches no role-gated data,
clean JSON 500 on a missing key). Both are copied directly rather than
reinvented. One deliberate deviation: the AI-draft block is hidden
entirely when `ANTHROPIC_API_KEY` is unset (the newer `estimates/explain`
precedent), not shown-with-a-clean-error (the older packing-slip/voice-
note precedent) — this is a full secondary feature living inside a form
that has plenty else to do, not "the upload button already exists for
other reasons and just gained an AI option." Drafted fields only ever
land in local form state (`existingCondition`/`teardownRequired`/
`teardownNotes`/`constraints`) — nothing reaches `saveHandoffSurvey`
until the estimator reviews and clicks Save themselves, same
never-auto-saves posture as the packing-slip review table and the
voice-note draft card.

**Real bug found during E2E verification:** `saveHandoffSurvey` was
marking the "Site survey completed with photos" checklist item done
whenever `siteVisitDate && existingRackingCondition` were both present —
never checking whether a photo actually existed, despite that item's own
seeded `requires_photo: true` template flag. A test asserting the item
should still be `false` before any photo upload caught this immediately.
Fixed by dropping that item from `saveHandoffSurvey`'s block entirely —
it's now ONLY ever flipped by `addHandoffPhoto`, which already correctly
calls `markHandoffItemDone` after a photo is genuinely added.

**Real gap found and fixed during self-review (not caught by any
test):** `removeHandoffPhoto` only removed the path from
`handoff_surveys.photo_paths` — it never deleted the underlying object
from the `daily-photos` bucket. Unlike `day_logs`/`blockers` photos
(append-only logs; nothing is ever unlinked, so this never comes up),
this array is mutable — a PM removing a wrong-angle photo would leave it
orphaned in Storage forever. Fixed by calling `supabase.storage.from(
"daily-photos").remove([photoPath])` after the DB update; added an E2E
step asserting the object is actually gone from `storage.list()`, not
just absent from the DB array.

**Verified empirically — previously an unconfirmed assumption:**
`.upsert({partialFields}, {onConflict:"project_id"})` against an
existing `handoff_surveys` row does not reset columns absent from that
specific call's payload. Confirmed live: a survey saved with full
teardown/constraints data, then signed by the estimator (which upserts
only `estimator_signoff_user_id`/`estimator_signed_at`), then signed by a
real second PM user (which upserts only the PM columns) — all
teardown/constraints/condition data was still intact after both sign-offs
in the actual database, not just asserted from apparent behavior.

**Consequences:** New modules: `lib/handoff/{shared,queries,actions}.ts`,
`components/handoff/handoff-survey-form.tsx`, `lib/pdf/
handoff-survey-pdf.tsx`, `app/api/handoff/draft/route.ts`, `app/api/
projects/[id]/handoff-survey-pdf/route.tsx`. New "Handoff" tab
(`app/(protected)/app/project/[id]/handoff/page.tsx`) between Overview
and Layout, hidden for `estimate`-status projects and for any role other
than owner/pm. `project-tabs.tsx` and the project `layout.tsx` both now
take a `canViewHandoff` flag — the first tab in this codebase gated by
role as well as status. New `e2e/handoff-survey-flow.spec.ts` (survey
CRUD, teardown auto-creates one draft scope item, photo upload/remove
incl. real Storage-object deletion, dual sign-off via a real second
`pm`-role user in a separate browser session, upsert-doesn't-clobber
verification, PDF download, AI draft populate-without-save, AI hidden
when unconfigured). Full suite green: 33 passed, 3 intentionally skipped;
confirmed zero leftover test data (including `handoff_surveys` rows)
afterward.

---

## ADR-040: Batch 4, Sub-phase C — scope-of-work builder (non-install work)

**Decision date:** 2026-07-06

**Context:** iBuy's first failure was "teardown/level-change work was never
scoped." Sub-phase C builds the Scope tab on top of Sub-phase 0's
`scope_items` schema, wires it into the Estimate tab's hours and the
Scheduler's capacity math (so non-install work actually counts, not just
gets logged and ignored), and gives the Field app a way to mark it
done/partial with a note and photo.

**Choice — field progress as an append-only `scope_item_updates` log, not
mutable columns on `scope_items` itself:** `scope_items_write` RLS is
owner/pm only (work_type/description/qty/labor_units are office-decided
content); crew needs to report progress but must not be able to touch
those fields, and Postgres RLS can't restrict individual columns within
one UPDATE policy without a trigger. An insert-only log sidesteps this
entirely — crew always supplies an entirely new row, never touches an
existing one — mirroring `installs`/`material_receipts`/`day_logs`'s own
established event-sourced shape in this schema, not inventing a new one.
A `scope_item_progress` view (latest update per item, via
`left join lateral ... order by logged_at desc limit 1`) gives every
consumer a convenient "current status" read, same convention as
`row_progress`/`project_progress`.

**Choice — seed `labor_standards` for the 5 non-install `work_type`s,
keyed identically to `scope_items.work_type`:** `labor_standards` was
seeded install-only (Batch 3) — nothing existed for
teardown/remove_levels/add_levels/relocate/repair, so "labor_units
suggested from labor_standards" (this sub-phase's own brief) had
nothing to suggest from. Reused `work_type` as the lookup key directly
rather than inventing a parallel `task_key` mapping — `lib/estimating/
labor.ts#laborUnitsFor`'s existing `task_key` lookup (with its own
"general" fallback) works unchanged for scope items with zero new code.
The suggestion itself is a dismissible hint (a "Suggested: N hrs" button
next to the field), not an auto-overwrite — unlike materials (where
labor_units is always auto-recomputed, no override), non-install work is
inherently more judgment-based per job, so the office should be able to
type their own number without a suggestion fighting them.

**Choice — scope items fold into the estimator/scheduler as their own
`work_type`-keyed bucket, disjoint from materials' `task_key` buckets,
not scaled by qty:** `getProjectLaborUnitsByTaskKey` (estimator) and
`getProjectRemainingLaborUnits` (scheduler) both already reduce
materials into a `Map<string, number>` keyed by `task_key`; scope items
have no `task_key`; extending the same reduce with `work_type` as the
key was the smallest change that reuses 100% of the existing
`resolveRate` rate-resolution logic (crew rate → company blend →
standard-pace fallback) for free. A scope item's full `labor_units`
counts once — no "qty installed so far" concept exists for it, only a
done/not-done status — so `total` always includes it and `remaining`
excludes it once (and only once) `scope_item_progress.status = 'done'`.

**Choice — the Scope tab is visible even for pre-sale `estimate`-status
projects, unlike Layout/Receiving/Progress/Portal:** those four are
execution-only concerns with nothing to show pre-sale (no rows, no
install progress). Scope-of-work is different — the whole reason
`getProjectLaborUnitsByTaskKey` needed extending is so a _draft
estimate's_ hours account for known non-install work from the start
(e.g. "this quote needs to include a 3-day teardown"), not just after
conversion to a real project. Project-level items (no row/phase
attachment) work fine before any rows exist yet.

**Real bug found while building the Field integration, and the lesson
it reinforces:** the Field app's scope-progress card appeared to get
permanently stuck mid-transition after "Mark done" — status never
flipped, buttons stayed rendered and disabled, seemingly forever. Two
plausible-looking fixes (adding a `router.refresh()` call, then
removing a local `justLogged` status override to match the office-side
`ScopeItemRow`'s simpler prop-only pattern exactly) each failed to
change the symptom at all — a strong signal the diagnosis itself was
wrong, not the fix. The dev server's own request log showed the
`logScopeItemProgress` Server Action completing successfully in under
200ms every time; a temporary debug marker rendering the raw
`item.status` value confirmed the prop _did_ update correctly. The
actual bug was in the E2E test, not the component: an unscoped
`getByText("Done")`/`getByText("Partial")` — case-insensitive substring
matching by default — also matches the "Mark done" and "Photo + mark
done" buttons' own labels, which (correctly) remain rendered and
disabled for the brief pending window `useTransition` shows before a
transition commits. Fixed by adding `{ exact: true }` to both
assertions, the real fix all along. Kept the `router.refresh()`
addition and the `justLogged` removal anyway — not because they were
the fix, but because they make the Field version consistent with the
office version's already-proven, simpler pattern (props + refresh, no
local shadow state) rather than reverting to an unexplained asymmetry
between two components doing the same job.

**Real regression found and fixed in the same work:** restructuring the
Field header's single Rows/Day toggle button into a Scope/Day pair
broke `e2e/field-flow.spec.ts` (a 60-second timeout, not a quick
failure) — the original toggle was reachable from _any_ non-"day" view
including a specific row's own detail screen (`view === "row"`), a
deliberate shortcut to jump straight to closing out the day without
detouring back through the rows list first. The rebuild only showed the
new Scope/Day pair when `view === "rows"`, silently removing that
shortcut. Fixed by showing the pair whenever `view` is `"rows"` _or_
`"row"`, restoring the original reachability while adding Scope
alongside it.

**Consequences:** New migrations: `20260707150000_scope_item_progress.sql`
(`scope_item_updates` table + `scope_item_progress` view +
`org_id_of_scope_item` helper), `20260707160000_scope_labor_standards.sql`
(5 new `labor_standards` rows per org). New modules: `lib/scope/
{shared,queries,actions}.ts`, `components/scope/scope-workspace.tsx`,
`components/field/field-scope-panel.tsx`. `lib/estimating/
queries.ts#getProjectLaborUnitsByTaskKey` and `lib/scheduler/
queries.ts#getProjectRemainingLaborUnits` both extended with an
identical shape (batch-fetch `scope_item_progress`, fold into the same
maps by `work_type`, skip `done` items for "remaining"). New "Scope" tab
on `project-tabs.tsx` (visible for both `estimate` and non-estimate
projects) and a new "Scope" view in the Field app's header (reachable
from the rows list and from within a row's own detail screen). Full E2E
suite green: 31 passed, 2 intentionally skipped, including a fix for a
genuine pre-existing-test regression this sub-phase's own header change
caused.

---

## ADR-039: Batch 4, Sub-phase B — PM-of-record accountability

**Decision date:** 2026-07-06

**Context:** iBuy's second failure was "no one owned the job." Sub-phase
B makes that structurally hard to repeat: a PM of record is required on
every new real project, shown wherever a project appears, reassignable
with an audit trail and a notification, and filterable ("my projects
only").

**Choice — default the New Project form's PM selector to the creator,
not an empty/forced choice:** the brief says `pm_user_id` is "required,"
but making the office pick from a dropdown with no default would be
friction for the common case (whoever's creating a project is
overwhelmingly likely to either be its PM or know immediately who is)
and — practically — would have silently broken every existing E2E spec
that creates a project through "+ New project" without touching a PM
field, since none of them were written expecting one to exist.
Defaulting to the signed-in creator resolves both: anyone who can reach
this form is already owner/pm (`PROJECT_EDITORS`), so they're always a
valid candidate, the common case needs zero extra clicks, and every
pre-existing test's "create a project" step keeps working unchanged
because the default value is what actually submits. `createProject`
still hard-validates a `pm_user_id` was submitted and belongs to a real
owner/pm in the caller's org — the default makes the field easy to
satisfy, it doesn't make the requirement optional.

**Choice — `pm_user_id` "required" applies to real projects
(`createProject`) only, not the pre-sale estimate path
(`createEstimateProject`):** an estimate is a speculative draft that may
never become a real job — forcing ownership on something that might not
exist next week adds friction without the accountability payoff the
brief is actually after. When an estimate converts to active
(`convertEstimateToActive`), it inherits whatever `pm_user_id` was
already set (`null` if never touched) — Sub-phase B doesn't add a
gate at conversion time; a `null` PM on a freshly-converted project
would surface immediately via the same "No PM assigned" warning state
active projects already get everywhere else.

**Choice — a dedicated `project_pm_history` table, not folding into
`project_comms` or a notification's own persistence:** `project_comms`
is specifically the _customer_-facing comms log (Batch 4 Sub-phase 0);
this is an internal ownership record. A notification is the wrong
vehicle for "audit log" on its own — it's per-recipient, and its
purpose is alerting, not being a permanent, queryable record regardless
of anyone's read state. The table is intentionally minimal
(`previous_pm_user_id`/`new_pm_user_id`/`changed_by`/`changed_at`, no
`reason` column) — a reassignment isn't inherently an exceptional event
needing justification the way a gate override is; it's a routine
operational change worth _recording_, not necessarily _explaining_.

**Choice — two independent notification sends on reassignment, not one
shared call:** the incoming PM and the outgoing PM (if any) read
different messages (`isNewPm` flips the phrasing in
`formatNotificationMessage`), and either leg is skipped entirely when it
would just notify whoever performed the reassignment about their own
action — the common case of an owner assigning themselves, or an owner
handing a project to someone else without ever having held it, both
correctly produce zero or one notification rather than a redundant
self-notification.

**Choice — `pm_user_id` exposed through `project_progress` (raw uuid,
appended at the end of the view per the same `CREATE OR REPLACE VIEW`
positional-column rule ADR-019 already established), names resolved in
application code via `lib/team/queries.ts#listTeamMembers`/
`listPmCandidates`, not joined in the view itself:** matches this
codebase's existing convention everywhere else a person's name needs
resolving from an id (crew names, blocker crew names) — the view stays
a thin aggregate over `projects`, and name resolution (which needs the
admin API for `auth.users` email fallback) stays in application code
where that capability already lives.

**Consequences:** New table `project_pm_history` (RLS: owner/pm
select+insert, no update/delete — append-only from the application's
own perspective). `project_progress` view gains `pm_user_id`. New
`NotificationKind` `pm_reassigned`. `ProjectCard`'s `pmLabel` prop is
optional and three-valued in effect: omitted (the pre-sale estimates
list — no PM row at all), `null` (an active project genuinely has none
— shown as a warning), or a real label. Full E2E suite green — 30
passed, 2 intentionally skipped — including every pre-existing spec
that creates a project through the unchanged "+ New project" flow,
confirming the default-to-creator choice didn't require touching a
single one of them.

---

## ADR-038: Batch 4, Sub-phase A — stage-gate lifecycle engine, What's Next, notifications, gate nags, template management

**Decision date:** 2026-07-06

**Context:** Sub-phase A is "the spine" of Batch 4 — the actual
stage-gate lifecycle UI/logic on top of Sub-phase 0's schema, plus a
dashboard-level aggregation of what needs attention across every active
project, a nagging mechanism (in-app + email), the STALLED flag, and
owner-only template management. Built and verified live in this same
session as Sub-phase 0, not a separate pass.

**Choice — add `project_gate_items.position`, a column Sub-phase 0's own
migration didn't include:** building the checklist UI surfaced a real
bug — `getProjectLifecycle` ordered items by `created_at`, but
`ensureProjectStages` bulk-inserts a whole stage's items in one
statement, so Postgres gives them identical or near-identical timestamps
with no reliable tiebreaker. The result: a project's checklist order
wasn't guaranteed to match the template's authored order at all, and
wasn't even stable across reloads — exactly the kind of "PM can't trust
the app to be consistent" gap this whole batch exists to close. Fixed
with a small follow-up migration
(`20260707130500_project_gate_item_position.sql`) rather than amending
Sub-phase 0's own migration file (already applied live) — same
already-established precedent as `stalled_project_setting.sql`/
`day_log_photos.sql`. `ensureProjectStages` now carries each item's
`position` across from its template origin; `addGateItem`/
`addTemplateItem` append after the current max.

**Choice — `notifyUsers` (`lib/notifications/create.ts`) takes an
already-scoped Supabase client as a parameter, not a fixed one:** it's
called from genuinely different contexts — the gate-nags cron (no user
session, must use the admin client) and potentially future Server
Actions with a real session later. Taking the client as a parameter
keeps the function itself dumb about which context it's in, rather than
hardcoding the admin client and quietly overprivileging every future
call site. `notifications_insert`'s own RLS (`org_id = current_org_id()`
only, unlike the strictly-own-row select/update/delete policies) already
allows a cookie-scoped session to notify a different org member, so a
future non-cron call site wouldn't even need the admin client.

**Choice — gate nags ride the existing daily reports cron rather than
getting their own route:** Vercel's Hobby plan caps a project at 2 cron
jobs total, and both slots were already spent
(`/api/cron/reports/daily`, `/api/cron/reports/weekly`) before this
sub-phase. A standalone `/api/cron/gate-nags` route was written, tested,
and then deleted once this constraint was confirmed — `app/api/cron/reports/daily/route.ts`
now calls `sendReports("daily")` and `sendGateNags()` together via
`Promise.all` and returns both results. This still delivers a genuinely
daily check; it just doesn't get its own schedule. If gate nags ever
need a different cadence than the daily report, that would require a
paid Vercel plan, not a workaround.

**Choice — one combined digest email per recipient, not one per
project:** `lib/reports/send.ts`'s own convention is one email per
project (to every recipient). Gate nags deliberately diverge: a PM with
several projects flagged the same day should get a single "N projects
need attention" summary, not N separate emails — matching the brief's
own word "digest" (singular), and avoiding the alert fatigue a
per-project flood would create for exactly the kind of daily-use feature
this needs to stay trusted.

**Choice — gate nags only fire on OVERDUE items and the STALLED flag,
not every open item:** `computeNextActions`'s "top 3 open items of the
active stage" is deliberately excluded from the nag/notification path —
surfacing routine, non-overdue checklist items in a daily push would
create noise on every single active project every single day, training
users to ignore the channel. Nags are reserved for genuine exceptions
(a due date was missed; a project has gone quiet) — the same
exception-first posture as the rest of the dashboard
(`listShortagesAcrossProjects`, `listUnresolvedBlockersAcrossProjects`).
The Overview page's own What's Next panel remains the place to see
routine open items.

**Choice — template management edits the shared org template only,
stages are structural and fixed, items are the only editable content:**
matches "Template management (owner)" from the brief precisely.
`gate_template_stages.stage_key` is CHECK-constrained to the 8 fixed
keys the whole lifecycle engine is built around (`STAGE_ORDER`); adding
or removing a _stage_ would require touching the stepper, the RLS
scheduler carve-out (scoped specifically to `stage_key = 'schedule'`),
and `advanceToNextStage`'s traversal — out of proportion for what the
brief actually asks for. Items are ordinary editable content within that
fixed structure. Removing a template item is safe for already-copied
projects specifically because `project_gate_items.template_item_id` is
`ON DELETE SET NULL` (Sub-phase 0's own schema choice) — an
already-bootstrapped project's row survives untouched, only losing a
display hint it looked up through that now-gone reference.

**Consequences:** New migration
(`20260707130500_project_gate_item_position.sql`, `position int not
null default 0` on `project_gate_items`). New modules: `lib/gates/nags.ts`,
`lib/notifications/{shared,queries,actions,create}.ts`,
`components/notifications/notification-bell.tsx`,
`components/gates/template-editor.tsx`,
`components/dashboard/lifecycle-attention-list.tsx`. `lib/gates/queries.ts`
gained `listOrgWideNextActions` (batch-fetch, same convention as
`lib/dashboard/queries.ts`) and a shared `attachTemplateHints` helper
factored out of `getProjectLifecycle`. `app/(protected)/layout.tsx` now
fetches the signed-in user's notifications alongside its existing role
lookup, wrapped in `.catch(() => [])` so a not-yet-org-assigned user
doesn't lose the header. `app/api/cron/reports/daily/route.ts` now
returns `{ reports, gateNags }` instead of just the reports result — any
external monitoring of that route's response shape should account for
this. Found and fixed one real UX bug (`LifecyclePanel` not
auto-following the newly-active stage after a completion/override) and
one real, previously-latent regression in an unrelated pre-existing test
(`project-flow.spec.ts`'s Progress-tab check, ambiguous against both
this sub-phase's own row-readiness badges and a same-text/same-class
element on the Materials tab that can transiently coexist during a fast
tab switch — same race-condition class as two earlier sub-phases' own
findings). Full E2E suite green: 29 passed, 2 intentionally skipped, new
`e2e/gate-template-and-nags-flow.spec.ts` covering template CRUD +
role-read-only + the cron's actual notification/digest behavior end to
end (not mocked).

---

## ADR-037: Batch 4, Sub-phase 0 — PM Operating Layer schema (stage-gate lifecycle, scope, handoff, change orders, comms, autopsy)

**Decision date:** 2026-07-06

**Context:** Batch 4 is a new flagship push — the "PM Operating Layer" —
designed against a real ~$200K project ("iBuy") that ran two weeks over
because teardown/level-change scope was never captured, no one owned
the job, wrong/short material surfaced mid-install, the customer never
knew the schedule, and everything lived in one manager's head. Sub-phase
0 is the schema for all of it: a reusable, org-editable 8-stage gate
template (handoff → scope → schedule → materials → mobilize → execute →
punch → closeout) copied per-project so later edits never mutate the
template; scope-of-work beyond install; the sales→ops handoff survey;
change orders; a customer-comms audit log; org-wide crew capacity; and
the closeout autopsy. Ten new tables, one combined idempotent migration,
following this batch's own brief closely enough to use its exact
column names throughout (`template_id`, `position`, `done`/`done_by`/
`done_at`, etc.) rather than this codebase's more usual naming — kept
verbatim since sub-phase A's own application code will be written
against this exact spec.

**Choice — `project_stages.status` as a single enum
(`locked`/`active`/`complete`/`overridden`), not separate completed/
overridden booleans:** this is what the batch's own schema line
specifies, and it's genuinely cleaner than tracking multiple booleans
that could otherwise contradict each other (e.g. both "complete" and
"overridden" true at once) — a stage is in exactly one of these four
states at a time, never a combination.

**Choice — `pm_user_id` stays nullable at the schema level, "required"
is an application-level rule for sub-phase B:** the batch brief calls
`pm_user_id` "required," but every existing project has no PM assigned
yet, and guessing one via SQL would be worse than leaving it genuinely
unset until a human (or sub-phase B's own UI) assigns one deliberately.
`stage_key` similarly defaults to `'handoff'` for every project
(existing and new) at the schema level — sub-phase J's own backfill
step is where existing, already-in-progress projects get a realistic
current stage and their earlier stages marked `overridden` with reason
`'pre-Batch-4 backfill'`, a judgment call this migration deliberately
doesn't try to make.

**Choice — seed the default gate template NOW (sub-phase 0), not
defer it to sub-phase A:** the batch brief explicitly says so ("Seed
ONE default template with sensible items per stage"), and doing it as
part of the schema migration (one `do $$ ... $$` block per existing
org) means every org — current and future — has a real, usable
8-stage/29-item template from the moment this migration lands, with
nothing left to backfill for the template itself later. The exact item
text for all 29 items is transcribed verbatim from sub-phase A's own
paragraph in the original brief (not paraphrased), split one item per
semicolon-separated clause. Two items get `requires_photo = true`
("site survey completed w/ photos," "final photos" — the only two the
brief explicitly ties to photos); one gets `requires_signoff_role =
'pm'` ("PM sign-off" — there's no literal "estimator" `ProfileRole` in
this schema, so "Estimator sign-off" is left without a role constraint;
sub-phase D's dual-signoff mechanism will enforce both signers via
`requireRole(['owner','pm'])`, the only pool of eligible signers this
schema actually has).

**Choice — existing projects do NOT get `project_stages`/
`project_gate_items` rows in this migration:** unlike the template
(seeded now), backfilling every existing project's OWN stage rows
requires judgment about where that specific project realistically
already stands (most active projects are already well past Handoff) —
exactly the kind of decision sub-phase J's brief says needs "sensible
statuses," not a blind copy-the-template-verbatim insert. The plan
going forward: sub-phase A's own project-stages data-access layer
lazily creates a project's stage rows from the org's current default
template the first time they're needed (covering both brand-new
projects and any pre-Batch-4 project that hasn't been touched yet),
and sub-phase J is where the _existing, already-in-progress_ projects
specifically get walked forward and their genuinely-already-done
earlier stages marked `overridden`.

**Choice — RLS on `project_stages`/`project_gate_items` gives
scheduler a narrow, stage-scoped write exception, not a blanket one:**
the batch brief's own RLS line is specific — "crew read-only on
stage/scope... pm/owner manage; scheduler read + schedule-stage
writes" — so the write policy checks `stage_key = 'schedule'` (for
`project_stages`) or a subquery to the parent stage's `stage_key` (for
`project_gate_items`) in addition to role, rather than a same role
list on every stage. A scheduler can update the Schedule stage's own
gate items but not, say, mark Closeout complete.

**Choice — `gate_templates`/stages/items are office-only (owner/pm)
for read, owner-only for write:** matches "Template management
(owner)" precisely — pm can see what the template looks like (useful
context when reviewing a project's copied stages) but only owner edits
the org's shared template. `handoff_surveys`/`change_orders`/
`project_comms`/`project_autopsies` are owner/pm both ways — none of
these are crew-facing screens anywhere else in this codebase either
(sign-offs, financials, customer comms, and estimate-accuracy review
are inherently office concerns).

**Consequences:** Ten new tables (`gate_templates`,
`gate_template_stages`, `gate_template_items`, `project_stages`,
`project_gate_items`, `scope_items`, `handoff_surveys`,
`change_orders`, `project_comms`, `project_autopsies`), two new RLS
helper functions (`org_id_of_gate_template`,
`org_id_of_gate_template_stage`, `org_id_of_project_stage` — three,
not two), seven new columns on `projects` (`pm_user_id`, `stage_key`,
`last_activity_at`, `customer_contact_name`, `customer_contact_email`,
`comms_weekly_report`, `comms_milestones`), one new column on
`organizations` (`num_crews`, default 2 — a hard constraint enforced
starting sub-phase G, not yet). `scope_items.change_order_id` is added
as a plain column and only gets its FK constraint once `change_orders`
exists later in the same migration file (Postgres requires the
referenced table to exist first; both tables are listed in the same
order the original brief specifies them, rather than reordering the
file to satisfy the FK upfront). Eight new literal-union types added to
`database.types.ts` following the existing ADR-010 pattern
(`GateStageKey`, `ProjectStageStatus`, `ScopeWorkType`, `ScopeSource`,
`ChangeOrderReason`, `ChangeOrderStatus`, `CommsKind`, `CommsChannel`).
Purely additive — full E2E suite (26 passed, 2 intentionally skipped)
confirmed green with zero changes needed to any existing code, since
nothing yet reads or writes any of these new tables/columns (that
starts with sub-phase A).

---

## ADR-036: Sub-phase I — polish/QA/perf pass, Vercel production env vars, final Batch 3 deploy

**Decision date:** 2026-07-06

**Context:** Batch 3's final sub-phase: loading/empty/error states, a
mobile pass, accessibility basics, performance at 20+ projects, and a
final production deploy with every env var actually live on Vercel —
not just in `.env.local`.

**Choice — audit first (a read-only research pass), then fix only what's
concrete and proportionate, not a rewrite:** dispatched a research
agent to map missing loading states, error-boundary gaps, accessibility
misses, and performance risk points across the whole app, all with
exact file:line references. Of its findings, fixed: two structural
error-boundary gaps (see below), five icon/glyph-only buttons missing
`aria-label`, the dashboard's self-documented N+1 query, a memoization
win on the highest-traffic canvas component, and five `loading.tsx`
files for the heaviest routes. Deliberately did NOT attempt: rewriting
~120 raw `throw error` call sites across `lib/` to catch and rewrap
every message (systemic, consistent throughout the codebase, not a
regression — genuinely disproportionate scope for a polish pass), or
adding pagination to the plain Projects list (flagged by the audit
itself as unlikely to be the actual bottleneck at 20-50 projects).

**Choice — a root `app/error.tsx`, not modifying `(protected)/error.tsx`:**
Next.js excludes a route segment's own `layout.tsx` from that segment's
`error.tsx` boundary, so a failure in `app/(protected)/layout.tsx`
itself (the auth/profile lookup running on every protected request)
was never actually caught by the existing themed boundary — and
`/portal/[token]`, a fully public route outside `(protected)`
entirely, had no error boundary anywhere in its tree at all. A single
root-level `error.tsx` closes both gaps at once. It deliberately shows
a generic "please try again" message, not `error.message` the way
`(protected)/error.tsx` does — that existing file only ever fires for
an already-authenticated, already-vetted org member, where showing the
real message is a reasonable debuggability tradeoff; this new one can
fire before we even know who's asking, including on the fully public
customer portal, so a raw driver/Postgres message is never appropriate
here.

**Choice — batch the dashboard's per-project queries in memory, not by
changing what `computeProjectSpi` does:** `listActiveProjectsForDashboard`
was deliberately N+1 since sub-phase E specifically to reuse the exact
per-project scheduler functions and guarantee identical SPI numbers to
the per-project Scheduler page — a real correctness tradeoff, not an
oversight, but the audit correctly flagged ~4 round trips per active
project as a genuine risk at 20+. Fixed by fetching targets/rows/
installs/estimates for every active project in one `.in(...)` query
each, grouping the results by `project_id` in memory into the exact
same shapes (`Tables<"targets">[]`, `Map<string, number>`) the
pre-existing, unchanged `computeProjectSpi` already expects, then
calling that same function once per project from the already-fetched
data. Same computation, zero drift risk, a small constant number of
round trips instead of ~4N. Left the Scheduler calendar's smaller,
structurally-identical N+1 (`getProjectDailyLaborLoad` per project
appearing in one week's assignments) as-is — naturally bounded by a
week's actual schedule, not by total company project count, so it
doesn't have the same unbounded-at-scale shape.

**Choice — plain spinner `loading.tsx` files, not bespoke per-route
skeletons:** a hand-built skeleton matching each route's exact layout
is real, additional design work each time a page's shape changes,
disproportionate to what "stop showing a blank screen" needs. One
shared `LoadingPanel` (spinner + label) reused across the five heaviest
routes (`scheduler/[projectId]`, materials, `field/[projectId]`,
dashboard, mark) beats no loading state at all without taking on that
maintenance cost.

**Consequences:** Fixed a real mobile-layout bug found via a live
390px-viewport pass (not simulated): `app/(protected)/layout.tsx`'s
`<main>` had no `min-w-0`, so a flex item containing a wide table
refused to shrink below the table's intrinsic width, forcing the
_entire page_ wider than the viewport on any project with a materials
grid — one root-level fix, not a per-page patch. Also found and fixed:
a long packing-slip filename with no `break-all` forcing the same kind
of page-wide overflow, and a non-wrapping control row on the Team page
overflowing on narrow screens.

**Vercel production:** confirmed only the three original Phase-1 env
vars were live on Production — `RESEND_API_KEY`, `CRON_SECRET`, and
`ANTHROPIC_API_KEY` (all added to `.env.local` during Batch 3, never
pushed) were missing entirely, silently degrading every feature that
depends on them in production (emailed reports, the cron routes, AI
packing-slip/voice-note/estimate-explain). Pushed all three via
`vercel env add <name> production`, piping each value directly from
`.env.local` so it never appeared in this session's own output, then
triggered a fresh `vercel deploy --prod` so the running deployment
actually picks them up (env var changes don't retroactively apply to
an already-built deployment). Verified live: `CRON_SECRET`'s bearer
check now correctly rejects an unauthenticated request with 401
(previously a no-op pass-through, since the check only activates once
the env var exists). `RESEND_FROM_EMAIL` deliberately left unset —
`lib/reports/send.ts` already falls back to Resend's own
sandbox-safe default address, so setting it would be redundant until
the user verifies a real sending domain (an existing, standing
NEEDS-YOU item, not new).

**Bug found via the new E2E full-suite run (test-only):** the
`material-stepper.tsx` quantity buttons' new `aria-label`s changed
their accessible name from the raw "+"/"−" glyphs to "Increase/Decrease
quantity" — correct and intentional (a bare "+" is not a meaningful
name for a screen reader), but it broke `field-flow.spec.ts`'s
`getByRole("button", { name: "+", exact: true })` locator, which had
been matching the glyph as the button's only-ever accessible name.
Fixed the test to match the new, real accessible name rather than
reverting the accessibility fix.

---

## ADR-035: Sub-phase H — customer portal (`/portal/[token]`), share-link + photo-approval office UI

**Decision date:** 2026-07-06

**Context:** Batch 3, sub-phase H: a public, unauthenticated, read-only
customer status page at `/portal/[token]`, gated by an unguessable
per-project share token — name, % complete, most recent update, next
planned milestone, and only office-approved photos. Never shortages,
costs, reconciliation, or internal notes. Plus office-side UI to
generate/revoke links and to approve which photos are customer-visible.

**Choice — build on the `share_tokens` table as-is, add only
`revoked_at`:** `share_tokens` (project_id, token, scope, expires_at)
already existed in full since Phase 2 — provisioned ahead of time, RLS
already owner/pm-only, with a migration comment already anticipating
"the portal reads this via service_role." The one real gap: only
`expires_at` existed, no way to explicitly revoke a link before its
natural expiry as a distinguishable office action (vs. quietly setting
`expires_at` to now, which would make an intentional revoke
indistinguishable from natural expiry in the office's own management
view). Added `share_tokens.revoked_at timestamptz`; a token is invalid
if `revoked_at` is set OR `expires_at` has passed — the portal collapses
both into one generic "this link is no longer valid" message (nothing
customer-facing should explain _why_ beyond "ask your PM"), while the
office UI shows the three states (`active`/`revoked`/`expired`)
distinctly.

**Choice — a new `approved_photos` table, not a flag on `day_logs`/
`blockers`:** neither existing photo-bearing table can carry a
per-photo approval cleanly — `day_logs.photo_paths` is a plain `text[]`
(no per-photo row to hang a boolean off without normalizing crew
uploads themselves), and `blockers.photo_path` documents a _problem_,
not something to default-expose to a customer. A dedicated table keyed
by the photo's own `storage_path` (`unique(project_id, storage_path)`)
lets an office user curate photos from either source into one
customer-facing list without touching either source table's shape, and
without ever auto-suggesting a blocker photo as "probably fine to
show."

**Choice — "next milestone" = `projects.deadline`, falling back to the
latest saved `project_estimates.forecast_finish`:** no existing concept
of a forward-looking "next milestone" exists anywhere in the schema
(`phases` has no date columns at all). `deadline` is set directly by a
PM at project creation and is the more reliable, always-intentional
figure; a saved estimate's `forecast_finish` (sub-phase D) is the only
other genuinely forward-looking, already-computed date in the system,
used only when no deadline is set. If neither exists, the portal simply
omits that stat card rather than inventing a number.

**Choice — the public route reads through `createAdminClient()` with
deliberately narrow `select()`s, never `select("*")`:** an anonymous
portal request has no session at all, so RLS has nothing to scope
against — same reasoning as `lib/reports/data.ts` (a Vercel Cron
request has no session either). But unlike that module (an
office-only email, free to read broadly), this route's output is
directly customer-facing, so `lib/portal/public.ts` names only the
exact columns the page renders (`name, status, pct, deadline` from
`project_progress`, never `rows_missing_materials`/`required_total`/
`installed_total`) rather than reusing the wider selects other admin-
client callers use.

**Choice — office-side share-link + photo-approval UI lives on its own
new "Portal" project tab, not folded into Overview:** matches this
codebase's own precedent of a dedicated tab per distinct concern
(Receiving, Progress, Estimate) rather than growing Overview
indefinitely; hidden on `'estimate'`-status projects (a pre-sale draft
has no customer to share a link with yet), same convention as
Layout/Receiving/Progress.

**Consequences:** One migration (`revoked_at` column +
`approved_photos` table/RLS/grants), types regenerated and
hand-adjusted (new `PhotoSource` literal union, same ADR-010 pattern).
New `lib/portal/public.ts` (admin client, public route only),
`lib/portal/queries.ts` + `lib/portal/actions.ts` (RLS-scoped, office
UI only) — deliberately split into two files by auth context rather
than one module with admin/RLS branches, so it's never ambiguous at a
call site which client a given function uses. `daily-photos` bucket
signed URLs generated fresh per request (1 hour expiry) on both the
public and office sides — no persistent public URL scheme exists for
this private bucket.

**Bug found via the new E2E spec (test-only):** a share-link status
badge (`active`/`revoked`/`expired`) is styled with a plain CSS
`capitalize` class over the lowercase literal string — visually reads
"Active"/"Revoked", but the actual DOM text content Playwright's
`getByText()` matches against stays lowercase, since CSS
`text-transform` never changes the underlying text node. An unscoped
`getByText("Active", {exact:true})` assertion had **already been
silently matching the wrong element** (the project header's own status
pill, which _is_ properly capitalized) rather than the token's own
badge — a false-positive pass for the wrong reason, only caught once
the later `getByText("Revoked", ...)` assertion had no same-named
decoy element to accidentally match and failed outright. Fixed both
assertions to check the lowercase text, scoped to the specific token's
own row.

**Decision date:** 2026-07-06

**Context:** Batch 3, sub-phase G: bulk-import a materials list or a
row×material assignment sheet from a spreadsheet, duplicate a whole
multi-row selection as a repeating pattern, bulk-select/delete/edit
materials, and a real drawing-versioning UI on top of sub-phase 0's
`drawing_versions` table (which had shipped with zero application code
ever reading or writing it).

**Choice — `exceljs` + `papaparse`, not the `xlsx` (SheetJS) npm
package:** `xlsx`'s own npm-registry release has a **high-severity,
unpatched** prototype-pollution advisory and a ReDoS advisory (SheetJS
stopped publishing patched releases to the npm registry itself, pushing
users to install directly from their own CDN tarball instead — not a
supply-chain source worth taking on for this). `exceljs` (XLSX/XLS) +
`papaparse` (CSV) are both actively maintained with no comparable
severity findings — `npm audit` after installing both shows only one
new moderate finding (a transitive `uuid` "missing buffer bounds check"
inside `exceljs`, far short of xlsx's unpatched high-severity one) plus
the pre-existing, unrelated `postcss`/`next` moderate finding that
predates this sub-phase entirely.

**Choice — one import dialog with a mode toggle, not two separate
dialogs:** materials-list import and row-assignment import share the
entire file-parse → column-map → preview → confirm shell; only the
field list and the confirm action differ. A `mode` toggle inside one
`ImportMaterialsDialog` reuses that shell instead of duplicating it.
Column mapping is a real interactive step, not a black box: each target
field gets its own `<select>` of detected headers, pre-guessed via
case-insensitive exact-then-substring matching against a synonym list
(`guessColumnIndex`) — auto-guessing gets the common case right without
ever hiding the mapping from the user or forcing a rigid header format.

**Choice — row-assignment import resolves against the project's
EXISTING rows/materials by name, never auto-creates either:** a
spreadsheet has no geometry to draw a new row from, and a typo'd
material name silently creating a duplicate would be worse than a
visible "no material named X" skip. Every preview line is either fully
resolved (both row label and material name match an existing record) or
hard-skipped with a stated reason — never partially applied. The commit
step reuses the existing `upsertRowMaterialQtyMany` Server Action
directly (no new action needed) since resolution already happens
client-side, where the page's own already-fetched rows/materials lists
live.

**Choice — "Duplicate range ×N" reuses `duplicateRows` unmodified,
called once per source row with N pre-offset copies, not a new Server
Action:** `duplicateRows(projectId, drawingId, sourceRowId, newRows[],
copyMaterials)` already accepted _multiple_ new rows per source (the
existing single-row "Copy" button just always passed exactly one) —
generating `repeatCount` geometries client-side, each offset by a
cumulative multiple of the _selection's own bounding-box_ width/height
(not each row's individual width/height, which would place every row
adjacent to itself independently and overlap its neighbors once more
than one row is involved), was the whole feature. The dialog also
finally exposes `copyMaterials` as a real checkbox — it existed as a
parameter since the original Copy button shipped, just hardcoded `true`
at its one call site.

**Choice — materials bulk ops (select/delete/set-condition) live
directly in `MaterialsGrid`, not a copy of the rows' command-panel
pattern:** the grid already owns its own `useTransition`/`error` state
for every per-cell edit; a `selectedIds` Set plus a conditional
bulk-action bar reuses that same `run()` helper rather than introducing
a second undo-less action-dispatch shape. No undo/redo here (materials
in this codebase are edited directly, never undo-tracked — matching
existing per-cell edits, not rows' undo-tracked geometry).

**Choice — first-ever drawing upload auto-creates an approved v1;
every later upload of the same page supersedes and starts unapproved:**
sub-phase 0's own migration comment already specified the intended
contract ("re-uploading a page inserts a new version row, marks the
prior latest superseded, updates `drawings` in place") — this sub-phase
is the first code to implement it. A brand-new page has nothing yet to
review against, so gating it would just be friction on day one with no
safety benefit; a _revision_ to an already-in-use drawing is exactly the
moment a PM should look before crews build off it, so it starts
`approved_for_install = false` until someone explicitly approves it.
Approving one version defensively un-approves every other version for
that page, keeping "at most one approved version per page" true even if
called out of order.

**Choice — the version panel warns, it doesn't hide or block the
drawing:** consistent with this codebase's established "warn, don't
hard-block" posture (ADR-029's double-booking warning, sub-phase F's
blocked-row scheduler warning) — the marking canvas keeps working
exactly as before, with a visible banner ("hasn't been approved for
install yet") for every role including crew. Turning this into an
actual gate is explicitly a later (Batch 4) job that builds on this UI.

**Consequences:** No schema migration — `drawing_versions` already
existed from sub-phase 0. New `lib/drawings/{queries,actions}.ts`, and
`lib/projects/actions.ts#recordDrawingUpload` now also inserts the
matching version-1 row for every newly uploaded page (previously it
only touched `drawings`). New `data-testid`s on both drawing-upload
hidden `<input>`s (`drawing-upload-input`, `drawing-version-upload-input`)
since a project with any existing drawing now legitimately has two file
inputs on the Layout tab — a bare `input[type="file"]` locator, safe
everywhere before this sub-phase, is now ambiguous for any SECOND
upload on the same page; fixed the one pre-existing test this broke
(`multi-page-flow.spec.ts`) and this sub-phase's own new test the same
way. Materials grid gained a leading checkbox column, which shifted
`estimating-flow.spec.ts`'s positional `row.locator("input").nth(1)` —
the same "adding a grid column breaks a positional test locator" lesson
ADR-030 already logged once, recurring because a new column was added
without re-checking for positional locators elsewhere — fixed with an
explicit `data-testid` instead, again.

**Bug found via the new E2E specs themselves (test-only, not
application code):** a fast client-side tab navigation (Materials →
Layout) can read the drawing image's bounding box _before_ the
zoom/pan "fit to screen" `useEffect` has recomputed it, capturing the
image at its un-fitted natural size instead of its final on-screen
size — invisible in every _existing_ test because they all reach the
canvas via a slow round trip (a real upload's "uploaded." wait) that
incidentally gives the effect time to settle first. Polling the
bounding box for two consecutive stable reads did not reliably fix
this; explicitly clicking the real "Fit to screen" button first does,
since that recomputes the fit synchronously in its own click handler
rather than racing an effect. Applied to this sub-phase's own new
`import-bulk-flow.spec.ts`.

**Bug found via dogfooding this sub-phase's own new drawing-version
panel (test-only):** adding a visible panel above the marking canvas
pushes the stage further down the page — on `field-flow.spec.ts`'s
390×844 mobile viewport and `layout-interaction-flow.spec.ts`'s later
steps, this left parts of the canvas below the fold for a raw
`page.mouse` coordinate (which, unlike a locator `.click()`, does not
auto-scroll anything into view first). Fixed by adding
`scrollIntoViewIfNeeded()` on the drawing image before computing a
bounding box for mouse math, in both affected specs.

**Decision date:** 2026-07-06

**Context:** Batch 3, sub-phase F: turn sub-phase 0's schema
(`material_receipts`, `rows.materials_ready`/`area_accessible`/
`drawing_approved`, `row_progress.readiness_status`, richer `materials`
identity columns) into a real UI — check materials in as they arrive,
see a reorder list, mark a row's readiness inputs, and have the
scheduler warn before assigning a crew to a row that isn't actually
ready.

**Choice — a new "Receiving" project tab, not a rebuilt Materials
tab:** the Materials grid is already dense (Task/Size/Labor columns
from sub-phase D, now Profile/Capacity/Condition/System from this
sub-phase too) — receiving is a different mental mode (an event log:
"what showed up today") from editing required quantities, so it gets
its own tab (between Materials and Progress) rather than more columns
or a modal bolted onto an already-full grid. Hidden on `'estimate'`
status projects, same convention as Layout/Progress (a pre-sale draft
has nothing to receive).

**Choice — `material_receipts` stays an append-only event log; only
`status='received'` syncs the `materials.received` aggregate:** a
shipment can arrive in batches and get flagged along the way (short/
damaged/wrong), so the log is authoritative for the full history —
but `material_reconciliation` already depends on the fast
`materials.received` column, so the one status that actually means
"this qty is now on hand" (`'received'`) does a read-modify-write to
keep that aggregate in sync, the same "log feeds an aggregate column"
relationship `installs` already has with reconciliation. Every other
status (`ordered`/`verified`/`staged`/`short`/`damaged`/`wrong`) has no
separate aggregate to maintain — the log itself is the source of truth,
surfaced as a per-status count breakdown and a flagged banner when
short/damaged/wrong has ever been logged.

**Choice — reorder list derives from `material_reconciliation.to_order`,
no separate computation:** `to_order` (needed − received, floored at 0)
already existed from Phase 5 — the Receiving tab just filters/sorts the
existing view instead of re-deriving shortage math a second way.

**Choice — row readiness checkboxes get their own local `useState`,
seeded from props:** identical bug class to the layout editor's
snap-back fix (ADR-031) — a fully server-controlled `checked={prop}`
checkbox visually reverts the instant React re-renders with the same
still-stale prop, before the Server Action's `revalidatePath` round
trip lands. Fixed the same way: local state seeded from props, updated
optimistically alongside the parent callback. Safe here for the same
reason as the layout editor: `RowReadinessPanel` only stays mounted
while the row selection doesn't change — selecting a different row
resets `activeCommand` and unmounts it, so there's no window where a
real prop update needs to override stale local state.

**Choice — "warn, don't hard-block" for assigning a crew to a blocked
row, reusing the existing `window.confirm()` posture:** consistent with
the double-booking warning (ADR-029) — this sub-phase's job is to
surface readiness, not to gate scheduling on it (that's an explicit
Batch 4 sub-phase E job, "wire the receiving lifecycle into a _hard_
gate"). `AssignCrewForm` checks the target rows' `readiness_status`
and confirms by name before submitting; the row picker also shows a
"⚠ " prefix on blocked rows so the warning isn't the first time a PM
learns about it.

**Consequences:** `lib/materials/{queries,actions}.ts` are new feature
folders; no new migration (sub-phase 0 already shipped every column and
table this sub-phase reads/writes). `MaterialsGrid` gained four columns
(Profile, Capacity, Condition — a `<select>`, System) after Labor,
which made a pre-existing test's bare `row.locator("select")` ambiguous
— fixed with an explicit `data-testid` rather than a positional index
(same lesson as ADR-030, still holding). Also wired up
`listMaterialReceiptHistoryByProject` (a bulk, one-query-per-project
history fetch, not one query per material) into an expandable "History"
disclosure per material on the Receiving tab — written to back a real
UI element rather than left as an unused export, per this repo's own
"no unused exports" rule.

**Bug found via a genuine Playwright deadlock (not this sub-phase's
application code, but its own new test):** `AssignCrewForm.handleSubmit`
calls `window.confirm()` synchronously, with no `await` before it —
unlike the crew calendar's `assignOrMove`, which awaits
`checkDoubleBooking()` first. Playwright's `.click()` does not resolve
until a triggered native dialog is handled, so the calendar test's own
working pattern, `Promise.all([page.waitForEvent("dialog"), click()])`,
deadlocks for a _synchronous_ dialog: `click()` can't resolve without
`dismiss()`, and `dismiss()` never runs because `Promise.all` is still
waiting on `click()` to resolve first. Fixed by registering
`page.once("dialog", handler)` _before_ the click and awaiting the
click alone (not wrapped in `Promise.all`) — the listener fires and
dismisses independently of the click's own promise. Documented in
`docs/ARCHITECTURE.md`'s Testing section as a third distinct dialog-
handling variant, alongside the two already documented there.

**Bug found via test-pollution (not this sub-phase's application code):**
two stray crews (`[E2E] Materials lifecycle crew <timestamp>`) were left
behind by earlier failed runs of this sub-phase's own new test — each
failure happened before the test reached its own `afterAll` cleanup
(back when the dialog deadlock above was still unfixed), and those
crews persisted permanently since nothing else ever deleted them. They
broke `scheduler-flow.spec.ts`'s `.locator("div", {hasText:
CREW_NAME}).first()` (`.first()` in document order matched an
unrelated outer container once more than one crew existed on the page,
the same "matches every ancestor" bug class documented elsewhere in
this log) — fixed by deleting both via a one-off admin-client script,
not by changing the now-fixed test.

---

## ADR-032: Sub-phase E — exception-first dashboard, emailed reports (Resend), closeout PDF (@react-pdf/renderer)

**Decision date:** 2026-07-06

**Context:** Batch 3, sub-phase E: a company-wide office dashboard
(active projects with SPI risk, cross-project material shortages,
blockers needing escalation, crew over/under-performance, "what
changed today"), auto daily/weekly emailed project reports plus a
manual "email now," and a per-project closeout PDF.

**Choice — a new `/app/dashboard` page, not a rewrite of `/app`:** the
existing `/app` is already the plain Projects list, and a large fleet
of existing E2E specs (`project-flow`, `row-workspace`, etc.) navigate
there expecting exactly that. Adding the dashboard as its own page
(with its own nav link, first among the office-role links) delivers
everything asked for with zero risk to the ~20 existing specs that
assume `/app` is the project list.

**Choice — SPI logic extracted into `lib/scheduler/spi.ts`, not
duplicated a third time:** `computeProjectSpi` is the _exact_ formula
`scheduler-workspace.tsx` already had inline (`useMemo`) — pulled out
verbatim so the dashboard can compute identical SPI for every active
project without a second implementation to drift out of sync with the
first. `classifySpi`/`RISK_TIER_CLASS`/`RISK_TIER_LABEL` formalize the
three-tier success/primary/destructive convention already established
by the SPI badge and week-view's per-day status (green ≥1.0, primary
≥0.8, destructive below — ADR-022) — confirmed via research that this
codebase's risk convention is genuinely success/primary/destructive,
not success/_warning_/destructive (the `warning` token exists but is
used exactly once, for an unrelated qty-mismatch flag).

**Choice — "crew over/under-performance" reads the estimation brain's
`crew_rates`, not a second targets-derived SPI:** sub-phase D's
`getCrewRatesLookup`/`getCompanyRatesByTaskKey` already blend a crew's
learned efficiency vs. standard pace — reusing it needed zero new
computation and is a more direct signal than re-deriving a per-crew
figure from `targets` (itself already an even-split approximation,
ADR-022).

**Choice — the service-role admin client for all report-data gathering,
not the per-request cookie-scoped client:** the daily/weekly send has
two callers with very different auth contexts — a Vercel Cron request
(no user session, no `auth.uid()` at all; RLS would silently return
nothing) and the dashboard's manual "email now" button (a real session,
gated by `requireRole` before ever reaching this code). Using the
admin client uniformly in `lib/reports/data.ts`/`send.ts` means one
code path is correct for both, rather than a client-scoping branch only
one of them would ever actually exercise.

**Choice — Vercel Cron + a `CRON_SECRET` bearer check, not an in-app
scheduler:** this deployment has no background-job runtime of its own.
Vercel Cron (a `vercel.json` `crons` entry calling a Route Handler on a
schedule) is the standard mechanism for a Vercel-hosted Next.js app;
Vercel automatically sends `Authorization: Bearer ${CRON_SECRET}` when
that env var is set, so the route's own check is a plain string
compare, not a custom scheme. The check no-ops when `CRON_SECRET` is
unset, so the route works before that env var exists (documented as a
NEEDS-YOU item, not a blocker).

**Choice — one report email per active project, not one company-wide
digest:** the spec's own language ("marked-drawing image, %, today's
installs, blockers, on-track/at-risk") is inherently per-project data;
recipients are every org owner/pm (there's no customer-contact concept
yet — that's explicitly a later batch's job) — matches how a PM
tracking several jobs would expect updates, one per job.

**Choice — `@react-pdf/renderer` for the closeout PDF, not a headless
browser:** Puppeteer/Playwright-driven HTML-to-PDF needs a full
Chromium binary, which is heavy and awkward in a Vercel serverless
function (cold starts, `@sparticuz/chromium`-style workarounds).
`@react-pdf/renderer` is pure JS, renders via its own PDF primitives
(`Document`/`Page`/`View`/`Text`/`Image`), and its `renderToBuffer`
runs directly in a Route Handler with no extra runtime dependency.

**Choice — `resolveBlocker` + a "Mark resolved" button, not part of the
original ask but required to make the ask work:** `blockers.resolved_at`
has existed in the schema since Batch 2 but no application code ever
read or wrote it — every blocker ever reported would otherwise show as
"needing escalation" forever, since nothing could ever clear one. A
narrow owner/pm action (matching `blockers_update` RLS exactly) was the
minimum needed for the escalation list to mean anything over time.

**Consequences:** `lib/dashboard/` and `lib/reports/` are both new
feature folders reading from tables that already existed (`blockers`,
`material_reconciliation`, `crew_rates`, `project_estimates`) — no
schema migration needed for this sub-phase. Live-verified the actual
Resend integration against the real API key already in `.env.local`:
confirmed it correctly reaches Resend (not a stub), and that Resend's
sandbox mode rejects sending to any address but the account's own
verified email until a domain is verified — the dashboard's "email
now" button was adjusted to surface that real error explicitly (`Could
not send: ...`) instead of a misleading "no active projects" message
that the original, less-informative version would have shown for
exactly this case. See the NEEDS-YOU list for the domain-verification
step this surfaces.

**Bug found via dogfooding (unrelated to this sub-phase's own code):**
`e2e/packing-slip-extract-flow.spec.ts` intermittently failed under
full-suite load (passed reliably alone) — `PackingSlipExtractDialog`
legitimately renders twice for the same slip (once in the fresh-upload
confirmation, once in the persistent uploaded-slips list that
re-fetches immediately after upload), and the test's role-based
locator had always been ambiguous, just usually resolved by timing
that happened to favor the first match. Fixed with an explicit
`data-testid` on the fresh-upload instance rather than continuing to
rely on timing.

## ADR-031: Layout editor interaction rework — modeless pointer model, pan priority, local-first move/resize

**Decision date:** 2026-07-06

**Context:** A user-requested rework of `row-stage.tsx`/`row-marking-workspace.tsx`, interaction/UX only — explicitly no changes to the data model, undo/redo, bulk actions, or normalized coordinates. Three asks: (1) kill any remaining mode-toggle buttons in favor of one context-driven pointer model; (2) make panning always available at the highest input priority (middle-mouse button, or holding Space) so it can never be hijacked by a row underneath the cursor; (3) fix a real bug — a moved/resized row visibly snapped back to its old position for a moment, then jumped to the new one once the network round trip landed.

**What was already true going in, not newly built:** the direct-manipulation model itself (plain drag draws, click selects, drag-on-selected-row moves, shift-click/shift-drag multi-selects/marquees, 8 resize handles, Space-held pans) was already built in an earlier session (see the `row-stage.tsx` docstring, pre-dating this ADR) — the only _mode_ button still standing was Pan (a Hand-icon toggle). This ADR's actual diff is narrower than "remove several mode buttons": remove the one remaining toggle, add middle-mouse pan, and fix the snap-back bug. Worth recording plainly since it's the second time this session a user's request described the codebase as further behind than it actually was (see ADR-030's Batch 4 preamble) — checking current reality before planning the diff avoided both re-building already-working features and under-scoping the actual gap.

**Choice — middle-mouse button pans by letting non-primary-button pointerdowns bubble untouched, not by special-casing them:** every pointerdown handler on a row body, a resize handle, and the resize-handle's parent all check `event.button !== 0` FIRST and return immediately _without_ `stopPropagation()` when it isn't the primary (left) button — the event then bubbles naturally to the stage's own `handleStagePointerDown`, which checks `event.button === 1` and pans regardless of `readOnly`/`shouldPan`/anything else. This is the exact same bubbling technique the existing Space-held check already used (`if (shouldPan) return; // let it bubble to the stage-level pan handler`), just extended to cover a second "let the stage handle this" condition — no new interception layer, no per-element duplicate pan logic. `event.preventDefault()` on the middle-button branch stops the browser's own native middle-click autoscroll from fighting the custom pan.

**Choice — local-first optimistic position, reconciled during render, not in a `useEffect`:** the actual bug was `handlePointerUp` clearing `draftGeometries` immediately after handing the change to the parent, so the very next render fell back to the (still stale, pre-round-trip) `rows` prop — a real, visible snap-back, corrected only once `router.refresh()` eventually delivered fresh props (the "teleports ~3s later"). Fixed by NOT clearing the draft on a successful drop — it now stays showing the dropped position — and only reconciling it away once the server-confirmed `rows` prop actually matches (a plain value comparison; this app has no separate realtime subscription for row geometry to race against, so there's no separate "echo" to distinguish from a plain refetch — matching by value is exactly as correct as a client-mutation-id scheme here, without needing to plumb one through). A failed persist (`onMoveRows`/`onResizeRow`'s promise rejecting — both now return the underlying persist promise instead of firing-and-forgetting) reverts the draft immediately and fires a toast, independent of the reconciliation path. The reconciliation itself is intentionally NOT a `useEffect`: the newer, compiler-aligned `eslint-plugin-react-hooks` rules in this Next 16 / React 19 setup flag both "setState directly in an effect body" (`react-hooks/set-state-in-effect`) and "reading a ref during render" (`react-hooks/refs`) as errors — ruling out both the obvious effect-based approach and the classic ref-based `getDerivedStateFromProps` workaround. The one still-sanctioned mechanism is React's own documented "adjust state when a prop changes" pattern (react.dev — storing the previous prop value in _state_, not a ref, and calling `setState` conditionally during render when it differs) — used here to know when `rows` has actually changed, at which point any now-matching draft entries are dropped before this render ever paints (no one-frame flicker the way an effect-based fix would still have).

**Choice — starting a new drag/resize reads from the row's current DISPLAYED geometry (draft-or-row), not the raw `rows` prop:** a `currentGeometry(row)` helper feeds `beginRowMove`/`beginResize`'s origin computation. Without it, a second interaction on the same row started while its first move/resize is still persisting (draft showing, prop not yet caught up) would silently compute its delta from the stale pre-first-move position — correct once the two operations were far enough apart in time to never overlap, wrong in exactly the "local-first, draft outlives the prop" scenario this rework introduces.

**Choice — a plain click on empty space now deselects, closing a real UX gap found while implementing the middle-mouse fix:** previously only a shift-click-without-drag (landing in the marquee branch) cleared selection; a plain click-without-drag fell into the draw branch's `if (moved && box...)` condition, which is false for a non-drag click, so nothing happened at all — clicking empty space silently failed to deselect. Fixed alongside the Escape-to-deselect key handler the request also asked for.

**Consequences:** the toolbar has one fewer button (no mode buttons remain at all — Auto Rows, Undo, Redo, Fullscreen are the whole toolbar, matching the request's "Auto rows is a creation utility, not a mode"). `onMoveRows`/`onResizeRow`'s prop types changed from `void`-returning to `Promise<void>`-returning — `RowMarkingWorkspace`'s `runAction` now returns the underlying persist promise instead of being fire-and-forget, which every existing caller (draw, copy, delete, rename, materials, phase) continues to use exactly as before (none of them depended on the old `void` return). New `e2e/layout-interaction-flow.spec.ts` covers what's genuinely new here (mode buttons gone, click/Esc deselect, shift-drag marquee, middle-mouse pan leaving a row's DB geometry untouched while visibly shifting its on-screen position, zero visual jump immediately after a drop and none once persisted) — draw-on-empty-drag, click-select-plus-resize, and undo/redo were already covered by the pre-existing `row-workspace.spec.ts`, confirmed still green rather than re-tested.

## ADR-030: Sub-phase D — estimation brain: labor units as standard hours, three-tier crew rates, estimate-status projects

**Decision date:** 2026-07-06

**Context:** Batch 3, sub-phase D: convert materials to labor units by
size, learn per-crew rates from install history, produce a per-project
estimate (hours → crew-days → forecast finish + confidence) that feeds
the scheduler, a what-if tool, a company estimating screen for
pre-sale material lists, and an optional AI "explain this estimate"
assistant. `materials.labor_units`, `materials.size`, `crew_rates`, and
`projects.planned_days` already existed (Phase 2 / Batch 3 sub-phase 0),
seeded specifically so this sub-phase would only need new application
logic, not new columns for the core model.

**Choice — 1 labor unit ≡ 1 hour at standard pace:** `labor_standards
.base_labor_units` is defined as hours-per-unit at a baseline pace, so a
material's `labor_units` (`base_labor_units × size factor`) is literally
"how many hours this takes at standard pace." This makes
`crew_rates.units_per_hour` a clean efficiency _multiplier_ relative to
standard (1.0 = exactly standard, 1.2 = 20% faster) instead of an
arbitrary unit needing its own calibration table, and makes the
un-sampled fallback for a brand-new crew an honest, explainable `1.0`
rather than a guess.

**Choice — three-tier rate resolution, not a flat fallback:** for a given
task_key, `resolveRate` tries (1) that specific crew's own
`crew_rates` row, but only once it has `MIN_SAMPLES_FOR_CREW_RATE` (3)
sampled days — otherwise a brand-new crew's first noisy day would swing
its rate wildly; (2) a company-wide rate, samples-weighted across every
crew's `crew_rates` rows for that task_key — reflects the org's actual
historical pace, which may differ from the seeded standard; (3) the
standard pace of `1.0` if literally nobody has installed that task_key
yet. The company-wide figure is derived from `crew_rates` itself (cheap,
already-learned data), not recomputed from raw installs on every read —
only the explicit "Recompute crew rates" action touches the raw
install/day-log history.

**Choice — crew-rate learning allocates a day's hours across task_keys
proportional to that day's labor-unit output, and excludes blocked
days:** `day_logs` records one arrival/install/departure time range per
(crew, project, day) — it has no per-task breakdown, since a crew mixes
tasks within a day. `recomputeCrewRates` allocates each day's
`install_end − install_start` hours across whichever task_keys were
actually installed that day, weighted by each task_key's own share of
that day's total labor units (the same "no finer-grained data exists,
attribute proportionally to output" reasoning already used three times
this batch — ADR-022's target split, ADR-029's capacity/SPI splits).
Days with any blocker logged for that (crew, project, date) are excluded
entirely from the learning set: a blocked day's near-zero output would
otherwise read as terrible productivity and drag the average down
unfairly, not reflect the crew's real pace. A fixed 90-day trailing
window ("rolling" = re-run periodically over the last N days, not an
exponential decay) — recomputed fresh from the event log each time
(full recompute, not an incremental EMA update), matching this
codebase's existing preference for auditable recomputation over
hand-maintained running aggregates (`project_estimates` itself is the
same pattern: insert a new row, never mutate the last one).

**Choice — size parsing takes the leading number, nothing fancier:**
`parseLeadingNumber` pulls the first numeric token out of a free-text
`size` field ("96in" → 96, "10' 6\"" → 10) and only applies it for
unit_basis values that actually scale with size (`per_ft_height`,
`per_linear_ft`); a size that doesn't parse, or a `per_each`/`per_piece`
basis, falls back to the base labor units unscaled. A full
feet-and-inches dimensional parser is real scope this sub-phase doesn't
need — every seeded task_key only ever needs a single linear number, and
silently falling back to "size-independent" is safer than guessing wrong
on an unparseable string.

**Choice — two deliberately different "remaining" figures, not one
shared function:** the scheduler's `getProjectRemainingLaborUnits`
(sub-phase C) answers "how much of what's already been mapped onto
specific rows still needs installing" (`assigned − installed`) — the
right question for day-to-day capacity planning, since only
row-assigned work is schedulable. The estimating brain's own
`getProjectLaborUnitsByTaskKey` answers "how much of the whole project's
scope is left" (`total_needed − installed`) — the right question for a
forecast-to-finish, and the ONLY sensible one for a pre-sale draft
estimate that has no rows at all yet (its `assigned` is always 0). These
converge once every material is fully row-assigned and diverge early in
a project's life; conflating them would have made one of the two
consumers wrong.

**Choice — sub-phase C's capacity placeholder is now upgraded to real
rates, but stays a per-project blend, not per-crew:** per ADR-029's own
stated consequence, `getProjectDailyLaborLoad`'s internals now convert
standard labor units to actual hours via `getCompanyRatesByTaskKey`
before the calendar ever sees the number — no change to
`CrewCalendar`'s props or the capacity-cell UI. This is deliberately a
per-_project_ blended rate, not a per-crew-accurate one: the calendar
computes `laborLoadByProject` once per project, before it's known which
specific crew a given day's cell belongs to (crews are assigned
per-day, the load figure isn't). A true per-crew-adjusted capacity
number is a reasonable future refinement, out of scope here specifically
to honor "no UI changes" — documented, not silently approximated.

**Choice — a pre-sale draft reuses the real `projects`/`materials`
tables via a fourth status, not a parallel data model:** `projects
.status` gains `'estimate'` (alongside `active`/`on_hold`/`complete`).
The company estimating screen (`/app/estimate`) is just: create a
project with `status = 'estimate'`, paste its material list on the
existing Materials tab (now task_key/size-aware), and read its
Estimate tab — reusing the entire existing paste/grid/reconciliation
pipeline instead of inventing a separate "draft estimate" shape.
`listProjectsWithProgress` excludes `'estimate'` by default (mirrors
Field/Scheduler already querying `status = 'active'` only); converting
is a one-column status flip with no data migration, since it was always
a real `projects` row. A draft's `ProjectTabs` hides Layout/Progress
(no drawing, no install progress to show) but keeps Estimate — which is
also shown on every _active_ project, since a live forecast-to-finish is
useful well past the pre-sale stage.

**Choice — "explain this estimate" is hidden outright when
`ANTHROPIC_API_KEY` is unset, a small deviation from the packing-slip/
voice-note precedent:** those two AI features always render their
button and surface a clean 500 from the route if unconfigured (simplest
at the time, and the button already exists for other reasons in both
cases). Here the explain button is a purely additive, secondary
affordance with no other reason to exist on the page — computing
`Boolean(process.env.ANTHROPIC_API_KEY)` server-side and passing it down
avoids ever showing a control that can only fail, matching
`voice-note-recorder.tsx`'s "render `null` when unsupported" posture
just gated server-side instead of by browser feature detection.

**Bug found via dogfooding, not part of the original brief:**
`MaterialsGrid` unconditionally replaced its ENTIRE contents (table,
"+ Add material", "Paste from packing slip") with an "add rows first"
placeholder whenever a project had zero rows — harmless before, since
every real project always marked a drawing before touching Materials in
practice, but a hard blocker for this sub-phase's whole "paste a
material list before there's a drawing" use case. Fixed by only
suppressing the row-assignment _columns_ (which correctly render empty
when `rows = []`) and turning the placeholder into a small informational
note above the table rather than a replacement for it.

**Consequences:** every material now carries a `task_key` (defaults to
`'general'`) and a size-aware `labor_units`, kept in sync automatically
by `updateMaterial`/`pasteMaterialList`/`confirmExtractedMaterials`
rather than a manual override field. Packing-slip AI extraction now
also infers `task_key` from its own already-constrained description
vocabulary (no extra AI call) and persists `size` to its own column
(previously folded into `name` only). `crew_rates` and `labor_standards`
— both schema since Phase 2 / Batch 3 sub-phase 0 — are finally read
and written by real application code. The scheduler's capacity view
silently gets more accurate as crew history accumulates, with zero
migration needed on the calendar/Gantt/SPI components themselves.

## ADR-029: Sub-phase C — cross-project crew calendar (native HTML5 DnD), interim labor-unit capacity, phase-inferred Gantt

**Decision date:** 2026-07-06

**Context:** Batch 3, sub-phase C: a crew calendar across all projects
(not just the existing per-project week view), drag-and-drop assignment
with double-booking warnings, a capacity view (planned load vs.
available labor-hours), per-crew SPI alongside the existing per-project
figure, and a Gantt-style project timeline. Several of these explicitly
depend on "the estimator" (learned per-crew labor rates), which is
sub-phase D — the next sub-phase, not this one.

**Choice — native HTML5 drag-and-drop, no new dependency:** dragging a
project chip onto a crew's day cell (create), or an existing
whole-project assignment chip onto a different cell (move), is a
standard `draggable` + `dragstart`/`dragover`/`drop` interaction — a
generic DnD library would be solving a problem the platform already
handles natively. This is a different call than `row-stage.tsx`'s
hand-rolled _pointer_ events (justified there by needing precise
zoom-aware geometry math no library would get right); a calendar cell
grid has no such requirement. Scoped to whole-project assignments
(`row_id: null`) only — a rows/phase-scoped assignment is really N
underlying `assignments` rows (one per row, see `createAssignment`), and
moving that batch atomically via one drag isn't what the calendar's
simple crew-×-day grid models; finer-grained reassignment stays in the
per-project `AssignCrewForm` dialog. Verified with Playwright's
`locator.dragTo()`, which correctly drives real `dragstart`/`dragover`/
`drop` events against this implementation in Chromium — confirmed
empirically, not assumed.

**Choice — double-booking is a warning (native `confirm()`), not a hard
block:** a crew genuinely can split a day across two projects in rare
cases; the common case is a mistake, so `checkDoubleBooking` runs before
every create/move and a plain `window.confirm()` names the conflicting
project(s) before proceeding. No custom modal — a native confirm is
enough for a "did you mean to do this" gate, and one fewer component to
maintain.

**Choice — capacity uses `materials.labor_units` directly (1:1 with
hours) as an explicit placeholder, not a blocking dependency on
sub-phase D:** "planned load" per crew-day = a project's remaining labor
units (`assigned − installed` per material, weighted by
`labor_units` — mirroring `listRemainingByMaterial`'s existing
"remaining" definition, just labor-weighted) spread evenly across its
remaining scheduled days (same "no rule specified, split evenly"
reasoning `generateTargets` already uses for material qty, ADR-022),
then split further across however many crews share that project on that
day. "Capacity" = `crew.size × 8` hours. `labor_units` defaults to `1`
— read as "one standard hour" — so units and hours are numerically
equal until sub-phase D replaces this flat assumption with real,
learned `crew_rates.units_per_hour`. This is the ordering dependency the
batch's own sub-phase sequence implied (D explicitly "feeds the
scheduler's targets") — built now with an honest, clearly-documented
placeholder rather than blocked on work two sub-phases don't share an
owner for.

**Choice — per-crew SPI uses the identical even-split attribution as
capacity, applied to `targets` instead of labor units:** `targets`
stays project-wide (ADR-022 — never split per crew at generation time),
so a crew's "planned" for SPI purposes is that day's project target
divided by however many crews were assigned that day; "actual" is their
own `installs.crew_id`-scoped total (already tracked, no schema change).
Same approximation, same justification, applied to a different number.

**Choice — the Gantt timeline infers each phase's date range from
assignments, not a stored start/end:** phases have no date columns of
their own (`phases` is just name/color/sort_order). `getPhaseTimelines`
walks `assignments` joined through `rows.phase_id` (a whole-project
assignment counts toward every phase that has any row) and takes the
min/max `work_date` per phase. A phase with no assignments yet simply
has no bar — an honest "nothing scheduled for this yet," not a
zero-width placeholder bar.

**Consequences:** the cross-project calendar, capacity view, and Gantt
timeline are all built against data that already exists — no schema
change needed for sub-phase C itself. The capacity/SPI numbers are
real and useful (a "planned vs. actual" signal exists today), but
explicitly approximate — sub-phase D's per-crew learned rates will
replace the flat `labor_units`-as-hours assumption with something more
accurate, and that upgrade should require no changes to the calendar or
Gantt UI, only to what feeds their existing props.

## ADR-028: Sub-phase B — Field to flagship: assignments-today, day-summary confirmation, voice-to-note via browser STT + Claude cleanup

**Decision date:** 2026-07-06

**Context:** Batch 3, sub-phase B: complete the crew field experience —
"My assignments today," a mandatory day-summary review before closing
the day (not an instant one-tap close), end-of-day documentation
photos, and an optional voice-to-note feature that turns a spoken update
into a clean, editable draft.

**Choice — "My assignments today" reads `assignments` directly, matched
client-side by crew, same as day_logs/blockers:** `listTodayAssignments()`
fetches every crew's assignments for today, org-wide (a small dataset —
one day, whichever projects have work scheduled). `FieldHome` filters to
the selected `crewId` client-side, the same "server can't filter ahead
of render since crew selection is client state" reasoning ADR-021
already established for day_logs/blockers. Separately, `profiles.crew_id`
(sub-phase A) now seeds `useCrewSelection`'s default — a device that's
never picked a crew falls back to the _signed-in user's own_ assigned
crew rather than "no crew selected," still overridable per-device for a
shared tablet logging as someone else's crew.

**Choice — "edit/resume before final submit" + "day summary
confirmation" compose into one flow: Close the day → review screen →
confirm:** tapping "Close the day" no longer closes it — it transitions
to a review screen (today's net install qty per row/material, blocker
count, times, note, photos) with "← Back to edit" and "Confirm & close
day." This satisfies both asks at once: the crew can back out and fix
something (via the row's own material stepper's "Correct −N," not a
raw edit to the append-only `installs` log) before the day is
irreversibly marked closed, and the summary itself is the "day summary
confirmation." `MaterialStepper` also gained a "Today: +N" line (reading
a new `listTodayInstalls` query, net per crew) so the closeout figure
is visible at the point of logging, not just at day's end.

**Choice — voice-to-note: Web Speech API for transcription (client-side,
free), Claude for cleanup only (gated on `ANTHROPIC_API_KEY`):** the
Anthropic Messages API has no audio-input content block — "gate on
ANTHROPIC_API_KEY" only makes sense if transcription itself happens
elsewhere. `VoiceNoteRecorder` uses the browser's own
`SpeechRecognition` (vendor-prefixed on some browsers, unsupported on
others — feature-detected, and renders nothing at all when absent,
rather than a button that always fails) to transcribe locally, then
POSTs just the resulting text to `/api/field/voice-note`, which asks
Claude (forced tool-use, same pattern as packing-slip extraction) to
clean it into a concise note and flag a likely blocker code. The crew
always sees a draft — "Use as today's note" / "Report as blocker
instead" / "Discard" — before anything saves; nothing from the
transcript reaches the database unreviewed. `BlockerForm` gained
optional `initialCode`/`initialNote` props so the "report as blocker
instead" path can hand off the AI's suggestion without a second typing
pass.

**Choice — a real, previously-latent auth gap found and fixed while
building this: neither AI route checked who was calling it.** The
packing-slip extraction route (ADR-025) was _indirectly_ protected — an
unauthenticated caller would eventually fail inside
`getSignedPackingSlipUrl` (Storage RLS rejects the signed-URL request),
but as an uncaught exception, not a clean response. The new voice-note
route has _no_ indirect protection at all — it never touches Supabase,
so nothing stopped an unauthenticated caller from spending the
`ANTHROPIC_API_KEY` quota. Both now call `requireOrg()` (any signed-in
org member — crew should reach both) explicitly, wrapped to return a
clean `401` instead of a raw exception, consistent with ADR-027's
"server-side guards, not incidental protection" theme.

**Choice — end-of-day photos are `day_logs.photo_paths text[]`, not a
new one-to-many table:** distinct from `blockers.photo_path` (one photo
tied to one reported problem) — these are general documentation, so a
day can have more than one, but never more than a handful. A plain array
column, read-modify-write on add/remove (no realistic concurrent-write
race for one crew's own day), is simpler than a new table for something
that's never queried independently of its day log.

**Consequences — a genuine, transient external blocker, not a code
problem:** the migration adding `day_logs.photo_paths`
(`20260706105523_day_log_photos.sql`) could not be applied during this
session — `supabase db push` and the Management API's own SQL endpoint
both failed repeatedly with the same Supabase-platform-side error
("OOM command not allowed... maxmemory", then a 504, alternating across
roughly ten attempts spread over several minutes with real work
happening between them), while the three earlier Batch 3 migrations
applied cleanly through the identical mechanism minutes before. This
was verified as a platform issue, not a mistake in the migration SQL
itself or a credentials problem — the same access token authenticates
every other CLI/Management API call correctly. The application code was
written defensively against this (the Field project page reads
`log.photo_paths ?? []` rather than assuming the column exists) so nothing
currently live broke while this was pending, and `database.types.ts`
was hand-patched ahead of the migration landing (ADR-010's established
pattern for exactly this situation). The E2E test for this one feature
(photo attach/remove, part of `field-flow.spec.ts`) is written and
ready but could not be run live this session — flagged honestly rather
than skipped silently. Retrying periodically; will confirm and finalize
once the migration lands.

## ADR-027: Sub-phase A — shared requireRole guard, RPC for self-service name edit, Scheduler gated whole-page

**Decision date:** 2026-07-06

**Context:** Batch 3, sub-phase A: complete user management (assign a
user to a crew, on top of Batch 1's create/role/reset/deactivate),
org settings (name/address/logo/default working days), and — the part
with the widest blast radius — "enforce role permissions consistently
everywhere... add server-side guards, not just hidden buttons." Auditing
the existing codebase found every mutating Server Action relied
_entirely_ on Postgres RLS for role enforcement, with zero
application-level check: not a security hole (RLS genuinely blocks a
disallowed write), but a real gap from "hidden button is the only
defense" — a raw RLS error is what a disallowed caller saw, and nothing
stopped a future call site from reaching a service-role client without
re-deriving the caller's role first.

**Choice — one shared `requireRole`/`requireOrg` helper
(`lib/auth/session.ts`), applied everywhere a role restriction already
exists at the RLS level:** rather than each feature folder growing its
own copy-pasted "fetch org_id/role, throw if not allowed" (this had
already happened three times — `lib/team/actions.ts`'s
`requireOwnerOrPm`, `lib/projects/actions.ts`'s `requireOrgId`,
`lib/crews/actions.ts`'s `requireOrgId`), one helper now backs every
mutation: `lib/crews/actions.ts` (owner/pm/scheduler, matching
`crews_write`), `lib/phases/actions.ts` (same), `lib/rows/actions.ts`
and `lib/projects/actions.ts`'s materials/drawings/packing-slip
mutations (owner/pm, matching `rows_write`/`materials_write`/
`drawings_write`), `lib/scheduler/actions.ts` (owner/pm/scheduler,
matching `assignments_write`/`targets_write`/`project_schedule_write`),
and `lib/team/actions.ts` (refactored onto the shared helper instead of
its own copy). Each guard's allowed-role set is chosen to exactly match
the table's own RLS policy — never looser (that would be a false sense
of permission RLS then blocks anyway with a confusing raw error) and
never stricter without reason. `lib/field/actions.ts` (installs/
blockers/day_logs) deliberately keeps its existing org-only check with
no role restriction — crew _should_ reach these, that's the entire
point of the field app.

**Choice — self-service full-name edit goes through a narrow
`security definer` RPC, not a broader RLS policy:** "Account page
(change own password/name)" — password already worked
(`supabase.auth.updateUser`, `auth.users`, no RLS involved), but
`profiles_update`'s existing policy only lets owner/pm update _any_
profile row, including their own — a crew/scheduler user couldn't
self-edit their own name through it at all. Postgres RLS is row-level,
not column-level: a policy can't say "any signed-in user may update
this one column of their own row" without also exposing every other
column (`role`, `org_id`) on that row to a crafted client-side update.
`update_own_full_name(p_full_name)` hardcodes both `where id =
auth.uid()` and the one column it ever touches, so there's nothing
broader for a client to exploit even though the function itself bypasses
RLS — same reasoning as `set_marking_drawing` (ADR-019).

**Choice — `/scheduler` is gated to owner/pm/scheduler at the page
level, not left open with individually-hidden buttons inside it:**
`/scheduler` was in the base nav for every role, including crew, and
`CrewManager`/`ScheduleBuilder`/`AssignCrewForm` render their mutating
controls with zero role-awareness — a crew user could see and click
"+ New crew" today (previously failing with a raw RLS error, now a
friendly one, but visible and clickable either way). Rather than thread
role-conditional rendering through every control in that whole
component tree, the page itself now redirects non-owner/pm/scheduler
callers to `/app` — matching how `/app/team` and the new
`/app/settings` are already gated, and matching the product reality
that crew's equivalent view is "My assignments today" in Field (sub-phase
B), not the Scheduler management UI. The nav link is hidden to match.

**Consequences — explicitly scoped, not exhaustive:** this sub-phase
fixes the two clearest, most literal instances of "hidden button, not a
real guard" the spec named (Scheduler; the Team/Settings pages already
followed this pattern). It does **not** yet audit every remaining
screen for role-conditional rendering — e.g., the Materials grid still
renders editable inputs regardless of viewer role (blocked server-side
by the now-guarded `updateMaterial`/etc., just not visually hidden for
scheduler/crew). Deferred deliberately to sub-phase I's polish/QA pass,
which will have full visibility into every screen this batch touches
rather than auditing piecemeal mid-batch. Also found and fixed a real
E2E test bug while verifying: `e2e/team-settings-flow.spec.ts`'s own
crew-creation step (used to prove crew assignment) had no cleanup,
leaving permanent leftover `crews` rows that broke an unrelated test's
`.filter({hasText})` locator (matches every ancestor containing that
text — the same class of bug documented in `docs/ARCHITECTURE.md`'s
Testing section, this time triggered by test pollution rather than DOM
nesting alone).

## ADR-026: Batch 3 schema — receipts as an event log, drawing_versions parallel to drawings, row readiness precedence, types genuinely regenerated

**Decision date:** 2026-07-06

**Context:** Batch 3, sub-phase 0: schema for richer material identity +
a receiving lifecycle, row readiness, drawing versioning, the estimation
brain (labor standards + project estimates), and in-app notifications.
The user supplied a `SUPABASE_ACCESS_TOKEN` up front specifically so this
migration (and every later one) could be applied directly rather than
asked for by hand each time.

**Choice — `material_receipts` is an append-only event log, not a status
column + history table:** the spec offered either shape ("your call").
A shipment commonly arrives in batches (backorders, split deliveries),
and the lifecycle statuses (`ordered`/`received`/`verified`/`staged`/
`short`/`damaged`/`wrong`) aren't mutually-exclusive buckets that must
sum to the ordered total — "80 received in total" and "75 verified in
total" are both independently true facts about the same material at
once. An event log where each row is one fact ("N units reached status
X, at time T") models this more faithfully than a single mutable
row, and matches this codebase's existing `installs`-is-append-only
philosophy. `materials.received` stays the fast-read aggregate
`material_reconciliation` already depends on — a receiving check-in
action (sub-phase F) will keep it in sync when a `'received'` event is
logged, the same "log feeds an aggregate column" relationship `installs`
has with `material_reconciliation` itself.

**Choice — `drawing_versions` is a parallel history table, not a rework
of `drawings`:** `rows.drawing_id` FKs to a specific `drawings` row, and
existing rows must keep working. Re-uploading a page inserts a new
`drawing_versions` row (`unique(project_id, page_index, version)`),
marks the prior version `superseded_at`, and updates the _existing_
`drawings` row's `storage_path`/`width`/`height` in place — same `id`,
so no FK ever breaks. `drawings` stays "the current pointer per page";
`drawing_versions` is the append-only history + approval trail
alongside it. Existing drawings were backfilled as version 1,
pre-approved, so the versioning UI (sub-phase G) starts from a coherent
history instead of every current project showing no history at all.

**Choice — row readiness precedence: physical prerequisites gate
`'blocked'`, administrative ones gate `'ready'` vs `'partial'`:**
`row_progress.readiness_status` is computed as `'complete'` (pct
already 100 — readiness stops mattering once done) → `'blocked'` (not
`materials_ready` or not `area_accessible` — the two things that make
work _physically_ impossible to start) → `'ready'` (every prerequisite
met, including `drawing_approved` and derived `crew_assigned`) →
else `'partial'`. `crew_assigned` is deliberately not a stored column
(the spec marks it "(derived)") — it's `true` when an `assignments` row
with `work_date >= current_date` covers the row directly or via a
whole-project assignment; phase-scoped assignments already resolve to
individual per-row rows at assignment time (ADR-022), so both
assignment shapes reduce to that one check.

**Choice — `labor_standards`/`project_estimates` lay down the schema
now; the conversion/learning logic is sub-phase D's job:**
`materials.labor_units` and `crew_rates` already existed (Batch 2,
explicitly "feeds Scheduler productivity/target math in a later
sub-phase" — this is that later sub-phase). `labor_standards` seeds
reasonable default hours-per-unit for common racking tasks (upright/
beam/wire_deck/anchor/row_spacer/end_barrier/post_protector/general) per
org — estimates, not measured figures, same posture as ADR-022's SPI
thresholds; nothing downstream hardcodes these values, only the
task_key buckets as the recognized conversion categories.
`project_estimates` is append-only like `installs`/`material_receipts` —
recomputing inserts a new row so an estimate's history over a project's
life is never lost.

**Choice — types are now genuinely regenerated, not hand-written:**
with a working `SUPABASE_ACCESS_TOKEN`, `supabase gen types typescript`
finally ran for real (previously blocked — see ADR-010). Diffing against
it surfaced two categories of intentional deviation this codebase
already had before, now reapplied fresh: literal union types for
CHECK-constrained columns (the generator only ever emits plain `string`
for these — added `MaterialCondition`/`MaterialReceiptStatus`/
`RowReadinessStatus` alongside the existing four), and the generator's
newer output no longer emits a separate `Views<T>` helper (views are now
folded into `Tables<T>`'s own union) — added back a small `Views<T>`
compatibility alias rather than rewriting every `Views<"...">` call site
across the codebase to `Tables<"...">`. Separately, the generator marks
_every_ view column nullable (it can't prove non-nullability through
arbitrary view SQL) — re-applied the same "intentional, valid
improvement" judgment ADR-010 already established for CHECK constraints
to nullability: columns the view's own SQL genuinely guarantees
non-null (`coalesce()`'d aggregates, or straight from a `not null` base
column) are typed non-null, exactly matching the original hand-written
file's choices. Skipping this step would have meant threading
null-checks through a dozen unrelated files for a distinction the real
data never actually exhibits.

**Consequences:** the migration applied cleanly on the first push, and
the fresh regeneration confirmed the hand-written Batch 1/2 types had
been an exact match all along (only the two documented, deliberate
deviation categories differ). Running the full E2E suite afterward
surfaced one genuine pre-existing test bug, unrelated to this migration:
`scheduler-flow.spec.ts` asserted on a page-wide `getByText(/^0 \/
\d+$/)`, which throws a strict-mode violation whenever a remaining-qty ÷
scheduled-days split happens to give _every_ scheduled day the identical
target number (increasingly likely the longer a test's date-relative
schedule runs, since which calendar days fall on weekends shifts the
day count run to run). Fixed by adding a `data-testid` to each day's
container in `WeekView` and scoping the assertion to today's specific
day — a latent, date-sensitive fragility that had simply not been
triggered by the specific dates in play on earlier runs.

## ADR-025: Packing-slip AI extraction — plain `fetch()` to the Anthropic Messages API, tool-use for structured output, code+size folded into `name`

**Decision date:** 2026-07-03

**Context:** Sub-phase F of Batch 2: a server route that reads an
uploaded packing slip (PDF or photo) and extracts material line items —
code, description, size, qty — via the Anthropic API, a review/edit
table before anything is saved, and a confirm step that writes to
`materials`. The real packing slip this needs to handle correctly has
two line items sharing one product code (`36SQ10`, two beam lengths)
and a line that must be excluded (freight), which shaped several of the
choices below.

**Choice — plain `fetch()` to `api.anthropic.com/v1/messages`, no
`@anthropic-ai/sdk` dependency:** `app/api/packing-slips/extract/route.ts`
is the only caller in the app; adding a whole SDK for one call site's
worth of usage is more dependency surface than the feature needs. The
route reads `ANTHROPIC_API_KEY` from `process.env` (server-only Route
Handler, never a browser bundle) and returns a clean `500` with an
explanatory message if it isn't configured, rather than crashing — the
key genuinely doesn't exist in any environment yet (a real human-only
credential, requested once from the user rather than worked around).

**Choice — tool-use (forced `tool_choice`), not free-text parsing, for
the extraction shape:** the model is given one tool (`record_materials`,
an array of `{code, description, size, qty}`) and
`tool_choice: {type: "tool", name: "record_materials"}` forces it to
call that tool rather than reply conversationally. This is the
reliable-structured-output mechanism the Anthropic API offers — parsing
free text back into a line-item shape would be strictly worse for a
feature whose whole point is turning unstructured slip content into
structured rows.

**Choice — branch on the uploaded file's actual content-type between an
`image` and a `document` content block:** `PackingSlipUpload`'s
`<input type="file">` has no `accept` restriction (a packing slip could
be a scanned PDF or a phone photo), and Anthropic's two content-block
types aren't interchangeable — a PDF must be sent as `document` with
`media_type: "application/pdf"`, an image as `image` with its own real
media type. The route reads the signed URL's response `content-type`
header and picks the block type accordingly, rather than assuming every
upload is a PDF.

**Choice — code + description + size are folded into one `name` string
at save time, not new `materials` columns:** `materials` has no
dedicated code/size column (`name`, `unit`, `total_needed`, `received`
only), and adding one for this feature alone would ripple into the
grid, reconciliation view, and every other materials query for a
benefit only this one entry path uses. `confirmExtractedMaterials`
(`lib/projects/actions.ts`) composes `name` as
`[code, description, size].filter(Boolean).join(" ")` — e.g.
`"36SQ10 Beam 144\""` and `"36SQ10 Beam 96\""` — which is also what
keeps the real slip's two same-code, different-size beam lines
distinguishable as two separate materials rather than colliding into
one. Mirrors `pasteMaterialList`'s existing shape exactly otherwise (qty
→ both `total_needed` and `received`; an optional "replace the current
list" delete-first).

**Choice — the review table is mandatory, not a "trust it" auto-save:**
extraction always lands in an editable table
(`PackingSlipExtractDialog`) — fix a misread code/description/size/qty,
remove a non-material line the model missed (the prompt explicitly
instructs it to skip freight/permits/discounts/taxes, but a human review
step is the actual safety net, not the prompt wording), or add a line it
missed — before "Add N materials" writes anything. Nothing from the AI
call reaches the database un-reviewed.

**Consequences:** the feature is fully built and passes
lint/typecheck/build, but cannot be live-validated against the real
packing slip (42"x24' upright, two 36SQ10 beam sizes, 42"x46" wire deck,
spacers/barriers/protectors/two anchor types) until the user provides
`ANTHROPIC_API_KEY` — tracked as the batch's one remaining NEEDS-YOU
item. `e2e/packing-slip-extract-flow.spec.ts` is written to run either
way: with no key configured it asserts the route's graceful-error path
(always runs, no live API needed); with a key configured it renders a
small synthetic packing-slip image in-memory (two share-a-code-
different-size beam lines + a freight line to skip) and asserts against
the real Anthropic response — the first test in this suite that
conditionally exercises a live third-party API rather than only the
app's own Supabase backend.

---

## ADR-024: Multi-page drawings — first upload auto-marks, RowStage gains a readOnly mode

**Decision date:** 2026-07-03

**Context:** Sub-phase E of Batch 2: browse every uploaded page, exactly
one is the designated marking page (owner/pm chooses), non-marking pages
are viewable (zoom/pan/fullscreen) but not markable. The schema
(`drawings.role`, `projects.mark_drawing_id`, the partial unique index,
`set_marking_drawing()`) was laid down in sub-phase 0 (ADR-019); this is
the UI enforcing it.

**Choice — a project's first upload becomes its marking page
automatically:** the spec's "owner/pm chooses" describes how to _change_
the marking page, not a mandatory extra step for the common case (most
projects have one page). Without this, a brand-new project couldn't mark
any rows until someone explicitly designated a page first — pure friction
for the typical single-page project. `recordDrawingUpload`
(`lib/projects/actions.ts`) checks `projects.mark_drawing_id` after
inserting; if it's still null (this is the project's very first
drawing), it calls the new `setMarkingDrawing` action immediately.
Second and later uploads default to `'reference'` (the column's own
default) and need an explicit "Set as marking page" click.

**Choice — `RowStage` gets a `readOnly` boolean prop, not a second
component:** a non-marking page needs the _exact_ same zoom/pan/
fullscreen/phase-coloring behavior as the marking page — only
draw/move/resize/select/keyboard-shortcuts differ. Forking a whole
second stage component (the way `MaterialsReferenceStage` exists
separately, for a genuinely different read-only _display_ need) would
duplicate all of that shared behavior for a difference that's really
just "don't start these specific interactions." `readOnly` short-circuits
`handleStagePointerDown`'s draw/marquee branch (pan still works — that's
a view control, not a mark), `handleRowPointerDown` (select/move), and
`handleKeyDown` (nudge/delete); resize handles are additionally gated
`isSingleSelected && !readOnly` for defense in depth, even though
selection can't happen at all when `readOnly` is true so they'd never
render anyway. The "Auto rows" button is disabled with an explanatory
`title` on a non-marking page too — otherwise arming grid-mode and then
dragging would silently do nothing (the drag never starts once
`readOnly` blocks it), which reads as a bug rather than a boundary.

**Consequences:** found a real, unrelated bug while building this:
`recordDrawingUpload`'s insert used
`.insert(...).select("id").order("page_index", ...)` to find the
first-inserted page — chaining `.order()` after an insert-returning
`.select()` throws `column drawings.page_index does not exist`
(PostgREST resolves the ORDER against the statement's own
RETURNING/insert-values context, not the underlying table, even though
the column plainly exists there). Sorting the returned rows in JS instead
(`.select("id, page_index")` then a plain array `.sort()`) avoids the
issue entirely. Caught by the E2E suite — every test that uploads a
drawing failed the same way, a good reminder that a single shared code
path change can have a blast radius wider than the one feature it was
written for.

**Decision date:** 2026-07-03

**Context:** Sub-phase D of Batch 2: render each phase's rows in its color
on the drawing, a legend with a show/hide toggle, and filtering the
Materials and Progress tabs by phase. Phase creation/assignment
(`phases` table, `rows.phase_id`, `PhasePicker`) already existed from
the Layout-tab rework (ADR-020); this sub-phase is the rest of it.

**Choice — phase color is the row's border color, set via inline
`style`, not a Tailwind class or a fill:** phase colors are arbitrary
hex values chosen at creation time (`PhasePicker`'s swatch picker), so
they can't be Tailwind utility classes (no `border-[#f2c00e]`-per-phase
class exists ahead of time) — an inline `style={{borderColor: ...}}`
is the direct way to apply a dynamic color. Border, not a background
fill: the row's existing fill-bar (`RowFillMarker`, progress % as a
bottom-up/left-right fill) already uses the background for install
progress — overlaying a second meaning on the same visual channel would
make both illegible. Applied identically in `RowStage` (editable,
Layout tab) and `MaterialsReferenceStage` (read-only, Materials tab) so
a row's phase color looks the same in both places, matching how
`RowFillMarker` itself is already shared between them.

**Choice — hiding a phase removes its rows from the render entirely,
not just visually dims them:** `RowStage` filters
`rows.filter(row => !row.phaseId || !hiddenPhaseIds.has(row.phaseId))`
before mapping, rather than rendering hidden rows with reduced opacity.
A hidden row shouldn't be selectable, draggable, or resizable — it's
supposed to be _out of the way_ while working on other phases, not just
less visible; not rendering it at all is simpler than rendering it and
then disabling every interaction path individually.

**Choice — phase filtering on Materials/Progress computes from data
already fetched, no new queries:** the Materials tab's phase filter
narrows `rowProgress` (already fetched) to the selected phase's rows
before building both the reference-stage rows and the grid columns, and
sums `rowMaterials`' `required_qty` (already fetched) for those rows
into a compact "assigned to this phase" summary — not a full
reconciliation card (that would need per-row installed data this page
doesn't currently fetch). The Progress tab's phase filter recomputes row
count / rows complete / pct client-side from `row_progress` (already
fetched), the same shape `project_progress` aggregates — no new view or
query needed for either.

**Consequences:** the Materials and Progress tabs each have their own
`<select id="...phase-filter">` labeled "Filter by phase" — same label
text on two different pages is fine for a human (each is unambiguous in
its own page's context), but it was a real trap for
`e2e/phases-flow.spec.ts`: a `getByLabel("Filter by phase")` fired
before the Progress tab's client-side navigation had actually finished
resolved to the _Materials_ tab's still-present select (Next.js keeps
the outgoing page mounted until the incoming one's data is ready, to
avoid a blank flash), so the test silently filtered the wrong page's
dropdown. Fixed by waiting for a Progress-tab-specific element
(`"Overall complete"`) before touching its filter — a general lesson,
not specific to this feature, that's worth remembering for any future
page-to-page navigation in a test suite that reuses label text.

## ADR-022: Scheduler — remaining-qty targets, project-wide (not per-crew), replace-not-merge schedule/targets

**Decision date:** 2026-07-03

**Context:** Sub-phase C of Batch 2: crew CRUD, assigning crews to a
project/rows/phases, a date-range schedule, daily targets auto-suggested
from remaining material ÷ remaining days, actual-vs-target with an SPI
badge, and a week view. `crews`/`crew_members`/`assignments`/`targets`/
`crew_rates` have existed in the schema since Batch 1 (created ahead of
time — see `schema_core.sql`'s own comment, "created now so
installs/targets can reference crews cleanly from day one"); this is the
first UI/logic built against them.

**Choice — "remaining" for target math is `assigned − installed`, not
`material_reconciliation.left_qty`:** `left_qty` is
`needed − assigned` — procurement's "still needs to be ordered or
allocated to a row," a different number from "how much of what's already
assigned to a row still needs to physically go in." Scheduler targets are
about the latter. `lib/scheduler/queries.ts`'s `listRemainingByMaterial`
computes `assigned − installed` directly from `material_reconciliation`'s
own `assigned`/`installed` columns rather than reusing `left_qty`, which
would silently understate (or overstate, if under-assigned) how much work
is actually left to install.

**Choice — targets are project-wide, not split per crew:** `targets.crew_id`
is nullable and `generateTargets` (`lib/scheduler/actions.ts`) always
writes `crew_id: null`. A day can have more than one crew assigned; the
spec asks for "daily targets auto-suggested from remaining material ÷
remaining days" with no mention of splitting that across whichever crews
happen to be scheduled that day, and doing so would need a rule for
how to split (evenly? by crew size? by cost?) that isn't specified.
Actual-vs-target and the SPI badge are likewise computed project-wide per
day, not per crew.

**Choice — both `setProjectSchedule` and `generateTargets` replace rather
than merge:** rebuilding the schedule deletes all of a project's
`project_schedule` rows and re-inserts the new set (a date is either
scheduled or it isn't — nothing else to preserve across a rebuild).
`generateTargets` deletes-and-regenerates only `crew_id is null` rows
from today forward (past-dated and any manually-set per-crew targets are
left alone), so re-running it after progress changes gives a clean
recompute instead of layering stale suggestions on top of fresh ones.

**Choice — "assign to project/rows/phases" is assignment _granularity_,
not a `phase_id` column:** `assignments` has `row_id` (nullable) but no
`phase_id`. `AssignCrewForm` offers three scopes — whole project
(`row_id: null`), specific rows (multi-select), or a phase (resolved
client-side to that phase's current row ids and inserted as one
`assignments` row per row) — reading the spec's "rows/phases" as scope
options in the UI, not a schema requirement. A phase assignment is a
snapshot of that phase's membership at assignment time; it doesn't stay
live if rows are reassigned to a different phase afterward, consistent
with `assignments` otherwise having no phase awareness at all.

**Choice — `targets` and `day_logs`-style upserts use the same hand-rolled
find-or-update-or-insert pattern (ADR-021), not `ON CONFLICT`:** `targets`
has no unique constraint at all (unlike `day_logs`), so `upsertTarget`
finds an existing row by `(project_id, work_date, material_id, crew_id)`
— crew-nullable-aware, same reasoning as `day_logs` — before deciding
insert vs. update.

**Consequences:** Crew rate tracking (`crew_rates.units_per_hour`) isn't
built — the schema anticipates it as a _derived_ metric (actual
installed ÷ actual hours from `day_logs`/`installs`), which is a
non-trivial aggregation pipeline of its own and isn't named as a Sub-phase
C requirement; targets are generated from remaining-qty ÷ remaining-days
only, not adjusted by a crew's historical rate. `SchedulerWorkspace`'s SPI
badge (green ≥1.0, amber ≥0.8, red below) and `WeekView`'s per-day status
(Exceeded ≥110% of target, Hit ≥100%, Close ≥70%, Miss below) are
reasonable defaults, not numbers from the spec — a candidate for a
config/settings surface later if a real project's cadence wants different
thresholds.

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
the row's box:** the 8 handles are centered _on_ the row's border by
design (a corner handle's center is the row's actual corner), extending a
few pixels past the row's own edges in every direction. They render as
children of the row's box, which has `overflow-hidden` + `rounded` so the
fill-bar/label don't visually spill past the row's rounded corners. That
same clipping was cutting the outer half of every handle — and for corner
handles specifically, the clip boundary ran right through the handle's
own geometric center, since the center _is_ the row's edge. A test
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
place, only clipping its _children_ did). This is a real interaction bug,
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
(`createPhase`, `listPhases`) — the Phases _sub-phase_ (colors on the
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
