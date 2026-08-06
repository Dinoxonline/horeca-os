-- Robuust-aligned staff scheduling, availability and shift swap foundations.
create table public.schedule_shifts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid not null, user_id uuid not null, starts_at timestamptz not null, ends_at timestamptz not null,
  role_label text, note text, status text not null default 'planned' check (status in ('draft','planned','completed','cancelled')),
  created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (business_id,workspace_id) references public.businesses(id,workspace_id) on delete cascade,
  foreign key (workspace_id,user_id) references public.workspace_members(workspace_id,user_id) on delete cascade,
  check (ends_at > starts_at)
);
create index schedule_shifts_workspace_start_idx on public.schedule_shifts(workspace_id,starts_at);
create index schedule_shifts_user_start_idx on public.schedule_shifts(workspace_id,user_id,starts_at);
alter table public.schedule_shifts enable row level security;
create policy schedule_shifts_own_select on public.schedule_shifts for select to authenticated using ((select auth.uid())=user_id);
create policy schedule_shifts_manager_select on public.schedule_shifts for select to authenticated using (private.has_permission(workspace_id,'schedule:read',business_id,null) or private.has_permission(workspace_id,'schedule:manage',business_id,null));
create policy schedule_shifts_manager_insert on public.schedule_shifts for insert to authenticated with check (private.has_permission(workspace_id,'schedule:manage',business_id,null));
create policy schedule_shifts_manager_update on public.schedule_shifts for update to authenticated using (private.has_permission(workspace_id,'schedule:manage',business_id,null)) with check (private.has_permission(workspace_id,'schedule:manage',business_id,null));
create policy schedule_shifts_manager_delete on public.schedule_shifts for delete to authenticated using (private.has_permission(workspace_id,'schedule:manage',business_id,null));
grant select,insert,update,delete on public.schedule_shifts to authenticated;
create trigger set_updated_at_schedule_shifts before update on public.schedule_shifts for each row execute function public.set_updated_at();

create table public.employee_availability (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null, available_date date not null, available_from time, available_until time,
  status text not null default 'available' check (status in ('available','preferred','unavailable')), note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (workspace_id,user_id) references public.workspace_members(workspace_id,user_id) on delete cascade,
  unique(workspace_id,user_id,available_date), check (available_until is null or available_from is null or available_until>available_from)
);
create index employee_availability_workspace_date_idx on public.employee_availability(workspace_id,available_date);
alter table public.employee_availability enable row level security;
create policy availability_own_select on public.employee_availability for select to authenticated using ((select auth.uid())=user_id);
create policy availability_manager_select on public.employee_availability for select to authenticated using (private.has_permission(workspace_id,'schedule:manage',null,null));
create policy availability_own_insert on public.employee_availability for insert to authenticated with check ((select auth.uid())=user_id and private.has_permission(workspace_id,'schedule:read',null,null));
create policy availability_own_update on public.employee_availability for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy availability_own_delete on public.employee_availability for delete to authenticated using ((select auth.uid())=user_id);
grant select,insert,update,delete on public.employee_availability to authenticated;
create trigger set_updated_at_employee_availability before update on public.employee_availability for each row execute function public.set_updated_at();

create table public.shift_swap_requests (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shift_id uuid not null references public.schedule_shifts(id) on delete cascade, requested_by uuid not null, offered_to uuid,
  reason text, status text not null default 'open' check (status in ('open','accepted','declined','approved','cancelled')),
  reviewed_by uuid references public.profiles(id) on delete set null, reviewed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (workspace_id,requested_by) references public.workspace_members(workspace_id,user_id) on delete cascade,
  foreign key (workspace_id,offered_to) references public.workspace_members(workspace_id,user_id)
);
create index shift_swap_requests_workspace_status_idx on public.shift_swap_requests(workspace_id,status);
alter table public.shift_swap_requests enable row level security;
create policy swaps_participant_select on public.shift_swap_requests for select to authenticated using ((select auth.uid())=requested_by or (select auth.uid())=offered_to or private.has_permission(workspace_id,'schedule:manage',null,null));
create policy swaps_own_insert on public.shift_swap_requests for insert to authenticated with check ((select auth.uid())=requested_by);
create policy swaps_participant_update on public.shift_swap_requests for update to authenticated using ((select auth.uid())=requested_by or (select auth.uid())=offered_to or private.has_permission(workspace_id,'schedule:manage',null,null)) with check ((select auth.uid())=requested_by or (select auth.uid())=offered_to or private.has_permission(workspace_id,'schedule:manage',null,null));
grant select,insert,update on public.shift_swap_requests to authenticated;
create trigger set_updated_at_shift_swap_requests before update on public.shift_swap_requests for each row execute function public.set_updated_at();

insert into public.role_permissions(workspace_id,role_id,permission) select workspace_id,id,'schedule:read' from public.roles where role_key in ('owner','manager','staff','viewer','kitchen_manager') on conflict(role_id,permission) do nothing;
insert into public.role_permissions(workspace_id,role_id,permission) select workspace_id,id,'schedule:manage' from public.roles where role_key in ('owner','manager') on conflict(role_id,permission) do nothing;

