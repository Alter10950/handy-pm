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
