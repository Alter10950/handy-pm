-- Batch 4, sub-phase 0: schema for the PM Operating Layer — a stage-gate
-- project lifecycle (handoff -> scope -> schedule -> materials -> mobilize
-- -> execute -> punch -> closeout), scope-of-work beyond install, the
-- sales->ops handoff survey, change orders, customer comms, capacity, and
-- the closeout autopsy. One combined, idempotent migration, per this
-- batch's own brief.
--
-- GATE PHILOSOPHY (applies to every gate this sub-phase introduces): gates
-- BLOCK advancement by default, but owner (and pm/scheduler where the RLS
-- below specifically allows it) can override with a required reason —
-- every override is logged (who/when/why) and is meant to surface as a
-- dashboard exception in a later sub-phase. Enforced here as data
-- (project_stages.status = 'overridden' + overridden_by/override_reason);
-- the actual UI/gate-blocking logic is sub-phase A's job, not this one's.

-- GATE TEMPLATES: a reusable, org-editable 8-stage checklist definition --
create table if not exists gate_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
-- Exactly one default template per org — mirrors the "exactly one marking
-- page per project" partial-unique-index convention (ADR-019).
create unique index if not exists gate_templates_one_default_per_org
  on gate_templates (org_id) where is_default;

create table if not exists gate_template_stages (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references gate_templates (id) on delete cascade,
  stage_key text not null check (stage_key in (
    'handoff', 'scope', 'schedule', 'materials', 'mobilize', 'execute', 'punch', 'closeout'
  )),
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (template_id, stage_key)
);

create table if not exists gate_template_items (
  id uuid primary key default gen_random_uuid(),
  template_stage_id uuid not null references gate_template_stages (id) on delete cascade,
  label text not null,
  description text,
  requires_photo boolean not null default false,
  requires_signoff_role text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- HELPERS: mirror org_id_of_row's join-through-parent style exactly.
create or replace function public.org_id_of_gate_template(p_template_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from gate_templates where id = p_template_id;
$$;

create or replace function public.org_id_of_gate_template_stage(p_stage_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select gt.org_id from gate_template_stages gts
  join gate_templates gt on gt.id = gts.template_id
  where gts.id = p_stage_id;
$$;

-- PROJECTS: PM-of-record, current stage, activity tracking, customer -----
-- contact + comms preferences (comms tables reference these directly).
-- pm_user_id stays nullable at the schema level — "required" (per
-- sub-phase B) is an application-level rule enforced at project creation,
-- not a DB constraint, since existing projects have no PM assigned yet
-- and sub-phase J's backfill is a deliberately separate, judgment-driven
-- step, not something this migration should guess at.
alter table projects add column if not exists pm_user_id uuid references auth.users (id) on delete set null;
alter table projects add column if not exists stage_key text not null default 'handoff'
  check (stage_key in (
    'handoff', 'scope', 'schedule', 'materials', 'mobilize', 'execute', 'punch', 'closeout'
  ));
alter table projects add column if not exists last_activity_at timestamptz not null default now();
alter table projects add column if not exists customer_contact_name text;
alter table projects add column if not exists customer_contact_email text;
alter table projects add column if not exists comms_weekly_report boolean not null default true;
alter table projects add column if not exists comms_milestones boolean not null default true;
create index if not exists projects_pm_user_id_idx on projects (pm_user_id);

-- PROJECT STAGES / GATE ITEMS: copied from the template at project -------
-- creation (sub-phase A) so later per-project edits never mutate the
-- template itself.
create table if not exists project_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  stage_key text not null check (stage_key in (
    'handoff', 'scope', 'schedule', 'materials', 'mobilize', 'execute', 'punch', 'closeout'
  )),
  status text not null default 'locked' check (status in ('locked', 'active', 'complete', 'overridden')),
  completed_at timestamptz,
  overridden_by uuid references auth.users (id) on delete set null,
  override_reason text,
  created_at timestamptz not null default now(),
  unique (project_id, stage_key)
);
create index if not exists project_stages_project_id_idx on project_stages (project_id);

create table if not exists project_gate_items (
  id uuid primary key default gen_random_uuid(),
  project_stage_id uuid not null references project_stages (id) on delete cascade,
  template_item_id uuid references gate_template_items (id) on delete set null,
  label text not null,
  done boolean not null default false,
  done_by uuid references auth.users (id) on delete set null,
  done_at timestamptz,
  photo_path text,
  signoff_user_id uuid references auth.users (id) on delete set null,
  note text,
  due_date date,
  created_at timestamptz not null default now()
);
create index if not exists project_gate_items_project_stage_id_idx on project_gate_items (project_stage_id);

create or replace function public.org_id_of_project_stage(p_stage_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.org_id from project_stages ps join projects p on p.id = ps.project_id
  where ps.id = p_stage_id;
$$;

-- SCOPE OF WORK: everything beyond install — the work that killed iBuy. --
-- change_order_id has no FK yet (change_orders is defined further down in
-- this same file) — added via a separate `alter table` once that table
-- exists, further below.
create table if not exists scope_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  work_type text not null check (work_type in (
    'install', 'teardown', 'remove_levels', 'add_levels', 'relocate', 'repair', 'other'
  )),
  description text not null,
  qty numeric,
  unit text,
  labor_units numeric,
  row_id uuid references rows (id) on delete set null,
  phase_id uuid references phases (id) on delete set null,
  source text not null default 'estimate' check (source in ('handoff', 'estimate', 'change_order')),
  change_order_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists scope_items_project_id_idx on scope_items (project_id);

-- SALES -> OPS HANDOFF: the contract between sales and ops. --------------
-- Photos live in the same private daily-photos bucket day_logs/blockers
-- already use ("existing photo storage pattern," per the sub-phase brief)
-- — an array, same convention as day_logs.photo_paths.
create table if not exists handoff_surveys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  site_visit_date date,
  existing_racking_condition text,
  teardown_required boolean not null default false,
  teardown_notes text,
  constraints jsonb not null default '{}',
  photo_paths text[] not null default '{}',
  estimator_signoff_user_id uuid references auth.users (id) on delete set null,
  estimator_signed_at timestamptz,
  pm_signoff_user_id uuid references auth.users (id) on delete set null,
  pm_signed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id)
);

-- CHANGE ORDERS -----------------------------------------------------------
create table if not exists change_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  number int not null,
  title text not null,
  description text,
  reason text not null check (reason in (
    'scope_missed', 'customer_request', 'site_condition', 'material_issue', 'other'
  )),
  status text not null default 'draft' check (status in (
    'draft', 'pending_customer', 'approved', 'rejected', 'cancelled'
  )),
  labor_units numeric,
  added_days numeric,
  price numeric,
  customer_approved_via text,
  customer_approved_at timestamptz,
  customer_approver_name text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, number)
);
create index if not exists change_orders_project_id_idx on change_orders (project_id);

