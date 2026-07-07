-- Batch 4, Sub-phase G: two-crew capacity board (see docs/DECISIONS.md
-- ADR-044). organizations.num_crews (Sub-phase 0, default 2) becomes a
-- HARD constraint on committing schedule dates; this table is the audit
-- log for the accountable escape hatch — an owner overriding the block
-- (borrowed crew, overtime weekend) with a required reason, surfaced on
-- the dashboard alongside overridden gates.

create table if not exists capacity_overrides (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  reason text not null,
  -- The dates that were over capacity at override time, as entered —
  -- a snapshot for the audit trail, not a live constraint.
  conflict_dates date[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists capacity_overrides_project_id_idx
  on capacity_overrides (project_id);

alter table capacity_overrides enable row level security;

-- Office-visible; writing one is owner-only, matching "Owner override
-- with reason" — stricter than the scheduler roles that hit the block.
create policy capacity_overrides_select on capacity_overrides for select
  using (org_id_of_project(project_id) = current_org_id()
    and current_user_role() in ('owner', 'pm', 'scheduler'));

create policy capacity_overrides_write on capacity_overrides for insert
  with check (org_id_of_project(project_id) = current_org_id()
    and current_user_role() = 'owner');

grant select, insert on capacity_overrides to authenticated;
