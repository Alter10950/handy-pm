-- Batch 3, sub-phase A: "Account page (change own password/name)" — the
-- password half already worked (supabase.auth.updateUser, auth.users, no
-- RLS involved); full_name lives in `profiles`, and profiles_update's
-- existing policy only lets owner/pm update ANY row, including their own
-- — a crew/scheduler user can't self-edit their own name through it.
--
-- Postgres RLS is row-level, not column-level, so a policy can't say "any
-- signed-in user may update this one column of their own row" without
-- also exposing every other column (role, org_id) on that row to a
-- crafted client-side update. A narrow SECURITY DEFINER RPC — same
-- pattern as set_marking_drawing — sidesteps that: it hardcodes both
-- `where id = auth.uid()` (only ever the caller's own row) and the one
-- column it ever touches, so there's nothing broader for a client to
-- exploit even though the function itself bypasses RLS.
create or replace function public.update_own_full_name(p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles set full_name = nullif(trim(p_full_name), '') where id = auth.uid();
end;
$$;

grant execute on function public.update_own_full_name(text) to authenticated;
