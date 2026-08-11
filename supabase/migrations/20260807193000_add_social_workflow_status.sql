alter table public.social_content_items
  add column if not exists workflow_status text not null default 'new',
  add column if not exists handled_at timestamptz,
  add column if not exists handled_by uuid references auth.users(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.social_content_items'::regclass
      and conname = 'social_content_items_workflow_status_check'
  ) then
    alter table public.social_content_items
      add constraint social_content_items_workflow_status_check
      check (workflow_status in ('new', 'in_progress', 'handled'));
  end if;
end
$$;

create index if not exists social_content_items_workflow_status_idx
  on public.social_content_items (workspace_id, business_id, workflow_status, published_at desc);
