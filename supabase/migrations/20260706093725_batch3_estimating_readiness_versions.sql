-- Batch 3, sub-phase 0: schema for richer material identity + receiving
-- lifecycle, row readiness, drawing versioning, the estimation brain
-- (labor standards + project estimates), and in-app notifications. One
-- combined migration, idempotent throughout, per this batch's brief.
--
-- materials.size and materials.labor_units already exist (Batch 2 sub-phase
-- 0) — labor_units was added specifically "feeds Scheduler productivity/
-- target math in a later sub-phase," which is now. crew_rates
-- (crew_id, task_key, units_per_hour, samples) and projects.planned_days
-- also already exist and need no schema change, only new application logic.

-- MATERIALS: richer identity ------------------------------------------------
alter table materials add column if not exists profile text;
alter table materials add column if not exists capacity text;
alter table materials add column if not exists condition text not null default 'new'
  check (condition in ('new', 'used'));
alter table materials add column if not exists compatible_system text;

-- MATERIAL RECEIPTS: append-only receiving log ------------------------------
-- Event log, not a single mutable status+qty pair — a shipment commonly
-- arrives in batches (backorders, split deliveries), and each status is its
-- own fact about how much of a material has reached that stage ("80
-- received in total" and "75 verified in total" are both true at once, not
-- mutually exclusive buckets that must sum to the ordered total). The
-- existing `materials.received` stays the fast-read aggregate the
-- reconciliation view already depends on; the receiving check-in action
-- (sub-phase F) keeps it in sync when a 'received' event is logged, the
-- same "log feeds an aggregate column" relationship installs has with
-- material_reconciliation.
create table if not exists material_receipts (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials (id) on delete cascade,
  status text not null check (status in (
    'ordered', 'received', 'verified', 'staged', 'short', 'damaged', 'wrong'
  )),
  qty int not null check (qty > 0),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists material_receipts_material_id_idx
  on material_receipts (material_id);

-- HELPER: org_id_of_material, mirrors org_id_of_row exactly (same reasoning
-- — material_receipts hangs off material_id, not project_id directly).
create or replace function public.org_id_of_material(p_material_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.org_id from materials m join projects p on p.id = m.project_id
  where m.id = p_material_id;
$$;

-- ROWS: readiness inputs -----------------------------------------------------
-- crew_assigned is deliberately NOT a stored column ("(derived)" in the
-- spec) — computed in row_progress below from `assignments`, since whether
-- a crew covers a row is inherently a query over scheduling data, not a
-- fact to hand-maintain on the row itself.
alter table rows add column if not exists materials_ready boolean not null default false;
alter table rows add column if not exists area_accessible boolean not null default false;
alter table rows add column if not exists drawing_approved boolean not null default false;

-- DRAWING VERSIONS: history + approval-for-install, one page's uploads ------
-- `drawings` stays the CURRENT pointer per page (unchanged — rows.drawing_id
-- keeps referencing it, so existing FKs never break); drawing_versions is
-- the parallel history log. Re-uploading a page inserts a new version row,
-- marks the prior latest version for that page superseded, and updates the
-- existing `drawings` row's storage_path/width/height in place (same id).
create table if not exists drawing_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  page_index int not null,
  storage_path text not null,
  version int not null,
  approved_for_install boolean not null default false,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, page_index, version)
);
create index if not exists drawing_versions_project_id_idx
  on drawing_versions (project_id);

