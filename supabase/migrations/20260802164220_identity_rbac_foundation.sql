-- Sprint 1: additive identity and RBAC foundation.
-- Existing workspace_members.role and tenant policies remain intact.

create table public.business_locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  code text,
  timezone text not null default 'Europe/Amsterdam',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id, business_id),
  unique (business_id, code)
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role_key text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, role_key),
  check (role_key ~ '^[a-z][a-z0-9_]*$')
);

create table public.role_permissions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role_id uuid not null,
  permission text not null,
  created_at timestamptz not null default now(),
  primary key (role_id, permission),
  foreign key (role_id, workspace_id)
    references public.roles(id, workspace_id) on delete cascade,
  check (permission ~ '^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*)?$')
);

alter table public.businesses
  add constraint businesses_id_workspace_unique unique (id, workspace_id);

alter table public.business_locations
  add constraint business_locations_business_workspace_fkey
  foreign key (business_id, workspace_id)
  references public.businesses(id, workspace_id) on delete cascade;

create table public.user_role_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null,
  role_id uuid not null,
  business_id uuid,
  location_id uuid,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade,
  foreign key (role_id, workspace_id)
    references public.roles(id, workspace_id) on delete cascade,
  foreign key (business_id, workspace_id)
    references public.businesses(id, workspace_id) on delete cascade,
  foreign key (location_id, workspace_id, business_id)
    references public.business_locations(id, workspace_id, business_id) on delete cascade,
  check (location_id is null or business_id is not null)
);

create unique index user_role_assignments_scope_unique
  on public.user_role_assignments (
    workspace_id, user_id, role_id,
    coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index business_locations_workspace_idx on public.business_locations(workspace_id, business_id);
create index roles_workspace_idx on public.roles(workspace_id);
create index role_permissions_workspace_idx on public.role_permissions(workspace_id, role_id);
create index user_role_assignments_user_idx on public.user_role_assignments(user_id, workspace_id);
create index user_role_assignments_scope_idx on public.user_role_assignments(workspace_id, business_id, location_id);
create index audit_log_workspace_created_idx on public.audit_log(workspace_id, created_at desc);
create index audit_log_actor_idx on public.audit_log(actor_id, created_at desc) where actor_id is not null;

insert into public.business_locations (workspace_id, business_id, name, code)
select b.workspace_id, b.id, b.name, 'main' from public.businesses b
on conflict (business_id, code) do nothing;

insert into public.roles (workspace_id, role_key, name, description, is_system)
select w.id, seed.role_key, seed.name, seed.description, true
from public.workspaces w
cross join (values
  ('owner', 'Eigenaar / CEO', 'Volledige toegang tot de workspace.'),
  ('manager', 'Manager', 'Operationeel beheer binnen de toegewezen scope.'),
  ('kitchen_manager', 'Keukenmanager', 'Recepturen, foodcost, voorraad en HACCP.'),
  ('staff', 'Medewerker', 'Eigen werkzaamheden, planning en procedures.'),
  ('marketing', 'Marketing', 'Social media, reviews en campagnes.'),
  ('accountant', 'Accountant', 'Financiele inzage en rapportages.'),
  ('viewer', 'Lezer', 'Alleen-lezen toegang binnen de toegewezen scope.')
) as seed(role_key, name, description)
on conflict (workspace_id, role_key) do nothing;

insert into public.role_permissions (workspace_id, role_id, permission)
select r.workspace_id, r.id, permission
from public.roles r
cross join lateral unnest(case r.role_key
  when 'owner' then array['workspace:manage','users:manage','finance:read','operations:manage','kitchen:manage','marketing:manage','reviews:manage','audit:read']
  when 'manager' then array['users:read','operations:manage','kitchen:manage','marketing:read','reviews:manage']
  when 'kitchen_manager' then array['operations:read','kitchen:manage']
  when 'staff' then array['operations:read']
  when 'marketing' then array['marketing:manage','reviews:manage']
  when 'accountant' then array['finance:read','operations:read']
  when 'viewer' then array['operations:read']
  else array[]::text[] end) permission
where r.is_system
on conflict (role_id, permission) do nothing;

insert into public.user_role_assignments (workspace_id, user_id, role_id)
select wm.workspace_id, wm.user_id, r.id
from public.workspace_members wm
join public.roles r on r.workspace_id = wm.workspace_id
 and r.role_key = case wm.role::text when 'employee' then 'staff' else wm.role::text end
on conflict do nothing;

alter table public.business_locations enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_role_assignments enable row level security;

create policy business_locations_member_select on public.business_locations for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy business_locations_manager_write on public.business_locations for all to authenticated
  using (private.is_workspace_manager(workspace_id))
  with check (private.is_workspace_manager(workspace_id));
create policy roles_member_select on public.roles for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy roles_manager_write on public.roles for all to authenticated
  using (private.is_workspace_manager(workspace_id))
  with check (private.is_workspace_manager(workspace_id));
create policy role_permissions_member_select on public.role_permissions for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy role_permissions_manager_write on public.role_permissions for all to authenticated
  using (private.is_workspace_manager(workspace_id))
  with check (private.is_workspace_manager(workspace_id));
create policy user_role_assignments_member_select on public.user_role_assignments for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy user_role_assignments_manager_write on public.user_role_assignments for all to authenticated
  using (private.is_workspace_manager(workspace_id))
  with check (private.is_workspace_manager(workspace_id));

revoke all on public.business_locations, public.roles, public.role_permissions, public.user_role_assignments from anon;
grant select, insert, update, delete on public.business_locations, public.roles, public.role_permissions, public.user_role_assignments to authenticated;

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
    where ura.workspace_id = target_workspace and ura.user_id = auth.uid()
      and (r.role_key = 'owner' or rp.permission = required_permission)
      and (ura.business_id is null or ura.business_id = target_business)
      and (ura.location_id is null or ura.location_id = target_location)
  );
