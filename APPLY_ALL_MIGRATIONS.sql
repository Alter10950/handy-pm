-- Handy PM — all migrations combined, in order. Paste into Supabase → SQL Editor → Run.
-- (fixed: renamed reserved-word function current_role -> current_user_role)

-- ===== 20260702183316_schema_core.sql =====
-- Phase 2: core schema.
-- gen_random_uuid() is built into Postgres 13+ (no extension needed).
-- gen_random_bytes(), used for share_tokens, still requires pgcrypto.
create extension if not exists pgcrypto with schema extensions;

-- ORGANIZATIONS ---------------------------------------------------------
-- Every other table is scoped to an org, directly or via project_id/crew_id.
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- PROFILES ---------------------------------------------------------------
-- One row per auth.users, created by the handle_new_user trigger
-- (see 20260702183319_auth_bootstrap.sql).
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid references organizations (id) on delete set null,
  full_name text,
  role text not null default 'crew'
    check (role in ('owner', 'pm', 'scheduler', 'crew')),
  created_at timestamptz not null default now()
);

-- PROJECTS -----------------------------------------------------------------
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  site_address text,
  status text not null default 'active'
    check (status in ('active', 'on_hold', 'complete')),
  deadline date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- CREWS ----------------------------------------------------------------
create table if not exists crews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  size int not null default 1,
  cost_per_hour numeric,
  created_at timestamptz not null default now()
);

create table if not exists crew_members (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references crews (id) on delete cascade,
  name text not null
);

-- DRAWINGS ---------------------------------------------------------------
-- One row per rendered page (a multi-page PDF becomes one drawing row
-- per page, page_index 0-based). storage_path points into the private
-- "drawings" bucket.
create table if not exists drawings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  page_index int not null default 0,
  storage_path text not null,
  width int,
  height int,
  created_at timestamptz not null default now()
);

-- PACKING SLIPS ------------------------------------------------------------
create table if not exists packing_slips (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  storage_path text not null,
  uploaded_at timestamptz not null default now(),
  parsed jsonb
);

-- MATERIALS ----------------------------------------------------------------
create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null,
  unit text not null default 'ea',
  total_needed int not null default 0 check (total_needed >= 0),
  received int not null default 0 check (received >= 0),
  created_at timestamptz not null default now()
);

-- ROWS -----------------------------------------------------------------
-- A marked rack section on a drawing page. x/y/w/h are normalized 0..1
-- fractions of the drawing's rendered width/height, so marks stay correct
-- regardless of what size the drawing is displayed at.
create table if not exists rows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  drawing_id uuid not null references drawings (id) on delete cascade,
  label text not null,
  x real not null,
  y real not null,
  w real not null,
  h real not null,
  created_at timestamptz not null default now()
);

create table if not exists row_materials (
  id uuid primary key default gen_random_uuid(),
  row_id uuid not null references rows (id) on delete cascade,
  material_id uuid not null references materials (id) on delete cascade,
  required_qty int not null default 0 check (required_qty >= 0),
  created_at timestamptz not null default now(),
  unique (row_id, material_id)
);

-- INSTALLS -----------------------------------------------------------------
-- A logged install event (qty of a material installed into a row on a
-- date). row_progress/material_reconciliation views sum these. qty may be
-- negative — a correction entry (e.g. "-5, mis-counted") rather than a
-- deleted/edited row, keeping the log append-only and auditable.
create table if not exists installs (
  id uuid primary key default gen_random_uuid(),
  row_id uuid not null references rows (id) on delete cascade,
  material_id uuid not null references materials (id) on delete cascade,
  qty int not null check (qty <> 0),
  installed_on date not null default current_date,
  crew_id uuid references crews (id) on delete set null,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- SCHEDULING (Phase 7 consumes these; created now so installs/targets can
-- reference crews cleanly from day one) --------------------------------
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  crew_id uuid references crews (id) on delete set null,
  row_id uuid references rows (id) on delete set null,
  work_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists targets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  crew_id uuid references crews (id) on delete set null,
  work_date date not null,
  material_id uuid references materials (id) on delete set null,
  target_qty int not null default 0 check (target_qty >= 0)
);

create table if not exists crew_rates (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references crews (id) on delete cascade,
  task_key text not null,
  units_per_hour numeric,
  samples int not null default 0,
  unique (crew_id, task_key)
);

