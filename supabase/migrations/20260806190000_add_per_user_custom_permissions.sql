-- Per-user permissions for the workspace role "Aangepast".

insert into public.roles (workspace_id, role_key, name, description, is_system)
select id, 'custom', 'Aangepast', 'Machtigingen worden per gebruiker aangevinkt.', true
from public.workspaces
on conflict (workspace_id, role_key) do update
set name = excluded.name, description = excluded.description, updated_at = now();

alter table public.user_role_assignments
  add constraint user_role_assignments_id_workspace_unique unique (id, workspace_id);

create table public.assignment_permissions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  assignment_id uuid not null,
  permission text not null,
  created_at timestamptz not null default now(),
  primary key (assignment_id, permission),
  foreign key (assignment_id, workspace_id)
    references public.user_role_assignments(id, workspace_id) on delete cascade,
  check (permission ~ '^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*)?$')
);

create index assignment_permissions_workspace_idx on public.assignment_permissions(workspace_id, assignment_id);
create index assignment_permissions_assignment_workspace_idx on public.assignment_permissions(assignment_id, workspace_id);
alter table public.assignment_permissions enable row level security;

create policy assignment_permissions_member_select on public.assignment_permissions
for select to authenticated using (private.is_workspace_member(workspace_id));
create policy assignment_permissions_manager_write on public.assignment_permissions
for all to authenticated using (private.is_workspace_manager(workspace_id))
with check (private.is_workspace_manager(workspace_id));

revoke all on public.assignment_permissions from anon;
grant select, insert, update, delete on public.assignment_permissions to authenticated;

create or replace function private.has_permission(
  target_workspace uuid, required_permission text,
  target_business uuid default null, target_location uuid default null
)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1 from public.user_role_assignments ura
    join public.roles r on r.id = ura.role_id and r.workspace_id = ura.workspace_id
    left join public.role_permissions rp on rp.role_id = r.id and rp.workspace_id = r.workspace_id
    left join public.assignment_permissions ap on ap.assignment_id = ura.id and ap.workspace_id = ura.workspace_id
    where ura.workspace_id = target_workspace and ura.user_id = auth.uid()
      and (r.role_key = 'owner' or (r.role_key = 'custom' and ap.permission = required_permission) or (r.role_key <> 'custom' and rp.permission = required_permission))
      and (ura.business_id is null or ura.business_id = target_business)
      and (ura.location_id is null or ura.location_id = target_location)
  );
$$;

revoke all on function private.has_permission(uuid, text, uuid, uuid) from public;
grant execute on function private.has_permission(uuid, text, uuid, uuid) to authenticated;

create trigger audit_assignment_permissions_changes after insert or update or delete on public.assignment_permissions
for each row execute function private.audit_row_change();

comment on table public.assignment_permissions is 'Per-assignment permissions used by the custom workspace role.';

