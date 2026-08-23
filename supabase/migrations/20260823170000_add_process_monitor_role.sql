do $$
declare
  w record;
  new_role_id uuid;
begin
  for w in select id as workspace_id from public.workspaces loop
    insert into public.roles (workspace_id, role_key, name)
    values (w.workspace_id, 'shift_lead', 'Leidinggevende')
    on conflict (workspace_id, role_key) do update set name = 'Leidinggevende'
    returning id into new_role_id;

    if new_role_id is null then
      select id into new_role_id from public.roles where workspace_id = w.workspace_id and role_key = 'shift_lead';
    end if;

    insert into public.role_permissions (workspace_id, role_id, permission)
    values
      (w.workspace_id, new_role_id, 'processes:read'),
      (w.workspace_id, new_role_id, 'processes:monitor')
    on conflict (role_id, permission) do nothing;

    insert into public.role_permissions (workspace_id, role_id, permission)
    select w.workspace_id, id, 'processes:monitor'
    from public.roles
    where workspace_id = w.workspace_id and role_key in ('viewer', 'kitchen_manager')
    on conflict (role_id, permission) do nothing;
  end loop;
end $$;

drop policy if exists process_runs_read on public.process_runs;
create policy process_runs_read on public.process_runs
for select to authenticated
using (
  private.has_permission(workspace_id, 'processes:manage', business_id, null)
  or private.has_permission(workspace_id, 'processes:monitor', business_id, null)
  or exists (
    select 1
    from public.process_run_tasks task
    where task.run_id = process_runs.id
      and task.assigned_to = (select auth.uid())
  )
);

drop policy if exists process_run_tasks_read on public.process_run_tasks;
create policy process_run_tasks_read on public.process_run_tasks
for select to authenticated
using (
  private.has_permission(workspace_id, 'processes:manage', business_id, null)
  or private.has_permission(workspace_id, 'processes:monitor', business_id, null)
  or (
    assigned_to = (select auth.uid())
    and private.has_permission(workspace_id, 'processes:read', business_id, null)
  )
);
