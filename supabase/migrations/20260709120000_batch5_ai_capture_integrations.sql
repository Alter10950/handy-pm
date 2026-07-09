-- Batch 5 Sub-phase 0: AI capture + integrations foundation.
--
-- Every AI capture is logged, reviewable, and re-runnable (extraction_runs);
-- inbound SMS/WhatsApp lands as reviewable drafts (inbound_messages);
-- external systems connect per-org with server-only tokens (integrations
-- + integration_links); rules-based anomalies surface as acknowledgeable
-- flags (anomaly_flags); materials carry an optional scan payload.
--
-- Design law (Batch 5): AI assists, a human confirms. Nothing here writes
-- into materials/estimates/installs on its own — these tables hold the
-- PROPOSED/RAW output and the review/apply state around it.
--
-- Additive + idempotent, same conventions as every prior migration
-- (create ... if not exists, drop policy if exists + create policy). Cost
-- and integration secrets are OWNER-ONLY; crew never sees costs.

-- ── materials: optional scan payload (QR/barcode) ──
alter table materials
  add column if not exists scan_code text;
create index if not exists materials_scan_code_idx
  on materials (project_id, scan_code) where scan_code is not null;

-- ── extraction_runs: the audit + review record for every AI capture ──
create table if not exists extraction_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  project_id uuid references projects (id) on delete cascade,
  kind text not null check (
    kind in ('packing_slip', 'drawing_rows', 'row_assignment')
  ),
  status text not null default 'pending' check (
    status in ('pending', 'extracted', 'reviewing', 'applied', 'rejected', 'failed')
  ),
  input_path text,              -- storage path of the source file, if any
  raw_output jsonb,             -- the model's proposed output, verbatim
  confidence numeric,           -- 0–1 overall, when the model reports one
  created_by uuid references auth.users (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  applied boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists extraction_runs_project_idx
  on extraction_runs (project_id, created_at desc);
create index if not exists extraction_runs_org_idx
  on extraction_runs (org_id, created_at desc);

alter table extraction_runs enable row level security;

drop policy if exists extraction_runs_select on extraction_runs;
create policy extraction_runs_select on extraction_runs for select
  using (org_id = current_org_id());

drop policy if exists extraction_runs_write on extraction_runs;
create policy extraction_runs_write on extraction_runs for all
  using (
    org_id = current_org_id()
    and current_user_role() in ('owner', 'pm', 'scheduler')
  )
  with check (
    org_id = current_org_id()
    and current_user_role() in ('owner', 'pm', 'scheduler')
  );

-- ── inbound_messages: SMS/WhatsApp intake, parsed to DRAFTS ──
create table if not exists inbound_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  channel text not null check (channel in ('sms', 'whatsapp')),
  from_number text not null,
  body text,
  media jsonb,                  -- [{ url, content_type }]
  matched_project_id uuid references projects (id) on delete set null,
  matched_user_id uuid references auth.users (id) on delete set null,
  parsed jsonb,                 -- structured draft (rows/materials/qty)
  status text not null default 'received' check (
    status in ('received', 'parsed', 'applied', 'rejected', 'unmatched')
  ),
  created_at timestamptz not null default now()
);
create index if not exists inbound_messages_org_idx
  on inbound_messages (org_id, created_at desc);
create index if not exists inbound_messages_status_idx
  on inbound_messages (org_id, status);

alter table inbound_messages enable row level security;

-- Office triages inbound; crew doesn't see the raw firehose.
drop policy if exists inbound_messages_select on inbound_messages;
create policy inbound_messages_select on inbound_messages for select
  using (
    org_id = current_org_id()
    and current_user_role() in ('owner', 'pm', 'scheduler')
  );

drop policy if exists inbound_messages_write on inbound_messages;
create policy inbound_messages_write on inbound_messages for all
  using (
    org_id = current_org_id()
    and current_user_role() in ('owner', 'pm', 'scheduler')
  )
  with check (
    org_id = current_org_id()
    and current_user_role() in ('owner', 'pm', 'scheduler')
  );

-- ── integrations: per-org external connections, OWNER-ONLY ──
-- tokens are written and read only by the service-role client on the
-- server; RLS keeps them out of every browser-scoped query entirely.
create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  provider text not null check (provider in ('quickbooks', 'zoho')),
  status text not null default 'disconnected' check (
    status in ('disconnected', 'connected', 'error')
  ),
  tokens jsonb,                 -- server-only; never selected client-side
  settings jsonb not null default '{}'::jsonb,
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, provider)
);

alter table integrations enable row level security;

-- Owner-only, and even then the app selects an explicit non-token column
-- list — tokens never leave the server.
drop policy if exists integrations_select on integrations;
create policy integrations_select on integrations for select
  using (org_id = current_org_id() and current_user_role() = 'owner');

drop policy if exists integrations_write on integrations;
create policy integrations_write on integrations for all
  using (org_id = current_org_id() and current_user_role() = 'owner')
  with check (org_id = current_org_id() and current_user_role() = 'owner');

create table if not exists integration_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  provider text not null check (provider in ('quickbooks', 'zoho')),
  local_kind text not null,     -- e.g. 'project'
  local_id uuid not null,
  remote_id text not null,      -- QBO customer/job id or Zoho deal id
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, provider, local_kind, local_id)
);
create index if not exists integration_links_lookup_idx
  on integration_links (org_id, provider, local_kind, local_id);

alter table integration_links enable row level security;

drop policy if exists integration_links_select on integration_links;
create policy integration_links_select on integration_links for select
  using (org_id = current_org_id() and current_user_role() in ('owner', 'pm'));

drop policy if exists integration_links_write on integration_links;
create policy integration_links_write on integration_links for all
  using (org_id = current_org_id() and current_user_role() = 'owner')
  with check (org_id = current_org_id() and current_user_role() = 'owner');

-- ── anomaly_flags: rules-based exceptions, acknowledgeable ──
create table if not exists anomaly_flags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id) on delete cascade,
  project_id uuid references projects (id) on delete cascade,
  crew_id uuid references crews (id) on delete set null,
  kind text not null,           -- 'spi_slipping','low_output','material_shortfall','idle_crew','estimate_drift'
  severity text not null default 'warn' check (severity in ('info', 'warn', 'critical')),
  payload jsonb not null default '{}'::jsonb,
  -- Stable key so the nightly recompute upserts instead of duplicating a
  -- still-true anomaly every run.
  dedupe_key text not null,
  acknowledged_by uuid references auth.users (id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, dedupe_key)
);
create index if not exists anomaly_flags_open_idx
  on anomaly_flags (org_id, created_at desc) where acknowledged_at is null;

alter table anomaly_flags enable row level security;

-- Office sees anomalies; costs inside payloads are only ever put there for
-- owner-relevant kinds, but the strip itself is office-wide.
drop policy if exists anomaly_flags_select on anomaly_flags;
create policy anomaly_flags_select on anomaly_flags for select
  using (
    org_id = current_org_id()
    and current_user_role() in ('owner', 'pm', 'scheduler')
  );

drop policy if exists anomaly_flags_write on anomaly_flags;
create policy anomaly_flags_write on anomaly_flags for all
  using (
    org_id = current_org_id()
    and current_user_role() in ('owner', 'pm', 'scheduler')
  )
  with check (
    org_id = current_org_id()
    and current_user_role() in ('owner', 'pm', 'scheduler')
  );

-- ── org settings: anomaly thresholds live alongside the other org config ──
alter table organizations
  add column if not exists anomaly_settings jsonb not null default '{}'::jsonb;
