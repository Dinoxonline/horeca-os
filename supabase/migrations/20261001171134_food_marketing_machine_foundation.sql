-- Food Marketing Machine: one reusable marketing profile per dish, without publishing automation.
create table public.food_marketing_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid not null,
  location_id uuid,
  recipe_id uuid,
  name text not null,
  category text,
  short_description text,
  long_description text,
  selling_price numeric,
  cost_price numeric,
  active boolean not null default true,
  available_from date,
  available_until date,
  service_moments text[] not null default '{}',
  marketing_class text not null default 'supporting',
  priority_score numeric,
  primary_usp text,
  target_audience text,
  promotion_moments text,
  call_to_action text,
  reservation_url text,
  landing_page_url text,
  keywords text[] not null default '{}',
  hashtags text[] not null default '{}',
  cross_sell_items text[] not null default '{}',
  upsell_items text[] not null default '{}',
  last_promoted_at timestamptz,
  last_promoted_channel text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id, business_id),
  foreign key (business_id, workspace_id)
    references public.businesses(id, workspace_id) on delete cascade,
  foreign key (location_id, workspace_id, business_id)
    references public.business_locations(id, workspace_id, business_id) on delete cascade,
  foreign key (recipe_id, workspace_id, business_id, location_id)
    references public.recipes(id, workspace_id, business_id, location_id) on delete restrict,
  check (location_id is null or business_id is not null),
  check (selling_price is null or selling_price >= 0),
  check (cost_price is null or cost_price >= 0),
  check (available_until is null or available_from is null or available_until >= available_from),
  check (marketing_class in ('hero', 'profit', 'supporting')),
  check (priority_score is null or priority_score between 0 and 100),
  check (service_moments <@ array['lunch', 'diner', 'borrel', 'dessert', 'drank', 'overig'])
);

create unique index food_marketing_items_recipe_unique
  on public.food_marketing_items(workspace_id, business_id, recipe_id)
  where recipe_id is not null;
create index food_marketing_items_scope_idx
  on public.food_marketing_items(workspace_id, business_id, active, marketing_class, updated_at desc);

create table public.food_marketing_media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid not null,
  item_id uuid not null,
  storage_path text not null,
  public_url text not null,
  file_name text not null,
  media_kind text not null,
  media_role text not null default 'extra',
  orientation text,
  status text not null default 'new',
  note text,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (item_id, workspace_id, business_id)
    references public.food_marketing_items(id, workspace_id, business_id) on delete cascade,
  check (media_kind in ('image', 'video')),
  check (media_role in ('main', 'extra', 'guest', 'taste_crew', 'staff')),
  check (orientation is null or orientation in ('vertical', 'horizontal', 'square', 'unknown')),
  check (status in ('new', 'review', 'approved', 'used', 'rejected')),
  unique (id, workspace_id, business_id)
);

create index food_marketing_media_item_idx
  on public.food_marketing_media(workspace_id, business_id, item_id, status, created_at desc);

alter table public.food_marketing_items enable row level security;
alter table public.food_marketing_media enable row level security;

create policy food_marketing_items_read on public.food_marketing_items for select to authenticated
  using (
    private.has_permission(workspace_id, 'marketing:read', business_id, location_id)
    or private.has_permission(workspace_id, 'marketing:manage', business_id, location_id)
  );
create policy food_marketing_items_manage on public.food_marketing_items for all to authenticated
  using (private.has_permission(workspace_id, 'marketing:manage', business_id, location_id))
  with check (private.has_permission(workspace_id, 'marketing:manage', business_id, location_id));

create policy food_marketing_media_read on public.food_marketing_media for select to authenticated
  using (
    private.has_permission(workspace_id, 'marketing:read', business_id, null)
    or private.has_permission(workspace_id, 'marketing:manage', business_id, null)
  );
create policy food_marketing_media_manage on public.food_marketing_media for all to authenticated
  using (private.has_permission(workspace_id, 'marketing:manage', business_id, null))
  with check (private.has_permission(workspace_id, 'marketing:manage', business_id, null));

revoke all on public.food_marketing_items, public.food_marketing_media from anon;
grant select, insert, update, delete on public.food_marketing_items, public.food_marketing_media to authenticated;

create trigger set_updated_at_food_marketing_items before update on public.food_marketing_items
  for each row execute function public.set_updated_at();
create trigger set_updated_at_food_marketing_media before update on public.food_marketing_media
  for each row execute function public.set_updated_at();
create trigger audit_food_marketing_items after insert or update or delete on public.food_marketing_items
  for each row execute function private.audit_row_change();
create trigger audit_food_marketing_media after insert or update or delete on public.food_marketing_media
  for each row execute function private.audit_row_change();

-- Short kitchen clips are part of the Food Marketing Machine. Existing image files remain supported.
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
where id = 'marketing-assets';

comment on table public.food_marketing_items is
  'Marketing profile for one dish or drink. It holds planning data only and never causes automatic publication.';
comment on table public.food_marketing_media is
  'Reusable approved or pending dish media in the existing marketing-assets storage bucket.';
