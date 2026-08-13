create table public.facebook_group_targets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  business_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 120),
  group_url text not null check (group_url ~* '^https://(www\.)?facebook\.com/groups/[^/?#]+'),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint facebook_group_targets_business_fk
    foreign key (business_id, workspace_id) references public.businesses(id, workspace_id) on delete cascade,
  unique (workspace_id, business_id, group_url)
);

create index facebook_group_targets_scope_idx
  on public.facebook_group_targets(workspace_id, business_id, is_active, name);

alter table public.facebook_group_targets enable row level security;

create policy facebook_group_targets_read on public.facebook_group_targets
  for select to authenticated
  using (private.has_permission(workspace_id, 'social:read', business_id, null));

create policy facebook_group_targets_manage on public.facebook_group_targets
  for all to authenticated
  using (private.has_permission(workspace_id, 'social:manage', business_id, null))
  with check (private.has_permission(workspace_id, 'social:manage', business_id, null));

revoke all on public.facebook_group_targets from anon;
grant select, insert, update, delete on public.facebook_group_targets to authenticated;
grant all on public.facebook_group_targets to service_role;

create trigger set_updated_at_facebook_group_targets
  before update on public.facebook_group_targets
  for each row execute function public.set_updated_at();

comment on table public.facebook_group_targets is
  'User-managed Facebook group destinations. Meta no longer permits API-based group enumeration or publishing; these URLs support guided manual sharing.';
