create table public.facebook_group_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  business_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 80),
  group_ids uuid[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint facebook_group_lists_business_fk
    foreign key (business_id, workspace_id) references public.businesses(id, workspace_id) on delete cascade,
  unique (workspace_id, business_id, name)
);

create index facebook_group_lists_scope_idx
  on public.facebook_group_lists(workspace_id, business_id, name);

alter table public.facebook_group_lists enable row level security;

create policy facebook_group_lists_read on public.facebook_group_lists
  for select to authenticated
  using (private.has_permission(workspace_id, 'social:read', business_id, null));

create policy facebook_group_lists_manage on public.facebook_group_lists
  for all to authenticated
  using (private.has_permission(workspace_id, 'social:manage', business_id, null))
  with check (private.has_permission(workspace_id, 'social:manage', business_id, null));

revoke all on public.facebook_group_lists from anon;
grant select, insert, update, delete on public.facebook_group_lists to authenticated;
grant all on public.facebook_group_lists to service_role;

create trigger set_updated_at_facebook_group_lists
  before update on public.facebook_group_lists
  for each row execute function public.set_updated_at();

comment on table public.facebook_group_lists is
  'Reusable, user-named Facebook group selections scoped to one restaurant location.';
