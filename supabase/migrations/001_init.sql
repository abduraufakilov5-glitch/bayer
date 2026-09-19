create extension if not exists pgcrypto;

do $$ begin
  create type public.order_status as enum ('draft', 'waiting', 'received', 'ordered', 'completed');
exception when duplicate_object then null;
end $$;

create table if not exists public.buyer_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  order_number bigint generated always as identity unique,
  title text not null check (char_length(title) between 1 and 140),
  public_token uuid not null default gen_random_uuid() unique,
  status public.order_status not null default 'draft',
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.buyer_products (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.buyer_orders(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  price numeric(12,2) check (price is null or price >= 0),
  supplier_url text,
  image_path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.buyer_submissions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.buyer_orders(id) on delete cascade,
  total_quantity integer not null default 0 check (total_quantity > 0),
  confirmed_at timestamptz not null default now(),
  telegram_notified_at timestamptz
);

create table if not exists public.buyer_submission_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.buyer_submissions(id) on delete cascade,
  product_id uuid references public.buyer_products(id) on delete set null,
  product_name text not null,
  price numeric(12,2),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);

create index if not exists orders_owner_id_idx on public.buyer_orders(owner_id);
create index if not exists products_order_id_idx on public.buyer_products(order_id);
create index if not exists submissions_order_id_idx on public.buyer_submissions(order_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.buyer_orders;
create trigger orders_set_updated_at before update on public.buyer_orders for each row execute function public.set_updated_at();

alter table public.buyer_orders enable row level security;
alter table public.buyer_products enable row level security;
alter table public.buyer_submissions enable row level security;
alter table public.buyer_submission_items enable row level security;

revoke all on table public.buyer_orders, public.buyer_products, public.buyer_submissions, public.buyer_submission_items from anon;
grant select, insert, update, delete on public.buyer_orders to authenticated;
grant select, insert, update, delete on public.buyer_products to authenticated;
grant select on public.buyer_submissions, public.buyer_submission_items to authenticated;
grant usage, select on sequence public.buyer_orders_order_number_seq to authenticated;

drop policy if exists orders_select_own on public.buyer_orders;
create policy orders_select_own on public.buyer_orders for select to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists orders_insert_own on public.buyer_orders;
create policy orders_insert_own on public.buyer_orders for insert to authenticated with check ((select auth.uid()) = owner_id);
drop policy if exists orders_update_own on public.buyer_orders;
create policy orders_update_own on public.buyer_orders for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists orders_delete_own on public.buyer_orders;
create policy orders_delete_own on public.buyer_orders for delete to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists products_select_own on public.buyer_products;
create policy products_select_own on public.buyer_products for select to authenticated using (exists (select 1 from public.buyer_orders o where o.id = products.order_id and o.owner_id = (select auth.uid())));
drop policy if exists products_insert_own on public.buyer_products;
create policy products_insert_own on public.buyer_products for insert to authenticated with check (exists (select 1 from public.buyer_orders o where o.id = products.order_id and o.owner_id = (select auth.uid())));
drop policy if exists products_update_own on public.buyer_products;
create policy products_update_own on public.buyer_products for update to authenticated using (exists (select 1 from public.buyer_orders o where o.id = products.order_id and o.owner_id = (select auth.uid()))) with check (exists (select 1 from public.buyer_orders o where o.id = products.order_id and o.owner_id = (select auth.uid())));
drop policy if exists products_delete_own on public.buyer_products;
create policy products_delete_own on public.buyer_products for delete to authenticated using (exists (select 1 from public.buyer_orders o where o.id = products.order_id and o.owner_id = (select auth.uid())));

drop policy if exists submissions_select_own on public.buyer_submissions;
create policy submissions_select_own on public.buyer_submissions for select to authenticated using (exists (select 1 from public.buyer_orders o where o.id = order_submissions.order_id and o.owner_id = (select auth.uid())));

drop policy if exists submission_items_select_own on public.buyer_submission_items;
create policy submission_items_select_own on public.buyer_submission_items for select to authenticated using (exists (select 1 from public.buyer_submissions s join public.buyer_orders o on o.id = s.order_id where s.id = order_submission_items.submission_id and o.owner_id = (select auth.uid())));

insert into storage.buckets (id, name, public) values ('buyer-product-images', 'buyer-product-images', false) on conflict (id) do nothing;

revoke all on storage.objects from anon;
grant select, insert, update, delete on storage.objects to authenticated;

drop policy if exists product_images_select_own on storage.objects;
create policy product_images_select_own on storage.objects for select to authenticated using (bucket_id = 'buyer-product-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists product_images_insert_own on storage.objects;
create policy product_images_insert_own on storage.objects for insert to authenticated with check (bucket_id = 'buyer-product-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists product_images_update_own on storage.objects;
create policy product_images_update_own on storage.objects for update to authenticated using (bucket_id = 'buyer-product-images' and (storage.foldername(name))[1] = (select auth.uid())::text) with check (bucket_id = 'buyer-product-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists product_images_delete_own on storage.objects;
create policy product_images_delete_own on storage.objects for delete to authenticated using (bucket_id = 'buyer-product-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create or replace function public.submit_buyer_order(p_token uuid, p_items jsonb)
returns table(submission_id uuid, order_id uuid, order_number bigint, total_quantity integer, confirmed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.buyer_orders%rowtype;
  new_submission_id uuid;
  new_confirmed_at timestamptz;
  total integer;
begin
  select * into target_order from public.buyer_orders where public_token = p_token and status = 'waiting' for update;
  if not found then raise exception 'Order is not available'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Invalid items'; end if;

  insert into public.buyer_submissions(order_id, total_quantity)
  values (target_order.id, 1)
  returning id, confirmed_at into new_submission_id, new_confirmed_at;

  insert into public.buyer_submission_items(submission_id, product_id, product_name, price, quantity)
  select new_submission_id, p.id, p.name, p.price,
         least(99, greatest(1, (item->>'quantity')::integer))
  from jsonb_array_elements(p_items) item
  join public.buyer_products p on p.id = (item->>'product_id')::uuid and p.order_id = target_order.id
  where (item->>'quantity')::integer > 0;

  select coalesce(sum(quantity), 0) into total from public.buyer_submission_items where submission_id = new_submission_id;
  if total = 0 then
    delete from public.buyer_submissions where id = new_submission_id;
    raise exception 'No items selected';
  end if;

  update public.buyer_submissions set total_quantity = total where id = new_submission_id;
  update public.buyer_orders set status = 'received', confirmed_at = new_confirmed_at where id = target_order.id;

  return query select new_submission_id, target_order.id, target_order.order_number, total, new_confirmed_at;
exception when unique_violation then
  raise exception 'Order already submitted';
end;
$$;

revoke all on function public.submit_buyer_order(uuid, jsonb) from public;
revoke execute on function public.submit_buyer_order(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_buyer_order(uuid, jsonb) to service_role;
