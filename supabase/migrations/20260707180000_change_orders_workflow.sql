-- Batch 4, Sub-phase F: change-order workflow (see docs/DECISIONS.md
-- ADR-043). Sub-phase 0 created the change_orders table itself; this
-- adds what the actual workflow needs:
--
-- 1. change_order_items — a CO's own draft lines (scope work and/or
--    materials). Draft lines deliberately do NOT live in scope_items/
--    materials until the CO is approved: every existing consumer
--    (estimator, scheduler, field, reconciliation) would otherwise need
--    a CO-status join to avoid counting unapproved work. On approval the
--    lines are copied into the real tables; the draft rows remain as the
--    CO's permanent record of exactly what it added.
--
-- 2. change_orders gains an approval token (minted when sent to the
--    customer, single-purpose, nulled once decided) + send bookkeeping.
--
-- 3. materials gains change_order_id so merged CO materials stay
--    traceable to the CO that added them.
--
-- 4. projects gains the ORIGINAL estimate snapshot — "the project keeps
--    BOTH numbers — original estimate vs current approved estimate."
--    Original is written once (at estimate→active conversion, or lazily
--    at first CO approval for projects created directly active); current
--    approved is always computed live as original + Σ approved COs, so
--    there's no second column to drift.
--
-- 5. project_comms.kind gains 'change_order' — sending a CO for
--    approval is a customer communication and belongs in the audit log.

create table if not exists change_order_items (
  id uuid primary key default gen_random_uuid(),
  change_order_id uuid not null references change_orders (id) on delete cascade,
  kind text not null check (kind in ('scope', 'material')),
  -- scope lines use work_type (+ description/qty/unit/labor_units);
  -- material lines use description as the material name (no work_type).
  work_type text check (work_type in (
    'install', 'teardown', 'remove_levels', 'add_levels', 'relocate', 'repair', 'other'
  )),
  description text not null,
  qty numeric,
  unit text,
  labor_units numeric,
  created_at timestamptz not null default now()
);
create index if not exists change_order_items_change_order_id_idx
  on change_order_items (change_order_id);

create or replace function org_id_of_change_order(co_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select p.org_id from change_orders co
  join projects p on p.id = co.project_id
  where co.id = co_id;
$$;

alter table change_order_items enable row level security;

-- Office-only both ways, matching change_orders' own RLS exactly.
create policy change_order_items_select on change_order_items for select
  using (org_id_of_change_order(change_order_id) = current_org_id()
    and current_user_role() in ('owner', 'pm'));

create policy change_order_items_write on change_order_items for all
  using (org_id_of_change_order(change_order_id) = current_org_id()
    and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_change_order(change_order_id) = current_org_id()
    and current_user_role() in ('owner', 'pm'));

grant select, insert, update, delete on change_order_items to authenticated;

alter table change_orders
  add column if not exists approval_token text unique,
  add column if not exists sent_at timestamptz,
  add column if not exists sent_to text;

alter table materials
  add column if not exists change_order_id uuid references change_orders (id) on delete set null;

alter table projects
  add column if not exists original_estimate_labor_units numeric,
  add column if not exists original_estimate_days numeric,
  add column if not exists original_estimate_saved_at timestamptz;

alter table project_comms drop constraint if exists project_comms_kind_check;
alter table project_comms add constraint project_comms_kind_check
  check (kind in ('milestone', 'weekly_report', 'manual', 'schedule_change', 'change_order'));
