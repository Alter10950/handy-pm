-- Batch 4, Sub-phase B: PM-of-record accountability. projects.pm_user_id
-- already exists (Sub-phase 0) and stays nullable at the schema level —
-- ADR-037's own deliberate choice, since existing projects have none and
-- Sub-phase J's backfill is where that gets resolved. "Required" from
-- here on is an application-level rule (the New Project form) for real,
-- active projects specifically — an estimate/draft project can still be
-- created without one, since nothing is being executed yet.

create table if not exists project_pm_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  previous_pm_user_id uuid references auth.users (id) on delete set null,
  new_pm_user_id uuid references auth.users (id) on delete set null,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists project_pm_history_project_id_idx
  on project_pm_history (project_id);

alter table project_pm_history enable row level security;

-- Office-only (owner/pm), matching every other accountability/audit
-- table in this batch (handoff_surveys, change_orders, project_comms) —
-- append-only from the application's own perspective (no update/delete
-- policy; reassignProjectPm only ever inserts a new row).
create policy project_pm_history_select on project_pm_history for select
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy project_pm_history_insert on project_pm_history for insert
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

-- Expose pm_user_id through project_progress so project cards/the
-- dashboard can show "who owns this" without a second per-project query.
-- Appended at the END of the SELECT/GROUP BY lists — CREATE OR REPLACE
-- VIEW compares columns positionally, so a new column must go last (the
-- exact bug ADR-019 already found and fixed once for this same view's
-- sibling, row_progress).
create or replace view project_progress
with (security_invoker = true) as
select
  p.id as project_id,
  p.org_id,
  p.name,
  p.site_address,
  p.status,
  p.deadline,
  p.created_at,
  count(distinct rw.id) as row_count,
  count(distinct rw.id) filter (where rp.is_complete) as rows_complete,
  count(distinct rw.id) filter (where not rp.has_materials) as rows_missing_materials,
  coalesce(sum(rp.required_total), 0) as required_total,
  coalesce(sum(rp.installed_total), 0) as installed_total,
  case
    when coalesce(sum(rp.required_total), 0) > 0
      then round(sum(rp.installed_total)::numeric / sum(rp.required_total), 4)
    else 0
  end as pct,
  p.pm_user_id
from projects p
left join rows rw on rw.project_id = p.id
left join row_progress rp on rp.row_id = rw.id
group by p.id, p.org_id, p.name, p.site_address, p.status, p.deadline, p.created_at, p.pm_user_id;