-- SHARE TOKENS (Phase 8 customer portal) ------------------------------
create table if not exists share_tokens (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  token text unique not null default encode(extensions.gen_random_bytes(16), 'hex'),
  scope text not null default 'customer',
  expires_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- INDEXES --------------------------------------------------------------
create index if not exists profiles_org_id_idx on profiles (org_id);
create index if not exists projects_org_id_idx on projects (org_id);
create index if not exists crews_org_id_idx on crews (org_id);
create index if not exists crew_members_crew_id_idx on crew_members (crew_id);
create index if not exists drawings_project_id_idx on drawings (project_id);
create index if not exists packing_slips_project_id_idx on packing_slips (project_id);
create index if not exists materials_project_id_idx on materials (project_id);
create index if not exists rows_project_id_idx on rows (project_id);
create index if not exists rows_drawing_id_idx on rows (drawing_id);
create index if not exists row_materials_row_id_idx on row_materials (row_id);
create index if not exists row_materials_material_id_idx on row_materials (material_id);
create index if not exists installs_row_id_material_id_installed_on_idx
  on installs (row_id, material_id, installed_on);
create index if not exists assignments_project_id_idx on assignments (project_id);
create index if not exists targets_project_id_idx on targets (project_id);
create index if not exists crew_rates_crew_id_idx on crew_rates (crew_id);
create index if not exists share_tokens_project_id_idx on share_tokens (project_id);
create index if not exists share_tokens_token_idx on share_tokens (token);


-- ===== 20260702183319_auth_bootstrap.sql =====
-- Phase 2: auth bootstrap.
-- Every new Supabase Auth user gets a profiles row automatically. The very
-- first user in the whole system becomes the 'owner' of a freshly created
-- organization. Every subsequent signup gets role='crew' and org_id=null —
-- an owner/pm must manually assign them into an org afterward (there is no
-- self-serve org invite flow yet). This keeps bootstrap dead simple for a
-- single-tenant-per-deployment tool without inventing an invite system this
-- phase doesn't need.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
begin
  select id into v_org_id from organizations limit 1;

  if v_org_id is null then
    insert into organizations (name) values ('New Organization')
      returning id into v_org_id;
    v_role := 'owner';
  else
    v_org_id := null;
    v_role := 'crew';
  end if;

  insert into public.profiles (id, org_id, role)
  values (new.id, v_org_id, v_role);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- One-off, NOT run by this migration: after your first sign-in creates
-- the org above, rename it. Run once in the Supabase SQL editor:
--
--   update organizations set name = 'Handy Equip';
-- ---------------------------------------------------------------------


-- ===== 20260702183323_rls_policies.sql =====
-- Phase 2: Row Level Security.
--
-- Role model (see ADR in docs/DECISIONS.md): 'owner' / 'pm' / 'scheduler'
-- get full CRUD within their org on everything except organizations itself.
-- 'crew' gets read access to their org's data and may INSERT installs (log
-- field work), but cannot create/edit/delete projects, materials, rows, or
-- anything else — matching the Phase 2 spec exactly. Finer-grained
-- distinctions between owner/pm/scheduler are deferred until a later phase
-- gives them concretely different UI.

