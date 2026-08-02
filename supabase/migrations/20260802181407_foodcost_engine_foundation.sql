-- Sprint 3: Foodcost Engine & Recepturen.
-- Additive only: existing supplier, product, recipe and recipe_items data is retained.

alter table public.suppliers
  add column location_id uuid,
  add constraint suppliers_id_workspace_unique unique (id, workspace_id),
  add constraint suppliers_id_workspace_business_unique unique (id, workspace_id, business_id),
  add constraint suppliers_id_scope_unique unique (id, workspace_id, business_id, location_id),
  add constraint suppliers_business_scope_fkey foreign key (business_id, workspace_id)
    references public.businesses(id, workspace_id) on delete cascade,
  add constraint suppliers_location_scope_fkey foreign key (location_id, workspace_id, business_id)
    references public.business_locations(id, workspace_id, business_id) on delete cascade,
  add constraint suppliers_location_requires_business check (location_id is null or business_id is not null);

alter table public.products
  add column location_id uuid,
  add column barcode text,
  add column package_quantity numeric,
  add column package_unit text,
  add column content_quantity numeric,
  add column content_unit text,
  add column currency_code text not null default 'EUR',
  add constraint products_id_workspace_unique unique (id, workspace_id),
  add constraint products_id_workspace_business_unique unique (id, workspace_id, business_id),
  add constraint products_id_scope_unique unique (id, workspace_id, business_id, location_id),
  add constraint products_business_scope_fkey foreign key (business_id, workspace_id)
    references public.businesses(id, workspace_id) on delete cascade,
  add constraint products_location_scope_fkey foreign key (location_id, workspace_id, business_id)
    references public.business_locations(id, workspace_id, business_id) on delete cascade,
  add constraint products_supplier_workspace_fkey foreign key (supplier_id, workspace_id)
    references public.suppliers(id, workspace_id) on delete restrict,
  add constraint products_supplier_business_fkey foreign key (supplier_id, workspace_id, business_id)
    references public.suppliers(id, workspace_id, business_id) on delete restrict,
  add constraint products_supplier_scope_fkey foreign key (supplier_id, workspace_id, business_id, location_id)
    references public.suppliers(id, workspace_id, business_id, location_id) on delete restrict,
  add constraint products_location_requires_business check (location_id is null or business_id is not null),
  add constraint products_package_quantity_positive check (package_quantity is null or package_quantity > 0),
  add constraint products_content_quantity_positive check (content_quantity is null or content_quantity > 0),
  add constraint products_purchase_price_nonnegative check (purchase_price is null or purchase_price >= 0),
  add constraint products_currency_code_format check (currency_code ~ '^[A-Z]{3}$');

alter table public.recipes
  add column location_id uuid,
  add column target_foodcost_percentage numeric,
  add constraint recipes_id_workspace_unique unique (id, workspace_id),
  add constraint recipes_id_workspace_business_unique unique (id, workspace_id, business_id),
  add constraint recipes_id_scope_unique unique (id, workspace_id, business_id, location_id),
  add constraint recipes_business_scope_fkey foreign key (business_id, workspace_id)
    references public.businesses(id, workspace_id) on delete cascade,
  add constraint recipes_location_scope_fkey foreign key (location_id, workspace_id, business_id)
    references public.business_locations(id, workspace_id, business_id) on delete cascade,
  add constraint recipes_location_requires_business check (location_id is null or business_id is not null),
  add constraint recipes_target_foodcost_range check (
    target_foodcost_percentage is null or target_foodcost_percentage between 0 and 100
  );

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid,
  location_id uuid,
  product_id uuid not null,
  name text not null,
  base_unit text not null,
  units_per_product numeric not null,
  yield_percentage numeric not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id, business_id, location_id),
  unique (id, workspace_id),
  unique (id, workspace_id, business_id),
  unique (workspace_id, business_id, location_id, product_id, name),
  foreign key (business_id, workspace_id)
    references public.businesses(id, workspace_id) on delete cascade,
  foreign key (location_id, workspace_id, business_id)
    references public.business_locations(id, workspace_id, business_id) on delete cascade,
  foreign key (product_id, workspace_id)
    references public.products(id, workspace_id) on delete cascade,
  foreign key (product_id, workspace_id, business_id)
    references public.products(id, workspace_id, business_id) on delete cascade,
  foreign key (product_id, workspace_id, business_id, location_id)
    references public.products(id, workspace_id, business_id, location_id) on delete cascade,
  check (location_id is null or business_id is not null),
  check (units_per_product > 0),
  check (yield_percentage > 0 and yield_percentage <= 100),
  check (base_unit in ('g', 'kg', 'ml', 'l', 'piece', 'portion'))
);

