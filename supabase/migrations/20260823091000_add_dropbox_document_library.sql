create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  title text not null,
  category text not null default 'other',
  description text,
  dropbox_path text not null,
  dropbox_file_id text,
  dropbox_shared_link text,
  access_mode text not null default 'workspace' check (access_mode in ('workspace','managers','specific','private')),
  allowed_user_ids uuid[] not null default '{}',
  process_run_id uuid references public.process_runs(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_workspace_category_idx on public.documents(workspace_id, category, updated_at desc);
create index if not exists documents_dropbox_path_idx on public.documents(workspace_id, dropbox_path);
alter table public.documents enable row level security;

create policy documents_read on public.documents for select to authenticated using (
  private.has_permission(workspace_id, 'documents:read', business_id, null)
  and (
    access_mode = 'workspace'
    or access_mode = 'managers' and private.has_permission(workspace_id, 'documents:manage', business_id, null)
    or access_mode = 'specific' and (select auth.uid()) = any(allowed_user_ids)
    or access_mode = 'private' and (select auth.uid()) = created_by
    or private.has_permission(workspace_id, 'documents:manage', business_id, null)
  )
);
create policy documents_manage on public.documents for all to authenticated
using (private.has_permission(workspace_id, 'documents:manage', business_id, null))
with check (private.has_permission(workspace_id, 'documents:manage', business_id, null));

grant select, insert, update, delete on public.documents to authenticated;
create trigger set_updated_at_documents before update on public.documents for each row execute function public.set_updated_at();

insert into public.role_permissions (workspace_id, role_id, permission)
select workspace_id, id, 'documents:read' from public.roles where role_key in ('owner','manager','employee','staff','viewer','kitchen_manager')
on conflict (role_id, permission) do nothing;
insert into public.role_permissions (workspace_id, role_id, permission)
select workspace_id, id, 'documents:manage' from public.roles where role_key in ('owner','manager')
on conflict (role_id, permission) do nothing;
