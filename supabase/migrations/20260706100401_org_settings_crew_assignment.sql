-- Batch 3, sub-phase A: org settings (name/address/logo/default working
-- days) and assigning a team member to a crew.

alter table organizations add column if not exists address text;
alter table organizations add column if not exists logo_path text;
-- Day-of-week integers matching JS Date.getDay() (0=Sunday..6=Saturday),
-- so application code never needs a second convention to translate
-- between. Mon-Fri by default — the common case; a company that also
-- works Saturdays edits this once in Org Settings rather than every
-- schedule build.
alter table organizations add column if not exists default_working_days int[]
  not null default '{1,2,3,4,5}';

-- A user's home crew — nullable (not every role has one; owner/pm/
-- scheduler typically won't). Field's crew picker (ADR-021) stays a
-- per-device localStorage preference for the shared-tablet case, but can
-- now default to this when a signed-in crew member has one set.
alter table profiles add column if not exists crew_id uuid
  references crews (id) on delete set null;

-- ORG LOGOS bucket -----------------------------------------------------
-- Private like every other bucket here (drawings/packing-slips/
-- daily-photos) — read via a short-lived signed URL, not a public bucket
-- URL, for consistency rather than because a logo is actually sensitive.
insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', false)
on conflict (id) do nothing;

-- Path convention "{org_id}/{filename}" (an org's logo isn't project-
-- scoped) — org_id is the path's own first segment directly, no
-- org_id_of_project() indirection needed.
create policy org_logos_objects_select on storage.objects for select
  using (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1]::uuid = current_org_id()
  );

create policy org_logos_objects_insert on storage.objects for insert
  with check (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1]::uuid = current_org_id()
    and current_user_role() in ('owner', 'pm')
  );

create policy org_logos_objects_update on storage.objects for update
  using (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1]::uuid = current_org_id()
    and current_user_role() in ('owner', 'pm')
  )
  with check (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1]::uuid = current_org_id()
    and current_user_role() in ('owner', 'pm')
  );

create policy org_logos_objects_delete on storage.objects for delete
  using (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1]::uuid = current_org_id()
    and current_user_role() in ('owner', 'pm')
  );

-- ORGANIZATIONS: was read-only for members (no client writes at all,
-- since name/created_at never changed post-creation) — now owner/pm can
-- update the new settings columns. A dedicated policy rather than
-- widening organizations_select, so read access for everyone else stays
-- exactly as narrow as before.
create policy organizations_update on organizations for update
  using (id = current_org_id() and current_user_role() in ('owner', 'pm'))
  with check (id = current_org_id() and current_user_role() in ('owner', 'pm'));

grant update on organizations to authenticated;
