-- Secure media storage for the central marketing and event creator.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'marketing-assets',
  'marketing-assets',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Workspace members can read marketing assets" on storage.objects;
create policy "Workspace members can read marketing assets"
on storage.objects for select
to authenticated
using (
  bucket_id = 'marketing-assets'
  and exists (
    select 1
    from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.workspace_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists "Workspace members can upload marketing assets" on storage.objects;
create policy "Workspace members can upload marketing assets"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'marketing-assets'
  and exists (
    select 1
    from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.workspace_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists "Workspace members can update marketing assets" on storage.objects;
create policy "Workspace members can update marketing assets"
on storage.objects for update
to authenticated
using (
  bucket_id = 'marketing-assets'
  and exists (
    select 1
    from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.workspace_id::text = (storage.foldername(name))[1]
  )
)
with check (
  bucket_id = 'marketing-assets'
  and exists (
    select 1
    from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.workspace_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists "Workspace members can delete marketing assets" on storage.objects;
create policy "Workspace members can delete marketing assets"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'marketing-assets'
  and exists (
    select 1
    from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.workspace_id::text = (storage.foldername(name))[1]
  )
);
