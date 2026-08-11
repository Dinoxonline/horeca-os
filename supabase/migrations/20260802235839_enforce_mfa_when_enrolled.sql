-- Enforce AAL2 for every user who has enrolled a verified MFA factor.
-- Users without a verified factor retain AAL1 access so mandatory roles can complete enrollment.

do $$
declare
  target_table record;
  mfa_expression text := $policy$
    array[coalesce((select auth.jwt()->>'aal'), 'aal1')] <@ (
      select case
        when count(id) > 0 then array['aal2']
        else array['aal1', 'aal2']
      end
      from auth.mfa_factors
      where user_id = (select auth.uid())
        and status = 'verified'
    )
  $policy$;
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
      'create policy mfa_verified_if_enrolled on %I.%I as restrictive for all to authenticated using (%s) with check (%s)',
      target_table.schema_name,
      target_table.table_name,
      mfa_expression,
      mfa_expression
    );
  end loop;
end
$$;
