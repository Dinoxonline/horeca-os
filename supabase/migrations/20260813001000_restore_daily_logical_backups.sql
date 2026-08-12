create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create or replace function private.create_horeca_os_logical_backup()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace uuid;
begin
  for target_workspace in
    select id from public.workspaces
  loop
    insert into public.backup_snapshots (
      workspace_id,
      backup_type,
      status,
      snapshot,
      row_counts
    )
    values (
      target_workspace,
      'logical',
      'completed',
      jsonb_build_object(
        'tasks', coalesce((select jsonb_agg(to_jsonb(t)) from public.tasks t where t.workspace_id = target_workspace), '[]'::jsonb),
        'events', coalesce((select jsonb_agg(to_jsonb(e)) from public.events e where e.workspace_id = target_workspace), '[]'::jsonb),
        'recipes', coalesce((select jsonb_agg(to_jsonb(r)) from public.recipes r where r.workspace_id = target_workspace), '[]'::jsonb),
        'products', coalesce((select jsonb_agg(to_jsonb(p)) from public.products p where p.workspace_id = target_workspace), '[]'::jsonb),
        'decisions', coalesce((select jsonb_agg(to_jsonb(d)) from public.decisions d where d.workspace_id = target_workspace), '[]'::jsonb),
        'suppliers', coalesce((select jsonb_agg(to_jsonb(s)) from public.suppliers s where s.workspace_id = target_workspace), '[]'::jsonb),
        'businesses', coalesce((select jsonb_agg(to_jsonb(b)) from public.businesses b where b.workspace_id = target_workspace), '[]'::jsonb),
        'reviews', coalesce((select jsonb_agg(to_jsonb(rv)) from public.reviews rv where rv.workspace_id = target_workspace), '[]'::jsonb),
        'sales_daily', coalesce((select jsonb_agg(to_jsonb(sd)) from public.sales_daily sd where sd.workspace_id = target_workspace), '[]'::jsonb),
        'integrations', coalesce((select jsonb_agg(to_jsonb(i)) from public.integrations i where i.workspace_id = target_workspace), '[]'::jsonb),
        'product_sales', coalesce((select jsonb_agg(to_jsonb(ps)) from public.product_sales ps where ps.workspace_id = target_workspace), '[]'::jsonb)
      ),
      jsonb_build_object(
        'tasks', (select count(*) from public.tasks t where t.workspace_id = target_workspace),
        'events', (select count(*) from public.events e where e.workspace_id = target_workspace),
        'recipes', (select count(*) from public.recipes r where r.workspace_id = target_workspace),
        'products', (select count(*) from public.products p where p.workspace_id = target_workspace),
        'decisions', (select count(*) from public.decisions d where d.workspace_id = target_workspace),
        'suppliers', (select count(*) from public.suppliers s where s.workspace_id = target_workspace),
        'businesses', (select count(*) from public.businesses b where b.workspace_id = target_workspace),
        'reviews', (select count(*) from public.reviews rv where rv.workspace_id = target_workspace),
        'sales_daily', (select count(*) from public.sales_daily sd where sd.workspace_id = target_workspace),
        'integrations', (select count(*) from public.integrations i where i.workspace_id = target_workspace),
        'product_sales', (select count(*) from public.product_sales ps where ps.workspace_id = target_workspace)
      )
    );
  end loop;

  delete from public.backup_snapshots
  where backup_type = 'logical'
    and created_at < now() - interval '30 days';
end;
$$;

revoke all on function private.create_horeca_os_logical_backup() from public;
revoke all on function private.create_horeca_os_logical_backup() from anon, authenticated;
grant execute on function private.create_horeca_os_logical_backup() to postgres, service_role;

create index if not exists backup_snapshots_workspace_created_at_idx
on public.backup_snapshots (workspace_id, created_at desc);

select cron.unschedule(jobid)
from cron.job
where jobname = 'horeca-os-daily-logical-backup';

select cron.schedule(
  'horeca-os-daily-logical-backup',
  '3 1 * * *',
  'select private.create_horeca_os_logical_backup();'
);
