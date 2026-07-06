-- Batch 3, sub-phase H: customer portal (/portal/[token]).
--
-- share_tokens (project_id, token, scope, expires_at) already exists in
-- full from Phase 2 (schema_core.sql) — provisioned ahead of time, with
-- RLS already scoped owner/pm-only and a migration comment already
-- anticipating "the customer portal reads this via service_role." The one
-- gap: no way to explicitly revoke a link before its natural expiry — only
-- expires_at existed, and "revoke" needs to be a distinguishable office
-- action, not just "set expires_at to now" (which would make an office
-- user's own "why did this stop working" audit indistinguishable from
-- natural expiry).
alter table share_tokens add column if not exists revoked_at timestamptz;

-- APPROVED_PHOTOS: the customer-visible photo curation list -----------------
-- Neither existing photo-bearing table can carry a per-photo approval flag
-- cleanly: day_logs.photo_paths is a plain text[] (no per-photo row to hang
-- a boolean off without normalizing crew uploads themselves), and
-- blockers.photo_path documents a PROBLEM, not something to default-expose.
-- A dedicated table, keyed by the photo's own storage_path (already
-- effectively unique per upload), lets an office user curate photos from
-- either source into one customer-facing list without touching either
-- source table's own shape.
create table if not exists approved_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  storage_path text not null,
  source text not null check (source in ('day_log', 'blocker')),
  caption text,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz not null default now(),
  unique (project_id, storage_path)
);
create index if not exists approved_photos_project_id_idx
  on approved_photos (project_id);

alter table approved_photos enable row level security;

-- Office-only both ways — the portal itself reads through service_role
-- (bypasses RLS entirely, same as every other portal query), so this
-- table never needs an anon-facing policy.
create policy approved_photos_select on approved_photos for select
  using (org_id_of_project(project_id) = current_org_id());

create policy approved_photos_write on approved_photos for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

grant select, insert, update, delete on approved_photos to authenticated;
