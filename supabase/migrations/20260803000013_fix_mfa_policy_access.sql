-- Evaluate MFA state through a private helper so authenticated clients do not need direct auth schema access.

create or replace function private.mfa_level_ok()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, auth
as $$
  select case
    when auth.uid() is null then false
    when exists (
      select 1
      from auth.mfa_factors
      where user_id = auth.uid()
        and status = 'verified'
    ) then coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
    else true
  end;
$$;

revoke all on function private.mfa_level_ok() from public;
grant execute on function private.mfa_level_ok() to authenticated;

do $$
declare
  target_table record;
begin
  for target_table in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  loop
    execute format('drop policy if exists mfa_verified_if_enrolled on %I.%I', target_table.schema_name, target_table.table_name);
    execute format(
      'create policy mfa_verified_if_enrolled on %I.%I as restrictive for all to authenticated using (private.mfa_level_ok()) with check (private.mfa_level_ok())',
      target_table.schema_name,
      target_table.table_name
    );
  end loop;
end
$$;
