-- Separate personal work access from revenue access and add secure time registration.

insert into public.role_permissions (workspace_id, role_id, permission)
select r.workspace_id, r.id, 'revenue:read'
from public.roles r
where r.role_key in ('owner', 'manager', 'accountant')
on conflict (role_id, permission) do nothing;

delete from public.role_permissions rp
using public.roles r
where rp.role_id = r.id
  and r.role_key in ('staff', 'viewer', 'kitchen_manager')
  and rp.permission = 'revenue:read';

drop policy if exists "workspace members can view sales_daily" on public.sales_daily;
create policy sales_daily_revenue_select on public.sales_daily for select to authenticated
  using (
    private.has_permission(workspace_id, 'revenue:read', business_id, null)
    or private.has_permission(workspace_id, 'finance:read', business_id, null)
  );

drop policy if exists "workspace members can view product_sales" on public.product_sales;
create policy product_sales_revenue_select on public.product_sales for select to authenticated
  using (
    private.has_permission(workspace_id, 'revenue:read', business_id, null)
    or private.has_permission(workspace_id, 'finance:read', business_id, null)
  );

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid not null,
  user_id uuid not null,
  clocked_in_at timestamptz not null default now(),
  clocked_out_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, workspace_id)
    references public.businesses(id, workspace_id) on delete cascade,
  foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade,
  check (clocked_out_at is null or clocked_out_at >= clocked_in_at)
);

create unique index time_entries_one_open_per_user
  on public.time_entries(workspace_id, user_id)
  where clocked_out_at is null;
create index time_entries_user_recent_idx
  on public.time_entries(workspace_id, user_id, clocked_in_at desc);
create index time_entries_business_recent_idx
  on public.time_entries(workspace_id, business_id, clocked_in_at desc);

alter table public.time_entries enable row level security;

create policy time_entries_own_select on public.time_entries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy time_entries_manager_select on public.time_entries for select to authenticated
  using (
    private.has_permission(workspace_id, 'operations:manage', business_id, null)
    or private.has_permission(workspace_id, 'finance:read', business_id, null)
  );
create policy time_entries_own_insert on public.time_entries for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      private.has_permission(workspace_id, 'operations:read', business_id, null)
      or private.has_permission(workspace_id, 'operations:manage', business_id, null)
    )
  );
create policy time_entries_own_update on public.time_entries for update to authenticated
  using ((select auth.uid()) = user_id and clocked_out_at is null)
  with check ((select auth.uid()) = user_id);

revoke all on public.time_entries from anon;
grant select, insert on public.time_entries to authenticated;
grant update (clocked_out_at, note) on public.time_entries to authenticated;

create trigger set_updated_at_time_entries before update on public.time_entries
  for each row execute function public.set_updated_at();

comment on table public.time_entries is 'Employee clock-in and clock-out registrations; employees can only access their own entries.';