$$;
revoke all on function private.has_permission(uuid, text, uuid, uuid) from public;
grant execute on function private.has_permission(uuid, text, uuid, uuid) to authenticated;

create or replace function private.audit_row_change()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  ws uuid;
  rec_id text;
begin
  ws := coalesce(
    nullif(new_row ->> 'workspace_id', '')::uuid,
    nullif(old_row ->> 'workspace_id', '')::uuid,
    case when tg_table_name = 'workspaces' then coalesce(
      nullif(new_row ->> 'id', '')::uuid, nullif(old_row ->> 'id', '')::uuid) end
  );
  rec_id := coalesce(new_row ->> 'id', old_row ->> 'id',
    new_row ->> 'user_id', old_row ->> 'user_id',
    new_row ->> 'role_id', old_row ->> 'role_id');
  insert into public.audit_log(workspace_id, actor_id, table_name, action, record_id, old_data, new_data)
  values (ws, auth.uid(), tg_table_name, tg_op, rec_id, old_row, new_row);
  return coalesce(new, old);
end;
$$;
revoke all on function private.audit_row_change() from public;

create trigger set_updated_at_business_locations before update on public.business_locations
  for each row execute function public.set_updated_at();
create trigger set_updated_at_roles before update on public.roles
  for each row execute function public.set_updated_at();
create trigger audit_workspaces_identity_changes after insert or update or delete on public.workspaces
  for each row execute function private.audit_row_change();
create trigger audit_businesses_identity_changes after insert or update or delete on public.businesses
  for each row execute function private.audit_row_change();
create trigger audit_business_locations_identity_changes after insert or update or delete on public.business_locations
  for each row execute function private.audit_row_change();
create trigger audit_workspace_members_identity_changes after insert or update or delete on public.workspace_members
  for each row execute function private.audit_row_change();
create trigger audit_roles_identity_changes after insert or update or delete on public.roles
  for each row execute function private.audit_row_change();
create trigger audit_role_permissions_identity_changes after insert or update or delete on public.role_permissions
  for each row execute function private.audit_row_change();
create trigger audit_user_role_assignments_identity_changes after insert or update or delete on public.user_role_assignments
  for each row execute function private.audit_row_change();

comment on table public.business_locations is 'Physical locations belonging to a business; businesses remain the existing app tenant filter.';
comment on table public.roles is 'Workspace-scoped RBAC roles. Legacy workspace_members.role remains authoritative for compatibility.';
comment on table public.user_role_assignments is 'Role assignments optionally scoped to a business and physical location.';
comment on function private.has_permission(uuid, text, uuid, uuid) is 'Checks normalized RBAC without relying on user-editable JWT metadata.';
