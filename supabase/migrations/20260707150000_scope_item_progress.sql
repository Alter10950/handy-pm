-- Batch 4, Sub-phase C: the field app's own crew-progress mechanism for
-- scope_items, anticipated but deliberately deferred by Sub-phase 0's own
-- comment ("Sub-phase C adds the field app's own crew-progress mechanism
-- later — not a reason to widen this write policy now").
--
-- Modeled as an append-only event log (scope_item_updates), NOT mutable
-- status columns directly on scope_items — same convention as
-- installs/material_receipts/day_logs elsewhere in this schema. This
-- sidesteps a real RLS problem a mutable-column design would have
-- created: crew needs to report progress but must NOT be able to touch
-- scope_items' own work_type/description/qty/labor_units (owner/pm-only,
-- scope_items_write), and Postgres RLS can't restrict individual
-- columns within one UPDATE policy without a trigger. An INSERT-only
-- log table needs no such trigger — crew supplies an entirely new row,
-- never touches an existing one, exactly like blockers_insert (org-scoped
-- only, no role restriction) already does.
create table if not exists scope_item_updates (
  id uuid primary key default gen_random_uuid(),
  scope_item_id uuid not null references scope_items (id) on delete cascade,
  status text not null check (status in ('partial', 'done')),
  note text,
  photo_path text,
  logged_by uuid references auth.users (id) on delete set null,
  logged_at timestamptz not null default now()
);
create index if not exists scope_item_updates_scope_item_id_idx
  on scope_item_updates (scope_item_id);

create or replace function public.org_id_of_scope_item(p_scope_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.org_id from scope_items si join projects p on p.id = si.project_id
  where si.id = p_scope_item_id;
$$;

alter table scope_item_updates enable row level security;

create policy scope_item_updates_select on scope_item_updates for select
  using (org_id_of_scope_item(scope_item_id) = current_org_id());

create policy scope_item_updates_insert on scope_item_updates for insert
  with check (org_id_of_scope_item(scope_item_id) = current_org_id());

grant select, insert on scope_item_updates to authenticated;

-- SCOPE_ITEM_PROGRESS: one row per scope item with its latest logged
-- status (or null status = never logged, i.e. not started) — mirrors
-- row_progress/project_progress's own "event-sourced child table,
-- summarized by a view" convention exactly.
create or replace view scope_item_progress
with (security_invoker = true) as
select
  si.id as scope_item_id,
  si.project_id,
  si.work_type,
  si.description,
  si.qty,
  si.unit,
  si.labor_units,
  si.row_id,
  si.phase_id,
  si.source,
  si.change_order_id,
  si.created_at,
  latest.status,
  latest.note,
  latest.photo_path,
  latest.logged_by,
  latest.logged_at
from scope_items si
left join lateral (
  select u.status, u.note, u.photo_path, u.logged_by, u.logged_at
  from scope_item_updates u
  where u.scope_item_id = si.id
  order by u.logged_at desc
  limit 1
) latest on true;
