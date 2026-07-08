-- Phase 16: append-only audit log (ADR-053).
--
-- One narrow table for "who did what, when, to which entity" across the
-- org — role changes, gate overrides, CO approvals, estimate saves,
-- deletions. Deliberately NOT a change-data-capture system: actions
-- record themselves at the moments that matter (application-level, same
-- as pm_history already does for PM reassignment), because a full
-- trigger-based CDC would capture noise nobody audits and slow every
-- write. Additive + idempotent.

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,          -- e.g. 'role.change', 'gate.override', 'co.approve'
  entity_type text not null,     -- e.g. 'profile', 'project', 'change_order'
  entity_id uuid,
  project_id uuid references projects (id) on delete set null,
  summary text not null,         -- human sentence: "Changed Sam's role to PM"
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_org_created_idx
  on audit_events (org_id, created_at desc);
create index if not exists audit_events_project_idx
  on audit_events (project_id) where project_id is not null;

alter table audit_events enable row level security;

-- Office reads; nobody edits or deletes (append-only — no update/delete
-- policies at all). Inserts come from server actions under the acting
-- user's own session.
drop policy if exists audit_events_select on audit_events;
create policy audit_events_select on audit_events for select
  using (org_id = current_org_id() and current_user_role() in ('owner', 'pm'));

drop policy if exists audit_events_insert on audit_events;
create policy audit_events_insert on audit_events for insert
  with check (org_id = current_org_id());
