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