-- Now that change_orders exists, scope_items' forward reference can become
-- a real FK.
alter table scope_items add constraint scope_items_change_order_id_fkey
  foreign key (change_order_id) references change_orders (id) on delete set null;

-- CUSTOMER COMMUNICATION LOG: an auditable record of everything the -------
-- customer was told — the push channel (the portal, Batch 3, stays pull).
create table if not exists project_comms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  kind text not null check (kind in ('milestone', 'weekly_report', 'manual', 'schedule_change')),
  channel text not null check (channel in ('email', 'portal', 'logged_call', 'logged_other')),
  recipient text,
  subject text,
  body_snapshot text,
  sent_at timestamptz not null default now(),
  sent_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists project_comms_project_id_idx on project_comms (project_id);

-- ORG: capacity is a hard constraint (enforced in a later sub-phase), -----
-- not a warning — num_crews lives alongside the org settings Batch 3
-- already added (default_working_days, etc.).
alter table organizations add column if not exists num_crews int not null default 2;

-- CLOSEOUT AUTOPSY: estimated vs actual, generated at the Closeout stage.
create table if not exists project_autopsies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  estimated_days numeric,
  actual_days numeric,
  estimated_hours numeric,
  actual_labor_hours numeric,
  estimated_labor_units numeric,
  actual_labor_units numeric,
  material_variance jsonb not null default '{}',
  change_order_count int not null default 0,
  change_order_days numeric not null default 0,
  blocker_days numeric not null default 0,
  narrative text,
  created_at timestamptz not null default now(),
  unique (project_id)
);

-- RLS ----------------------------------------------------------------------
-- "crew read-only on stage/scope (they see, they don't manage); pm/owner
-- manage; scheduler read + schedule-stage writes" — per this batch's own
-- brief, verbatim. Every SELECT below is org-wide (no role restriction);
-- only the WRITE policies vary by role, and project_stages/
-- project_gate_items specifically carve out a scheduler exception scoped
-- to the 'schedule' stage only, not every stage.
alter table gate_templates enable row level security;
alter table gate_template_stages enable row level security;
alter table gate_template_items enable row level security;
alter table project_stages enable row level security;
alter table project_gate_items enable row level security;
alter table scope_items enable row level security;
alter table handoff_surveys enable row level security;
alter table change_orders enable row level security;
alter table project_comms enable row level security;
alter table project_autopsies enable row level security;

