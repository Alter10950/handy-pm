-- Phase 13: per-SKU material & labor model (ADR-049, ADR-051).
--
-- The estimate engine treated material size text as feet at a per-linear-
-- foot rate and lumped every SKU in a category under one number (a 144"
-- stepbeam booked 7.20 h). The corrected model is per-SKU:
--
--   learned crew×SKU rate  →  per-SKU standard  →  category default
--   (crew_sku_rates)          (sku_labor_standards)  (labor_standards, fixed
--                                                     to per-piece semantics)
--
-- Everything here is additive and idempotent. materials keeps its
-- existing columns (name/size/task_key/labor_units) untouched — sku_id is
-- a nullable pointer, backfilled by scripts/backfill-skus.mjs (the parser
-- is TypeScript; SQL only carries structure). No data is dropped.

-- ── 1. SKU catalog ─────────────────────────────────────────────────────
-- One row per distinct physical SKU an org installs. Dimensions are typed
-- INCHES columns (numeric) — parsing free text happens once, at backfill/
-- import time, never at calculation time. size_text keeps the raw string
-- losslessly. needs_review flags rows the parser couldn't fully read so
-- the office can correct them from the UI (Phase 13 wiring).
create table if not exists material_skus (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  category text not null default 'other' check (
    category in (
      'upright', 'beam', 'wire_deck', 'row_spacer', 'anchor',
      'end_barrier', 'post_protector', 'footplate', 'shim',
      'accessory', 'other'
    )
  ),
  size_text text,
  height_in numeric check (height_in is null or height_in > 0),
  depth_in numeric check (depth_in is null or depth_in > 0),
  length_in numeric check (length_in is null or length_in > 0),
  width_in numeric check (width_in is null or width_in > 0),
  weight_lbs numeric check (weight_lbs is null or weight_lbs > 0),
  requires_lift boolean not null default false,
  needs_review boolean not null default false,
  created_at timestamptz not null default now()
);

-- Dedupe key: an org's SKU is its (name, size) pair. NULLS NOT DISTINCT so
-- two size-less "Shim Pack" rows collapse to one SKU (PG15+).
create unique index if not exists material_skus_org_name_size_key
  on material_skus (org_id, name, size_text) nulls not distinct;
create index if not exists material_skus_org_id_idx on material_skus (org_id);

-- ── 2. materials → SKU pointer ─────────────────────────────────────────
alter table materials
  add column if not exists sku_id uuid references material_skus (id) on delete set null;
create index if not exists materials_sku_id_idx on materials (sku_id);

-- ── 3. Per-SKU standards (middle tier) ─────────────────────────────────
-- An explicit, org-tuned hours-per-unit for one SKU. Used as-is (no
-- category modifiers on top — the number already embodies the SKU).
create table if not exists sku_labor_standards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  sku_id uuid not null references material_skus (id) on delete cascade,
  hours_per_unit numeric not null check (hours_per_unit > 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, sku_id)
);
create index if not exists sku_labor_standards_org_idx on sku_labor_standards (org_id);

-- ── 4. Learned crew×SKU rates (top tier) ───────────────────────────────
-- Written by the productivity flywheel (Phase 15 recompute; structure
-- lands now so the engine's resolution order is complete from day one).
-- hours_per_unit is the learned actual; samples gates trust (engine
-- requires ≥3 before this tier outranks the standards).
create table if not exists crew_sku_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  crew_id uuid not null references crews (id) on delete cascade,
  sku_id uuid not null references material_skus (id) on delete cascade,
  hours_per_unit numeric not null check (hours_per_unit > 0),
  samples int not null default 0 check (samples >= 0),
  updated_at timestamptz not null default now(),
  unique (crew_id, sku_id)
);
create index if not exists crew_sku_rates_org_idx on crew_sku_rates (org_id);
create index if not exists crew_sku_rates_sku_idx on crew_sku_rates (sku_id);

-- ── 5. Fix the category-default tier's broken seeds ────────────────────
-- labor_standards remains the fallback tier, but its install categories
-- move to per-PIECE semantics (the engine's category modifiers handle
-- size). ONLY rows still holding the exact known-buggy seeded values are
-- updated — a value an org has hand-tuned is left alone. The old
-- 'per_linear_ft' beam standard (0.05 × raw inches = the 7.2 h bug) and
-- 'per_ft_height' upright standard are the two poisoned rows.
update labor_standards
set base_labor_units = 0.08, unit_basis = 'per_each'
where task_key = 'beam' and unit_basis = 'per_linear_ft' and base_labor_units = 0.05;

update labor_standards
set base_labor_units = 0.25, unit_basis = 'per_each'
where task_key = 'upright' and unit_basis = 'per_ft_height' and base_labor_units = 0.20;

-- Normalize the remaining still-at-seed rows to the engine's canonical
-- per-piece figures (lib/estimating/engine.ts CATEGORY_DEFAULT_HOURS) so
-- code and DB agree. Guarded to the exact original seed values.
update labor_standards
set base_labor_units = 0.03, unit_basis = 'per_each'
where task_key = 'wire_deck' and unit_basis = 'per_piece' and base_labor_units = 0.15;

update labor_standards
set base_labor_units = 0.05
where task_key = 'anchor' and unit_basis = 'per_each' and base_labor_units = 0.08;

-- New install categories the SKU parser recognizes but the original seed
-- didn't cover. Same idempotent posture as the original seed.
insert into labor_standards (org_id, task_key, base_labor_units, unit_basis)
select o.id, s.task_key, s.base_labor_units, s.unit_basis
from organizations o
cross join (values
  ('footplate', 0.05::numeric, 'per_each'),
  ('shim', 0.02::numeric, 'per_each'),
  ('accessory', 0.05::numeric, 'per_each'),
  ('other', 0.10::numeric, 'per_each')
) as s(task_key, base_labor_units, unit_basis)
on conflict (org_id, task_key) do nothing;

-- ── 6. RLS ──────────────────────────────────────────────────────────────
-- Same org-membership model and helper functions as every other
-- org-scoped table (see 20260702183323_rls_policies.sql). Write access
-- matches labor_standards (owner/pm/scheduler — the office).
alter table material_skus enable row level security;
alter table sku_labor_standards enable row level security;
alter table crew_sku_rates enable row level security;

drop policy if exists material_skus_select on material_skus;
create policy material_skus_select on material_skus for select
  using (org_id = current_org_id());

drop policy if exists material_skus_write on material_skus;
create policy material_skus_write on material_skus for all
  using (org_id = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'))
  with check (org_id = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'));

drop policy if exists sku_labor_standards_select on sku_labor_standards;
create policy sku_labor_standards_select on sku_labor_standards for select
  using (org_id = current_org_id());

drop policy if exists sku_labor_standards_write on sku_labor_standards;
create policy sku_labor_standards_write on sku_labor_standards for all
  using (org_id = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'))
  with check (org_id = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'));

drop policy if exists crew_sku_rates_select on crew_sku_rates;
create policy crew_sku_rates_select on crew_sku_rates for select
  using (org_id = current_org_id());

drop policy if exists crew_sku_rates_write on crew_sku_rates;
create policy crew_sku_rates_write on crew_sku_rates for all
  using (org_id = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'))
  with check (org_id = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'));
