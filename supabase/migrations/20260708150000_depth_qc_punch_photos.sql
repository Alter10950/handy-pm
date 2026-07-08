-- Phase 14: product depth I — per-row QC checks, the punch list, and
-- before/after photo phases (ADR-052).
--
-- Additive and idempotent throughout, same posture as
-- 20260708120000_sku_catalog_labor_standards.sql. The app ships with
-- these features guarded: missing relations render an "awaiting
-- migration" state instead of erroring, so applying this file simply
-- lights them up.

-- ── 1. Per-row QC checks ────────────────────────────────────────────────
-- A crew-verifiable checklist per marked row (plumb/level, anchors
-- torqued, shims seated, beam locks in, wire decks seated, labels on).
-- check_key is app-defined vocabulary (lib/qc/shared.ts) — no enum, same
-- "app-enforced, not schema-enforced" stance as labor_standards.task_key.
create table if not exists row_qc_checks (
  id uuid primary key default gen_random_uuid(),
  row_id uuid not null references rows (id) on delete cascade,
  check_key text not null,
  passed boolean not null default false,
  note text,
  checked_by uuid references auth.users (id) on delete set null,
  checked_at timestamptz not null default now(),
  unique (row_id, check_key)
);
create index if not exists row_qc_checks_row_idx on row_qc_checks (row_id);

alter table row_qc_checks enable row level security;

drop policy if exists row_qc_checks_select on row_qc_checks;
create policy row_qc_checks_select on row_qc_checks for select
  using (org_id_of_row(row_id) = current_org_id());

-- Crew logs QC from the field (same trust level as logging installs);
-- office edits/clears too.
drop policy if exists row_qc_checks_write on row_qc_checks;
create policy row_qc_checks_write on row_qc_checks for all
  using (org_id_of_row(row_id) = current_org_id())
  with check (org_id_of_row(row_id) = current_org_id());

-- ── 2. Punch list ───────────────────────────────────────────────────────
-- Deficiencies found at QC/walkthrough that must close before closeout.
-- Row link optional (some items are site-wide). Photo is a storage path
-- in the existing daily-photos bucket.
create table if not exists punch_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  row_id uuid references rows (id) on delete set null,
  title text not null,
  detail text,
  status text not null default 'open' check (status in ('open', 'done')),
  photo_path text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz
);
create index if not exists punch_items_project_idx on punch_items (project_id, status);

alter table punch_items enable row level security;

drop policy if exists punch_items_select on punch_items;
create policy punch_items_select on punch_items for select
  using (org_id_of_project(project_id) = current_org_id());

-- Crew can raise and close punch items from the field; office too.
drop policy if exists punch_items_write on punch_items;
create policy punch_items_write on punch_items for all
  using (org_id_of_project(project_id) = current_org_id())
  with check (org_id_of_project(project_id) = current_org_id());

-- ── 3. Before/during/after photo phases ────────────────────────────────
-- approved_photos is the curated, customer-visible set (portal +
-- closeout) — phase lets those surfaces group shots into a before/after
-- story. Existing rows default to 'during', which is what they were.
-- (Raw day-log shots live in day_logs.photo_paths and stay untagged.)
alter table approved_photos
  add column if not exists phase text not null default 'during';
-- Separate statement so re-runs stay idempotent (ADD CONSTRAINT has no
-- IF NOT EXISTS; drop-then-add is the standard pattern).
alter table approved_photos drop constraint if exists approved_photos_phase_check;
alter table approved_photos add constraint approved_photos_phase_check
  check (phase in ('before', 'during', 'after'));