-- GATE_TEMPLATES / STAGES / ITEMS: office-only read (crews never see a
-- template directly, only their own project's already-copied stages);
-- write is owner-only, matching "Template management (owner)."
create policy gate_templates_select on gate_templates for select
  using (org_id = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy gate_templates_write on gate_templates for all
  using (org_id = current_org_id() and current_user_role() = 'owner')
  with check (org_id = current_org_id() and current_user_role() = 'owner');

create policy gate_template_stages_select on gate_template_stages for select
  using (org_id_of_gate_template(template_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy gate_template_stages_write on gate_template_stages for all
  using (org_id_of_gate_template(template_id) = current_org_id() and current_user_role() = 'owner')
  with check (org_id_of_gate_template(template_id) = current_org_id() and current_user_role() = 'owner');

create policy gate_template_items_select on gate_template_items for select
  using (org_id_of_gate_template_stage(template_stage_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy gate_template_items_write on gate_template_items for all
  using (org_id_of_gate_template_stage(template_stage_id) = current_org_id() and current_user_role() = 'owner')
  with check (org_id_of_gate_template_stage(template_stage_id) = current_org_id() and current_user_role() = 'owner');

-- PROJECT_STAGES: org-wide read; owner/pm write always; scheduler may
-- write only the 'schedule' stage's own row.
create policy project_stages_select on project_stages for select
  using (org_id_of_project(project_id) = current_org_id());

create policy project_stages_write on project_stages for all
  using (
    org_id_of_project(project_id) = current_org_id()
    and (
      current_user_role() in ('owner', 'pm')
      or (current_user_role() = 'scheduler' and stage_key = 'schedule')
    )
  )
  with check (
    org_id_of_project(project_id) = current_org_id()
    and (
      current_user_role() in ('owner', 'pm')
      or (current_user_role() = 'scheduler' and stage_key = 'schedule')
    )
  );

-- PROJECT_GATE_ITEMS: same shape, checked through the parent stage's
-- stage_key since the item itself doesn't carry one.
create policy project_gate_items_select on project_gate_items for select
  using (org_id_of_project_stage(project_stage_id) = current_org_id());

create policy project_gate_items_write on project_gate_items for all
  using (
    org_id_of_project_stage(project_stage_id) = current_org_id()
    and (
      current_user_role() in ('owner', 'pm')
      or (
        current_user_role() = 'scheduler'
        and exists (
          select 1 from project_stages ps
          where ps.id = project_gate_items.project_stage_id and ps.stage_key = 'schedule'
        )
      )
    )
  )
  with check (
    org_id_of_project_stage(project_stage_id) = current_org_id()
    and (
      current_user_role() in ('owner', 'pm')
      or (
        current_user_role() = 'scheduler'
        and exists (
          select 1 from project_stages ps
          where ps.id = project_gate_items.project_stage_id and ps.stage_key = 'schedule'
        )
      )
    )
  );

-- SCOPE_ITEMS: org-wide read (crew sees what's scoped); owner/pm write.
-- Sub-phase C adds the field app's own crew-progress mechanism later —
-- not a reason to widen this write policy now.
create policy scope_items_select on scope_items for select
  using (org_id_of_project(project_id) = current_org_id());

create policy scope_items_write on scope_items for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

-- HANDOFF_SURVEYS / CHANGE_ORDERS / PROJECT_COMMS / PROJECT_AUTOPSIES:
-- office-only both ways (sign-offs, financials, customer comms, and
-- estimate-accuracy review are not crew-facing concerns anywhere else in
-- this codebase either).
create policy handoff_surveys_select on handoff_surveys for select
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy handoff_surveys_write on handoff_surveys for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy change_orders_select on change_orders for select
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy change_orders_write on change_orders for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy project_comms_select on project_comms for select
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy project_comms_write on project_comms for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy project_autopsies_select on project_autopsies for select
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

create policy project_autopsies_write on project_autopsies for all
  using (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (org_id_of_project(project_id) = current_org_id() and current_user_role() in ('owner', 'pm'));

grant select, insert, update, delete on
  gate_templates, gate_template_stages, gate_template_items,
  project_stages, project_gate_items, scope_items, handoff_surveys,
  change_orders, project_comms, project_autopsies
  to authenticated;

-- SEED: one default template per existing org, with the sub-phase A's own
-- required starter checklist (verbatim item lists from this batch's
-- brief) so a new project has something real to copy from day one, and
-- there's nothing to backfill for the template itself later.
do $$
declare
  v_org record;
  v_template_id uuid;
  v_stage_id uuid;
begin
  for v_org in select id from organizations loop
    insert into gate_templates (org_id, name, is_default)
    values (v_org.id, 'Default', true)
    returning id into v_template_id;

    -- HANDOFF
    insert into gate_template_stages (template_id, stage_key, position)
    values (v_template_id, 'handoff', 1) returning id into v_stage_id;
    insert into gate_template_items (template_stage_id, label, requires_photo, requires_signoff_role, position) values
      (v_stage_id, 'Site survey completed with photos', true, null, 1),
      (v_stage_id, 'Existing racking condition recorded', false, null, 2),
      (v_stage_id, 'Teardown scope confirmed (yes/no) and documented', false, null, 3),
      (v_stage_id, 'Site constraints recorded', false, null, 4),
      (v_stage_id, 'Estimator sign-off', false, null, 5),
      (v_stage_id, 'PM sign-off', false, 'pm', 6);

    -- SCOPE
    insert into gate_template_stages (template_id, stage_key, position)
    values (v_template_id, 'scope', 2) returning id into v_stage_id;
    insert into gate_template_items (template_stage_id, label, position) values
      (v_stage_id, 'All work types itemized (teardown/modifications/install)', 1),
      (v_stage_id, 'Drawing approved for install', 2),
      (v_stage_id, 'Materials list loaded from packing slip/BOM', 3),
      (v_stage_id, 'Estimate generated', 4);

    -- SCHEDULE
    insert into gate_template_stages (template_id, stage_key, position)
    values (v_template_id, 'schedule', 3) returning id into v_stage_id;
    insert into gate_template_items (template_stage_id, label, position) values
      (v_stage_id, 'Crew assigned', 1),
      (v_stage_id, 'Dates committed within capacity', 2),
      (v_stage_id, 'Customer notified of schedule', 3);

    -- MATERIALS
    insert into gate_template_stages (template_id, stage_key, position)
    values (v_template_id, 'materials', 4) returning id into v_stage_id;
    insert into gate_template_items (template_stage_id, label, position) values
      (v_stage_id, '100% of BOM received', 1),
      (v_stage_id, 'Received verified against packing slip', 2),
      (v_stage_id, 'Shortages/damage resolved or accepted', 3),
      (v_stage_id, 'Material staged/ready', 4);

    -- MOBILIZE
    insert into gate_template_stages (template_id, stage_key, position)
    values (v_template_id, 'mobilize', 5) returning id into v_stage_id;
    insert into gate_template_items (template_stage_id, label, position) values
      (v_stage_id, 'Morning packet ready', 1),
      (v_stage_id, 'Crew briefed', 2),
      (v_stage_id, 'Customer notified of start', 3);

    -- EXECUTE (auto-checked from daily closeouts — see sub-phase A)
    insert into gate_template_stages (template_id, stage_key, position)
    values (v_template_id, 'execute', 6) returning id into v_stage_id;
    insert into gate_template_items (template_stage_id, label, description, position) values
      (v_stage_id, 'All rows complete', 'Auto-checked from daily closeouts, not manually ticked.', 1),
      (v_stage_id, 'No open blockers', 'Auto-checked from daily closeouts, not manually ticked.', 2);

    -- PUNCH
    insert into gate_template_stages (template_id, stage_key, position)
    values (v_template_id, 'punch', 7) returning id into v_stage_id;
    insert into gate_template_items (template_stage_id, label, position) values
      (v_stage_id, 'Punch items closed', 1),
      (v_stage_id, 'Final photos', 2),
      (v_stage_id, 'Customer walkthrough', 3);
    update gate_template_items set requires_photo = true
      where template_stage_id = v_stage_id and label = 'Final photos';

    -- CLOSEOUT
    insert into gate_template_stages (template_id, stage_key, position)
    values (v_template_id, 'closeout', 8) returning id into v_stage_id;
    insert into gate_template_items (template_stage_id, label, position) values
      (v_stage_id, 'Closeout PDF sent', 1),
      (v_stage_id, 'Customer sign-off', 2),
      (v_stage_id, 'Autopsy generated', 3),
      (v_stage_id, 'Final invoice flagged to office', 4);
  end loop;
end $$;
