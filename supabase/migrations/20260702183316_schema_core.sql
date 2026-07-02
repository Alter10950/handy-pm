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