-- Backfill: every existing drawing becomes its own version 1, approved
-- (it's already in active use) — so the versioning UI (sub-phase G) starts
-- from a coherent history instead of every current project showing "no
-- version history at all."
insert into drawing_versions
  (project_id, page_index, storage_path, version, approved_for_install, created_at)
select d.project_id, d.page_index, d.storage_path, 1, true, d.created_at
from drawings d
where not exists (
  select 1 from drawing_versions dv
  where dv.project_id = d.project_id and dv.page_index = d.page_index
);

-- LABOR STANDARDS: size-normalized productivity baseline --------------------
-- base_labor_units is hours-per-unit at a baseline/standard pace for that
-- task (e.g. one linear ft of beam, one ft of upright height, one deck
-- piece, one anchor each); crew_rates.units_per_hour (existing) then scales
-- per-crew relative to how many of THOSE units a crew actually installs per
-- hour. Org-scoped (not global) so a company can tune its own standards.
create table if not exists labor_standards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  task_key text not null,
  base_labor_units numeric not null check (base_labor_units > 0),
  unit_basis text not null,
  created_at timestamptz not null default now(),
  unique (org_id, task_key)
);
create index if not exists labor_standards_org_id_idx on labor_standards (org_id);

-- Seed sensible defaults for every existing org. These are reasonable
-- starting estimates for a racking install crew, not measured figures —
-- same "reasonable default, not a spec'd number" posture as ADR-022's SPI
-- thresholds. Editable later; nothing in the estimation engine hardcodes
-- these values, only these task_keys as the recognized conversion buckets.
insert into labor_standards (org_id, task_key, base_labor_units, unit_basis)
select o.id, s.task_key, s.base_labor_units, s.unit_basis
from organizations o
cross join (values
  ('upright', 0.20::numeric, 'per_ft_height'),
  ('beam', 0.05::numeric, 'per_linear_ft'),
  ('wire_deck', 0.15::numeric, 'per_piece'),
  ('anchor', 0.08::numeric, 'per_each'),
  ('row_spacer', 0.05::numeric, 'per_each'),
  ('end_barrier', 0.30::numeric, 'per_each'),
  ('post_protector', 0.15::numeric, 'per_each'),
  ('general', 0.10::numeric, 'per_each')
) as s(task_key, base_labor_units, unit_basis)
on conflict (org_id, task_key) do nothing;

-- PROJECT ESTIMATES: append-only, like installs ------------------------------
-- Recomputing an estimate inserts a new row rather than overwriting the
-- last one, so how an estimate evolved over a project's life is never
-- lost. The latest row (by created_at) is "the current estimate."
create table if not exists project_estimates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  estimated_labor_units numeric not null,
  estimated_hours numeric not null,
  estimated_days numeric not null,
  forecast_finish date,
  confidence text,
  assumptions jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists project_estimates_project_id_created_at_idx
  on project_estimates (project_id, created_at desc);

-- NOTIFICATIONS: per-user in-app inbox ---------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_id_read_at_idx
  on notifications (user_id, read_at);

-- RLS -------------------------------------------------------------------
alter table material_receipts enable row level security;
alter table drawing_versions enable row level security;
alter table labor_standards enable row level security;
alter table project_estimates enable row level security;
alter table notifications enable row level security;

-- MATERIAL_RECEIPTS: same shape as materials itself (crew reads, never
-- writes — receiving/reconciliation stays an office task).
create policy material_receipts_select on material_receipts for select
  using (org_id_of_material(material_id) = current_org_id());

