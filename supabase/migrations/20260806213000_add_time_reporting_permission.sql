-- Add a standalone permission for management access to employee time reports.

insert into public.role_permissions (workspace_id, role_id, permission)
select r.workspace_id, r.id, 'time:read'
from public.roles r
where r.role_key in ('owner', 'manager', 'accountant')
on conflict (role_id, permission) do nothing;

drop policy if exists time_entries_manager_select on public.time_entries;
create policy time_entries_manager_select on public.time_entries for select to authenticated
  using (private.has_permission(workspace_id, 'time:read', business_id, null));