-- HELPERS -----------------------------------------------------------------
-- security definer so these can't recurse into the RLS they help evaluate,
-- and so a user can always resolve their own org/role even though the
-- profiles policies below are themselves org-scoped.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from profiles where id = auth.uid();
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function public.org_id_of_project(p_project_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from projects where id = p_project_id;
$$;

create or replace function public.org_id_of_crew(p_crew_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from crews where id = p_crew_id;
$$;

create or replace function public.org_id_of_row(p_row_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.org_id from rows r join projects p on p.id = r.project_id
  where r.id = p_row_id;
$$;

-- ENABLE RLS ---------------------------------------------------------------
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table projects enable row level security;
alter table crews enable row level security;
alter table crew_members enable row level security;
alter table drawings enable row level security;
alter table packing_slips enable row level security;
alter table materials enable row level security;
alter table rows enable row level security;
alter table row_materials enable row level security;
alter table installs enable row level security;
alter table assignments enable row level security;
alter table targets enable row level security;
alter table crew_rates enable row level security;
alter table share_tokens enable row level security;

-- ORGANIZATIONS: read-only for members, no client writes ------------------
create policy organizations_select on organizations for select
  using (id = current_org_id());

-- PROFILES ------------------------------------------------------------
create policy profiles_select on profiles for select
  using (org_id = current_org_id() or id = auth.uid());

create policy profiles_update on profiles for update
  using (org_id = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id = current_org_id() and current_user_role() in ('owner', 'pm'));

-- PROJECTS -----------------------------------------------------------------
create policy projects_select on projects for select
  using (org_id = current_org_id());

create policy projects_insert on projects for insert
  with check (org_id = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy projects_update on projects for update
  using (org_id = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy projects_delete on projects for delete
  using (org_id = current_org_id() and current_user_role() in ('owner', 'pm'));

-- CREWS ----------------------------------------------------------------
create policy crews_select on crews for select
  using (org_id = current_org_id());

create policy crews_write on crews for all
  using (org_id = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'))
  with check (org_id = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'));

create policy crew_members_select on crew_members for select
  using (org_id_of_crew(crew_id) = current_org_id());

create policy crew_members_write on crew_members for all
  using (org_id_of_crew(crew_id) = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'))
  with check (org_id_of_crew(crew_id) = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'));

-- DRAWINGS / PACKING SLIPS ------------------------------------------------
create policy drawings_select on drawings for select
  using (org_id_of_project(project_id) = current_org_id());

create policy drawings_write on drawings for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy packing_slips_select on packing_slips for select
  using (org_id_of_project(project_id) = current_org_id());

create policy packing_slips_write on packing_slips for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

-- MATERIALS ----------------------------------------------------------------
-- crew may read but never write (spec: "not UPDATE materials").
create policy materials_select on materials for select
  using (org_id_of_project(project_id) = current_org_id());

create policy materials_write on materials for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

-- ROWS -----------------------------------------------------------------
-- crew may read but never write (spec: "not DELETE projects/rows").
create policy rows_select on rows for select
  using (org_id_of_project(project_id) = current_org_id());

create policy rows_write on rows for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy row_materials_select on row_materials for select
  using (org_id_of_row(row_id) = current_org_id());

create policy row_materials_write on row_materials for all
  using (org_id_of_row(row_id) = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_row(row_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

-- INSTALLS -------------------------------------------------------------
-- The one place crew gets a write: logging field work (spec: "may ...
-- INSERT installs"). Correcting/removing a logged entry stays admin-only.
create policy installs_select on installs for select
  using (org_id_of_row(row_id) = current_org_id());

create policy installs_insert on installs for insert
  with check (org_id_of_row(row_id) = current_org_id());

create policy installs_update on installs for update
  using (org_id_of_row(row_id) = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_row(row_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy installs_delete on installs for delete
  using (org_id_of_row(row_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

-- SCHEDULING (assignments/targets/crew_rates) — owner/pm/scheduler write --
create policy assignments_select on assignments for select
  using (org_id_of_project(project_id) = current_org_id());

create policy assignments_write on assignments for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'));

create policy targets_select on targets for select
  using (org_id_of_project(project_id) = current_org_id());

create policy targets_write on targets for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'));

create policy crew_rates_select on crew_rates for select
  using (org_id_of_crew(crew_id) = current_org_id());

create policy crew_rates_write on crew_rates for all
  using (org_id_of_crew(crew_id) = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'))
  with check (org_id_of_crew(crew_id) = current_org_id() and current_user_role() in ('owner', 'pm', 'scheduler'));

-- SHARE TOKENS ---------------------------------------------------------
-- Deliberately NOT publicly readable — the customer portal (Phase 8) reads
-- these through a server route using the service_role client, never
-- directly from the browser, so an anon RLS policy is never needed here.
create policy share_tokens_select on share_tokens for select
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy share_tokens_write on share_tokens for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

-- GRANTS -----------------------------------------------------------------
-- RLS policies decide WHICH rows are visible/writable; the role still needs
-- a base GRANT to attempt the operation at all. Newer Supabase projects no
-- longer auto-expose new tables to the API roles (see supabase/config.toml
-- `auto_expose_new_tables` note), so these are explicit rather than
-- relying on legacy default-privilege behavior. anon gets nothing — every
-- table here requires a signed-in profile; the customer portal (Phase 8)
-- reads through a server route on the service_role client instead.
grant select, insert, update, delete on
  organizations, profiles, projects, crews, crew_members, drawings,
  packing_slips, materials, rows, row_materials, installs, assignments,
  targets, crew_rates, share_tokens
  to authenticated;


-- ===== 20260702183327_storage_buckets.sql =====
-- Phase 2: storage buckets for drawings and packing slips.
-- Both private (public = false); the app reads objects via short-lived
-- signed URLs generated server-side, never public bucket URLs. Path
-- convention: "{project_id}/{filename}", so org scoping can be derived
-- from the first path segment without a separate lookup table.
insert into storage.buckets (id, name, public)
values ('drawings', 'drawings', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('packing-slips', 'packing-slips', false)
on conflict (id) do nothing;

-- DRAWINGS bucket ------------------------------------------------------
-- Read is open to every org role (crew view drawings in the field);
-- writes are owner/pm only, matching the `drawings` table policy.
create policy drawings_objects_select on storage.objects for select
  using (
    bucket_id = 'drawings'
    and org_id_of_project((storage.foldername(name))[1]::uuid) = current_org_id()
  );

create policy drawings_objects_insert on storage.objects for insert
  with check (
    bucket_id = 'drawings'
    and org_id_of_project((storage.foldername(name))[1]::uuid) = current_org_id()
    and current_user_role() in ('owner', 'pm')
  );

create policy drawings_objects_update on storage.objects for update
  using (
    bucket_id = 'drawings'
    and org_id_of_project((storage.foldername(name))[1]::uuid) = current_org_id()
    and current_user_role() in ('owner', 'pm')
  )
  with check (
    bucket_id = 'drawings'
    and org_id_of_project((storage.foldername(name))[1]::uuid) = current_org_id()
    and current_user_role() in ('owner', 'pm')
  );

create policy drawings_objects_delete on storage.objects for delete
  using (
    bucket_id = 'drawings'
    and org_id_of_project((storage.foldername(name))[1]::uuid) = current_org_id()
    and current_user_role() in ('owner', 'pm')
  );

-- PACKING-SLIPS bucket ---------------------------------------------------
create policy packing_slips_objects_select on storage.objects for select
  using (
    bucket_id = 'packing-slips'
    and org_id_of_project((storage.foldername(name))[1]::uuid) = current_org_id()
  );

create policy packing_slips_objects_insert on storage.objects for insert
  with check (
    bucket_id = 'packing-slips'
    and org_id_of_project((storage.foldername(name))[1]::uuid) = current_org_id()
    and current_user_role() in ('owner', 'pm')
  );

create policy packing_slips_objects_update on storage.objects for update
  using (
    bucket_id = 'packing-slips'
    and org_id_of_project((storage.foldername(name))[1]::uuid) = current_org_id()
    and current_user_role() in ('owner', 'pm')
  )
  with check (
    bucket_id = 'packing-slips'
    and org_id_of_project((storage.foldername(name))[1]::uuid) = current_org_id()
    and current_user_role() in ('owner', 'pm')
  );

create policy packing_slips_objects_delete on storage.objects for delete
  using (
    bucket_id = 'packing-slips'
    and org_id_of_project((storage.foldername(name))[1]::uuid) = current_org_id()
    and current_user_role() in ('owner', 'pm')
  );


-- ===== 20260702183330_views.sql =====
-- Phase 2: progress/reconciliation views.
--
-- security_invoker = true (Postgres 15+) makes these views enforce RLS as
-- the QUERYING user rather than the view owner. Without it, a view created
-- by an elevated migration role can silently bypass the RLS policies on its
-- underlying tables for every caller — the views would leak cross-org data.
--
-- "Installed capped at required" (matching the reference marking-tool
-- prototype's zonePct/zoneComplete logic): a row/material can't show over
-- 100% just because more was logged than was actually required.

-- ROW_PROGRESS: one row per `rows` record --------------------------------
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
    and coalesce(agg.material_count, 0) > 0 as is_complete
from rows r
left join agg on agg.row_id = r.id;

-- PROJECT_PROGRESS: one row per project -----------------------------------
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
  end as pct
from projects p
left join rows rw on rw.project_id = p.id
left join row_progress rp on rp.row_id = rw.id
group by p.id, p.org_id, p.name, p.site_address, p.status, p.deadline, p.created_at;

-- MATERIAL_RECONCILIATION: one row per material ---------------------------
create or replace view material_reconciliation
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
    req.material_id,
    req.required_qty,
    least(coalesce(installed_raw.installed_qty, 0), req.required_qty) as installed_capped
  from req
  left join installed_raw
    on installed_raw.row_id = req.row_id
    and installed_raw.material_id = req.material_id
),
per_material as (
  select
    material_id,
    sum(required_qty) as assigned,
    sum(installed_capped) as installed
  from capped
  group by material_id
)
select
  m.id as material_id,
  m.project_id,
  m.name,
  m.unit,
  m.total_needed as needed,
  m.received,
  coalesce(pm.assigned, 0) as assigned,
  coalesce(pm.installed, 0) as installed,
  -- "left" is a reserved word in SQL (LEFT JOIN); named left_qty instead.
  m.total_needed - coalesce(pm.assigned, 0) as left_qty,
  greatest(0, m.total_needed - m.received) as to_order
from materials m
left join per_material pm on pm.material_id = m.id;

grant select on row_progress, project_progress, material_reconciliation to authenticated;

