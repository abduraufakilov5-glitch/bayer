create table if not exists public.buyer_catalog_products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  price_cny numeric(12,2) not null check (price_cny >= 0),
  work_price_somoni numeric(12,2) not null default 0 check (work_price_somoni >= 0),
  weight_grams integer not null default 80 check (weight_grams > 0 and weight_grams <= 5000),
  supplier_url text,
  image_path text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.buyer_products
  add column if not exists catalog_product_id uuid references public.buyer_catalog_products(id) on delete set null,
  add column if not exists price_cny numeric(12,2) check (price_cny is null or price_cny >= 0),
  add column if not exists cargo_cost numeric(12,2) check (cargo_cost is null or cargo_cost >= 0),
  add column if not exists work_price_somoni numeric(12,2) check (work_price_somoni is null or work_price_somoni >= 0),
  add column if not exists weight_grams integer check (weight_grams is null or (weight_grams > 0 and weight_grams <= 5000));

create index if not exists buyer_catalog_owner_active_idx on public.buyer_catalog_products(owner_id, active, created_at desc);
create index if not exists buyer_products_catalog_product_id_idx on public.buyer_products(catalog_product_id);

alter table public.buyer_catalog_products enable row level security;
revoke all on table public.buyer_catalog_products from anon;
grant select, insert, update, delete on public.buyer_catalog_products to authenticated;

drop policy if exists buyer_catalog_select_own on public.buyer_catalog_products;
create policy buyer_catalog_select_own on public.buyer_catalog_products
  for select to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists buyer_catalog_insert_own on public.buyer_catalog_products;
create policy buyer_catalog_insert_own on public.buyer_catalog_products
  for insert to authenticated with check ((select auth.uid()) = owner_id);

drop policy if exists buyer_catalog_update_own on public.buyer_catalog_products;
create policy buyer_catalog_update_own on public.buyer_catalog_products
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists buyer_catalog_delete_own on public.buyer_catalog_products;
create policy buyer_catalog_delete_own on public.buyer_catalog_products
  for delete to authenticated using ((select auth.uid()) = owner_id);

drop trigger if exists buyer_catalog_set_updated_at on public.buyer_catalog_products;
create trigger buyer_catalog_set_updated_at
  before update on public.buyer_catalog_products
  for each row execute function public.set_updated_at();