alter table public.recipe_items
  add column workspace_id uuid,
  add column business_id uuid,
  add column location_id uuid,
  add column ingredient_id uuid,
  add column line_order integer not null default 0;

update public.recipe_items ri
set workspace_id = r.workspace_id,
    business_id = r.business_id,
    location_id = r.location_id
from public.recipes r
where r.id = ri.recipe_id;

alter table public.recipe_items
  alter column workspace_id set not null,
  add constraint recipe_items_recipe_workspace_fkey foreign key (recipe_id, workspace_id)
    references public.recipes(id, workspace_id) on delete cascade,
  add constraint recipe_items_recipe_business_fkey foreign key (recipe_id, workspace_id, business_id)
    references public.recipes(id, workspace_id, business_id) on delete cascade,
  add constraint recipe_items_recipe_scope_fkey foreign key (recipe_id, workspace_id, business_id, location_id)
    references public.recipes(id, workspace_id, business_id, location_id) on delete cascade,
  add constraint recipe_items_product_workspace_fkey foreign key (product_id, workspace_id)
    references public.products(id, workspace_id) on delete restrict,
  add constraint recipe_items_product_business_fkey foreign key (product_id, workspace_id, business_id)
    references public.products(id, workspace_id, business_id) on delete restrict,
  add constraint recipe_items_product_scope_fkey foreign key (product_id, workspace_id, business_id, location_id)
    references public.products(id, workspace_id, business_id, location_id) on delete restrict,
  add constraint recipe_items_ingredient_workspace_fkey foreign key (ingredient_id, workspace_id)
    references public.ingredients(id, workspace_id) on delete restrict,
  add constraint recipe_items_ingredient_business_fkey foreign key (ingredient_id, workspace_id, business_id)
    references public.ingredients(id, workspace_id, business_id) on delete restrict,
  add constraint recipe_items_ingredient_scope_fkey foreign key (ingredient_id, workspace_id, business_id, location_id)
    references public.ingredients(id, workspace_id, business_id, location_id) on delete restrict,
  add constraint recipe_items_location_requires_business check (location_id is null or business_id is not null),
  add constraint recipe_items_quantity_positive check (quantity > 0),
  add constraint recipe_items_waste_range check (waste_percentage >= 0 and waste_percentage < 100),
  add constraint recipe_items_line_order_nonnegative check (line_order >= 0);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid not null,
  location_id uuid,
  recipe_id uuid not null,
  name text not null,
  category text,
  external_code text,
  selling_price numeric not null,
  vat_rate numeric not null default 9,
  active boolean not null default true,
  valid_from date not null default current_date,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id, business_id, location_id),
  foreign key (business_id, workspace_id)
    references public.businesses(id, workspace_id) on delete cascade,
  foreign key (location_id, workspace_id, business_id)
    references public.business_locations(id, workspace_id, business_id) on delete cascade,
  foreign key (recipe_id, workspace_id)
    references public.recipes(id, workspace_id) on delete restrict,
  foreign key (recipe_id, workspace_id, business_id)
    references public.recipes(id, workspace_id, business_id) on delete restrict,
  foreign key (recipe_id, workspace_id, business_id, location_id)
    references public.recipes(id, workspace_id, business_id, location_id) on delete restrict,
  check (selling_price >= 0),
  check (vat_rate >= 0 and vat_rate <= 100),
  check (valid_until is null or valid_until >= valid_from)
);

create index suppliers_foodcost_scope_idx on public.suppliers(workspace_id, business_id, location_id, active);
create index products_foodcost_scope_idx on public.products(workspace_id, business_id, location_id, supplier_id, active);
create unique index products_scope_barcode_unique
  on public.products(workspace_id, business_id, location_id, barcode) where barcode is not null;
