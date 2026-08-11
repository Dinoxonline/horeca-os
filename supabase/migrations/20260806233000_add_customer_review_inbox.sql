create table public.customer_reviews (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, business_id uuid not null,
 source text not null, external_id text, reviewer_name text, rating integer not null check(rating between 1 and 5), title text, review_text text not null,
 reviewed_at timestamptz not null, status text not null default 'new' check(status in ('new','in_progress','responded','archived')),
 response_text text, internal_note text, responded_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(business_id,workspace_id) references public.businesses(id,workspace_id) on delete cascade,
 unique(workspace_id,source,external_id)
);
create index customer_reviews_workspace_date_idx on public.customer_reviews(workspace_id,reviewed_at desc);
alter table public.customer_reviews enable row level security;
create policy customer_reviews_select on public.customer_reviews for select to authenticated using(private.has_permission(workspace_id,'reviews:read',business_id,null) or private.has_permission(workspace_id,'reviews:manage',business_id,null) or private.has_permission(workspace_id,'reviews:respond',business_id,null));
create policy customer_reviews_insert on public.customer_reviews for insert to authenticated with check(private.has_permission(workspace_id,'reviews:manage',business_id,null));
create policy customer_reviews_update on public.customer_reviews for update to authenticated using(private.has_permission(workspace_id,'reviews:manage',business_id,null) or private.has_permission(workspace_id,'reviews:respond',business_id,null)) with check(private.has_permission(workspace_id,'reviews:manage',business_id,null) or private.has_permission(workspace_id,'reviews:respond',business_id,null));
grant select,insert,update on public.customer_reviews to authenticated;
create trigger set_updated_at_customer_reviews before update on public.customer_reviews for each row execute function public.set_updated_at();

