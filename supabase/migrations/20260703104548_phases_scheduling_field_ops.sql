-- Sub-phase 0: schema for Field/Crew daily closeout, Scheduler, Phases,
-- and multi-page drawings. One combined migration, idempotent
-- (if not exists / add column if not exists throughout) so it's safe to
-- re-run, e.g. if pasted into the SQL editor more than once.

-- MATERIALS: size + labor units (labor_units feeds Scheduler productivity/
-- target math in a later sub-phase) --------------------------------------
alter table materials add column if not exists size text;
alter table materials add column if not exists labor_units numeric not null default 1
  check (labor_units > 0);

-- INSTALLS: offline-safe dedupe. idempotency_key is unique but nullable —
-- older/manually-created rows have none, only the field app's offline
-- queue needs it, and Postgres treats multiple NULLs in a unique column as
-- distinct so this doesn't constrain rows that don't set one. Append-only
-- event model is unchanged: no update/delete policy changes here.
alter table installs add column if not exists idempotency_key text unique;
alter table installs add column if not exists device_id text;

-- PHASES ---------------------------------------------------------------
create table if not exists phases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null,
  color text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table rows add column if not exists phase_id uuid references phases (id) on delete set null;

-- BLOCKERS ---------------------------------------------------------------
create table if not exists blockers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  row_id uuid references rows (id) on delete set null,
  crew_id uuid references crews (id) on delete set null,
  code text not null check (code in (
    'MISSING_MATERIAL', 'WRONG_MATERIAL', 'CUSTOMER_DELAY', 'AREA_BLOCKED',
    'FLOOR_ISSUE', 'DRAWING_ISSUE', 'CREW_SHORT', 'EQUIPMENT_ISSUE',
    'WEATHER_TRUCK', 'OTHER'
  )),
  note text,
  photo_path text,
  work_date date not null default current_date,
  resolved_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- DAY LOGS ---------------------------------------------------------------
-- One row per crew/project/day, filled in progressively (arrived, then
-- offload/install times, then departed) and "closed" at day's end — not
-- append-only like installs, so crew can UPDATE their own entry (RLS
-- below) while the day is still open.
create table if not exists day_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  crew_id uuid references crews (id) on delete set null,
  work_date date not null default current_date,
  arrived_at timestamptz,
  offload_start timestamptz,
  offload_end timestamptz,
  install_start timestamptz,
  install_end timestamptz,
  departed_at timestamptz,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, crew_id, work_date)
);

-- SCHEDULING ---------------------------------------------------------------
alter table projects add column if not exists planned_days int;

-- Presence of a row = a scheduled working day; lets a date range be picked
-- and specific days skipped without a separate "skip" flag to track.
create table if not exists project_schedule (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  work_date date not null,
  created_at timestamptz not null default now(),
  unique (project_id, work_date)
);

-- MULTI-PAGE DRAWINGS: exactly one marking page per project ---------------
alter table drawings add column if not exists role text not null default 'reference'
  check (role in ('reference', 'marking'));

alter table projects add column if not exists mark_drawing_id uuid references drawings (id) on delete set null;

-- Belt-and-suspenders: a partial unique index makes "at most one marking
-- drawing per project" a DB-level guarantee, not just an application one.
create unique index if not exists drawings_one_marking_per_project
  on drawings (project_id) where role = 'marking';