create index recipes_foodcost_scope_idx on public.recipes(workspace_id, business_id, location_id, active);
create index ingredients_scope_idx on public.ingredients(workspace_id, business_id, location_id, active);
create index ingredients_product_idx on public.ingredients(product_id);
create index recipe_items_scope_idx on public.recipe_items(workspace_id, business_id, location_id, recipe_id, line_order);
create index recipe_items_product_idx on public.recipe_items(product_id);
create index recipe_items_ingredient_idx on public.recipe_items(ingredient_id) where ingredient_id is not null;
create index menu_items_scope_idx on public.menu_items(workspace_id, business_id, location_id, active);
create index menu_items_recipe_idx on public.menu_items(recipe_id);

insert into public.role_permissions (workspace_id, role_id, permission)
select r.workspace_id, r.id, permission
from public.roles r
cross join lateral unnest(case r.role_key
  when 'owner' then array['foodcost:read', 'foodcost:manage']
  when 'manager' then array['foodcost:read', 'foodcost:manage']
  when 'kitchen_manager' then array['foodcost:read', 'foodcost:manage']
  when 'accountant' then array['foodcost:read']
  else array[]::text[]
end) permission
where r.is_system
on conflict (role_id, permission) do nothing;

alter table public.ingredients enable row level security;
alter table public.menu_items enable row level security;

create policy suppliers_foodcost_scope on public.suppliers as restrictive for all to authenticated
  using (private.has_permission(workspace_id, 'foodcost:read', business_id, location_id))
  with check (private.has_permission(workspace_id, 'foodcost:manage', business_id, location_id));
create policy products_foodcost_scope on public.products as restrictive for all to authenticated
  using (private.has_permission(workspace_id, 'foodcost:read', business_id, location_id))
  with check (private.has_permission(workspace_id, 'foodcost:manage', business_id, location_id));
create policy recipes_foodcost_scope on public.recipes as restrictive for all to authenticated
  using (private.has_permission(workspace_id, 'foodcost:read', business_id, location_id))
  with check (private.has_permission(workspace_id, 'foodcost:manage', business_id, location_id));
create policy recipe_items_foodcost_scope on public.recipe_items as restrictive for all to authenticated
  using (private.has_permission(workspace_id, 'foodcost:read', business_id, location_id))
  with check (private.has_permission(workspace_id, 'foodcost:manage', business_id, location_id));

create policy ingredients_read on public.ingredients for select to authenticated
  using (private.has_permission(workspace_id, 'foodcost:read', business_id, location_id));
create policy ingredients_manage on public.ingredients for all to authenticated
  using (private.has_permission(workspace_id, 'foodcost:manage', business_id, location_id))
  with check (private.has_permission(workspace_id, 'foodcost:manage', business_id, location_id));
create policy menu_items_read on public.menu_items for select to authenticated
  using (private.has_permission(workspace_id, 'foodcost:read', business_id, location_id));
create policy menu_items_manage on public.menu_items for all to authenticated
  using (private.has_permission(workspace_id, 'foodcost:manage', business_id, location_id))
  with check (private.has_permission(workspace_id, 'foodcost:manage', business_id, location_id));

revoke all on public.ingredients, public.menu_items from anon;
grant select, insert, update, delete on public.ingredients, public.menu_items to authenticated;

create trigger set_updated_at_ingredients before update on public.ingredients
  for each row execute function public.set_updated_at();
create trigger set_updated_at_menu_items before update on public.menu_items
  for each row execute function public.set_updated_at();
create trigger audit_ingredients after insert or update or delete on public.ingredients
  for each row execute function private.audit_row_change();
create trigger audit_recipe_items after insert or update or delete on public.recipe_items
  for each row execute function private.audit_row_change();
create trigger audit_menu_items after insert or update or delete on public.menu_items
  for each row execute function private.audit_row_change();

comment on table public.ingredients is
  'Costing abstraction for a purchasable product, normalized to a recipe base unit and usable yield.';
comment on table public.recipe_items is
  'Scoped recipe lines. product_id remains for backwards compatibility; ingredient_id is the normalized costing link.';
comment on table public.menu_items is
  'Sellable menu entries linked to a scoped recipe; no POS or external provider integration is activated.';
