insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketing-assets', 'marketing-assets', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "marketing_assets_authenticated_insert" on storage.objects;
create policy "marketing_assets_authenticated_insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'marketing-assets');

drop policy if exists "marketing_assets_owner_update" on storage.objects;
create policy "marketing_assets_owner_update"
on storage.objects for update to authenticated
using (bucket_id = 'marketing-assets' and owner_id = (select auth.jwt()->>'sub'))
with check (bucket_id = 'marketing-assets' and owner_id = (select auth.jwt()->>'sub'));

drop policy if exists "marketing_assets_owner_delete" on storage.objects;
create policy "marketing_assets_owner_delete"
on storage.objects for delete to authenticated
using (bucket_id = 'marketing-assets' and owner_id = (select auth.jwt()->>'sub'));