create policy material_receipts_write on material_receipts for all
  using (org_id_of_material(material_id) = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_material(material_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

-- DRAWING_VERSIONS: matches drawings_write exactly.
create policy drawing_versions_select on drawing_versions for select
  using (org_id_of_project(project_id) = current_org_id());

create policy drawing_versions_write on drawing_versions for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

-- LABOR_STANDARDS: org-scoped directly (no project indirection); same
-- owner/pm/scheduler write set as crew_rates/targets (estimating-adjacent).
create policy labor_standards_select on labor_standards for select
  using (org_id = current_org_id());

create policy labor_standards_write on labor_standards for all
  using (org_id = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'))
  with check (org_id = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'));

-- PROJECT_ESTIMATES: everyone in org reads; owner/pm/scheduler write.
create policy project_estimates_select on project_estimates for select
  using (org_id_of_project(project_id) = current_org_id());

create policy project_estimates_write on project_estimates for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'));

-- NOTIFICATIONS: strictly own-row reads (a personal inbox, not an org-wide
-- feed) — insert is org-scoped-only since a Server Action running as the
-- calling user creates notifications addressed to OTHER org members (e.g.
-- notifying a PM about a blocker), so it can't also require user_id =
-- auth.uid() the way select/update/delete do.
create policy notifications_select on notifications for select
  using (user_id = auth.uid());

create policy notifications_insert on notifications for insert
  with check (org_id = current_org_id());

create policy notifications_update on notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notifications_delete on notifications for delete
  using (user_id = auth.uid());

grant select, insert, update, delete on
  material_receipts, drawing_versions, labor_standards, project_estimates, notifications
  to authenticated;

-- VIEWS: row_progress gains readiness columns + a computed status -----------
-- Appended at the very end of the SELECT list, after the existing
-- r.created_at — CREATE OR REPLACE VIEW only allows adding columns there
-- (Postgres compares old/new columns positionally), per ADR-019/ADR-020's
-- own lesson, learned twice already.
create or replace view row_progress
with (security_invoker = true) as
with req as (
  select row_id, material_id, required_qty
  from row_materials
  where required_qty > 0
),
installed_raw as (
  select row_id, material_id, sum(qty) as installed_qty
  from installs
  group by row_id, material_id
),
capped as (
  select
    req.row_id,
    req.material_id,
    req.required_qty,
    least(coalesce(installed_raw.installed_qty, 0), req.required_qty) as installed_capped
  from req
  left join installed_raw
    on installed_raw.row_id = req.row_id
    and installed_raw.material_id = req.material_id
),
agg as (
  select
    row_id,
    sum(required_qty) as required_total,
    sum(installed_capped) as installed_total,
    bool_and(installed_capped >= required_qty) as all_materials_met,
    count(*) as material_count
  from capped
  group by row_id
),
-- Rows currently covered by an upcoming/current-or-future assignment,
-- either directly (assignments.row_id = this row) or via a whole-project
-- assignment (assignments.row_id is null). Phase-scoped assignments are
-- already inserted as individual per-row rows at assignment time (see
-- ADR-022), so both assignment shapes reduce to this one check.
crew_assignment as (
  select r2.id as row_id
  from rows r2
  where exists (
    select 1 from assignments a
    where a.work_date >= current_date
      and a.project_id = r2.project_id
      and (a.row_id = r2.id or a.row_id is null)
  )
)
select
  r.id as row_id,
  r.project_id,
  r.drawing_id,
  r.label,
  r.x,
  r.y,
  r.w,
  r.h,
  coalesce(agg.required_total, 0) as required_total,
  coalesce(agg.installed_total, 0) as installed_total,
  case
    when coalesce(agg.required_total, 0) > 0
      then round(agg.installed_total::numeric / agg.required_total, 4)
    else 0
  end as pct,
  coalesce(agg.material_count, 0) > 0 as has_materials,
  coalesce(agg.all_materials_met, false)
    and coalesce(agg.material_count, 0) > 0 as is_complete,
  r.phase_id,
  r.created_at,
  r.materials_ready,
  r.area_accessible,
  r.drawing_approved,
  (ca.row_id is not null) as crew_assigned,
  case
    -- Already installed: readiness inputs no longer matter.
    when coalesce(agg.all_materials_met, false) and coalesce(agg.material_count, 0) > 0
      then 'complete'
    -- Can't physically do any work at all yet.
    when not r.materials_ready or not r.area_accessible
      then 'blocked'
    -- Every prerequisite is in place.
    when r.materials_ready and r.area_accessible and r.drawing_approved and ca.row_id is not null
      then 'ready'
    -- Physical prerequisites met, but not every administrative one is.
    else 'partial'
  end as readiness_status
from rows r
left join agg on agg.row_id = r.id
left join crew_assignment ca on ca.row_id = r.id;

grant select on row_progress to authenticated;
