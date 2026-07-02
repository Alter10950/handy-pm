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