-- Atomic re-designation: two UPDATEs plus the projects pointer in one
-- statement's worth of transaction, so a partial failure can never leave
-- two drawings both marked 'marking' or the pointer out of sync. Runs as
-- SECURITY INVOKER (not DEFINER) — it should only succeed when the CALLING
-- user's own RLS permits these updates (owner/pm, via the existing
-- drawings_write / projects_update policies), not bypass them.
create or replace function public.set_marking_drawing(p_project_id uuid, p_drawing_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  update drawings set role = 'reference' where project_id = p_project_id;
  update drawings set role = 'marking' where id = p_drawing_id and project_id = p_project_id;
  update projects set mark_drawing_id = p_drawing_id where id = p_project_id;
end;
$$;

grant execute on function public.set_marking_drawing(uuid, uuid) to authenticated;

-- Backfill existing projects: pick the drawing with the most existing rows
-- as a best-guess "the page they were already marking" (ties broken by
-- page_index, preferring the first page). Safe default even if a project
-- genuinely had rows on multiple pages before this constraint existed —
-- existing rows keep working everywhere else (progress/materials are
-- project-scoped, not marking-page-scoped); this only restricts where NEW
-- rows can be drawn going forward, which sub-phase E's UI enforces.
with row_counts as (
  select drawing_id, count(*) as row_count
  from rows
  group by drawing_id
),
ranked as (
  select
    d.id as drawing_id,
    d.project_id,
    row_number() over (
      partition by d.project_id
      order by coalesce(rc.row_count, 0) desc, d.page_index asc
    ) as rn
  from drawings d
  left join row_counts rc on rc.drawing_id = d.id
)
update projects p
set mark_drawing_id = ranked.drawing_id
from ranked
where ranked.project_id = p.id
  and ranked.rn = 1
  and p.mark_drawing_id is null;

update drawings d
set role = 'marking'
from projects p
where p.mark_drawing_id = d.id
  and d.role <> 'marking';

-- STORAGE: daily-photos bucket ---------------------------------------------
-- Org-scoped like drawings/packing-slips; path convention
-- "{project_id}/{date}/{crew_id}/{filename}" — org scoping still derives
-- from the first path segment, same as the other two buckets.
insert into storage.buckets (id, name, public)
values ('daily-photos', 'daily-photos', false)
on conflict (id) do nothing;

create policy daily_photos_objects_select on storage.objects for select
  using (
    bucket_id = 'daily-photos'
    and org_id_of_project((storage.foldername(name))[1]::uuid) = current_org_id()
  );

-- Crew may upload (that's the whole point of the field app); edit/remove
-- stays owner/pm, matching drawings/packing-slips.
create policy daily_photos_objects_insert on storage.objects for insert
  with check (
    bucket_id = 'daily-photos'
    and org_id_of_project((storage.foldername(name))[1]::uuid) = current_org_id()
  );

create policy daily_photos_objects_update on storage.objects for update
  using (
    bucket_id = 'daily-photos'
    and org_id_of_project((storage.foldername(name))[1]::uuid) = current_org_id()
    and current_user_role() in ('owner', 'pm')
  )
  with check (
    bucket_id = 'daily-photos'
    and org_id_of_project((storage.foldername(name))[1]::uuid) = current_org_id()
    and current_user_role() in ('owner', 'pm')
  );

create policy daily_photos_objects_delete on storage.objects for delete
  using (
    bucket_id = 'daily-photos'
    and org_id_of_project((storage.foldername(name))[1]::uuid) = current_org_id()
    and current_user_role() in ('owner', 'pm')
  );

-- RLS: phases, blockers, day_logs, project_schedule ------------------------
alter table phases enable row level security;
alter table blockers enable row level security;
alter table day_logs enable row level security;
alter table project_schedule enable row level security;

-- PHASES: owner/pm/scheduler manage; everyone in the org reads.
create policy phases_select on phases for select
  using (org_id_of_project(project_id) = current_org_id());

create policy phases_write on phases for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'));

-- BLOCKERS: crew may report (insert); resolving/editing/deleting is
-- owner/pm, matching the installs correction pattern.
create policy blockers_select on blockers for select
  using (org_id_of_project(project_id) = current_org_id());

create policy blockers_insert on blockers for insert
  with check (org_id_of_project(project_id) = current_org_id());

create policy blockers_update on blockers for update
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy blockers_delete on blockers for delete
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

-- DAY LOGS: crew may insert and update their OWN entry (filling in times
-- progressively through the day); owner/pm can edit/delete any.
create policy day_logs_select on day_logs for select
  using (org_id_of_project(project_id) = current_org_id());

create policy day_logs_insert on day_logs for insert
  with check (org_id_of_project(project_id) = current_org_id());

create policy day_logs_update on day_logs for update
  using (
    org_id_of_project(project_id) = current_org_id()
    and (created_by = auth.uid() or current_user_role() in ('owner', 'pm'))
  )
  with check (
    org_id_of_project(project_id) = current_org_id()
    and (created_by = auth.uid() or current_user_role() in ('owner', 'pm'))
  );

create policy day_logs_delete on day_logs for delete
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

-- PROJECT SCHEDULE: owner/pm/scheduler manage; everyone in the org reads.
create policy project_schedule_select on project_schedule for select
  using (org_id_of_project(project_id) = current_org_id());

create policy project_schedule_write on project_schedule for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'));

-- GRANTS: same reasoning as the Phase 2 migration — RLS decides which rows,
-- the grant lets the role attempt the operation at all.
grant select, insert, update, delete on phases, blockers, day_logs, project_schedule to authenticated;

-- VIEWS: expose phase_id on row_progress so the Layout/Progress tabs can
-- color/filter/group by phase without an extra join.
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
  -- Appended, not inserted alongside the other rows.* columns above:
  -- CREATE OR REPLACE VIEW only allows adding new columns at the END of
  -- the list — Postgres compares old/new columns positionally, so
  -- inserting phase_id earlier reads as "renaming" every column after it.
  r.phase_id
from rows r
left join agg on agg.row_id = r.id;

grant select on row_progress to authenticated;
