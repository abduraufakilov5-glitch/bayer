-- Every historical and future order product is available for reuse in the catalog.
alter table public.buyer_catalog_products
  alter column price_cny drop not null;

insert into public.buyer_catalog_products(
  owner_id, name, price_cny, work_price_somoni, weight_grams,
  supplier_url, image_path, active, created_at, updated_at
)
select distinct on (o.owner_id, p.image_path)
  o.owner_id, p.name, p.price_cny, coalesce(p.work_price_somoni, 0),
  coalesce(p.weight_grams, 80), p.supplier_url, p.image_path, true,
  p.created_at, p.created_at
from public.buyer_products p
join public.buyer_orders o on o.id = p.order_id
where not exists (
  select 1 from public.buyer_catalog_products c
  where c.owner_id = o.owner_id and c.image_path = p.image_path
)
order by o.owner_id, p.image_path, p.created_at desc;

update public.buyer_products p
set catalog_product_id = (
  select c.id
  from public.buyer_catalog_products c
  join public.buyer_orders o on o.id = p.order_id
  where c.owner_id = o.owner_id and c.image_path = p.image_path
  order by c.created_at desc
  limit 1
)
where p.catalog_product_id is null;

create or replace function public.add_buyer_product_to_catalog()
returns trigger language plpgsql set search_path = '' as $$
declare target_owner uuid;
begin
  if new.catalog_product_id is not null then return new; end if;
  select o.owner_id into target_owner from public.buyer_orders o where o.id = new.order_id;
  if target_owner is null then raise exception 'Order owner not found'; end if;
  insert into public.buyer_catalog_products(
    owner_id, name, price_cny, work_price_somoni, weight_grams,
    supplier_url, image_path
  ) values (
    target_owner, new.name, new.price_cny, coalesce(new.work_price_somoni, 0),
    coalesce(new.weight_grams, 80), new.supplier_url, new.image_path
  ) returning id into new.catalog_product_id;
  return new;
end $$;

drop trigger if exists buyer_product_add_to_catalog on public.buyer_products;
create trigger buyer_product_add_to_catalog
  before insert on public.buyer_products
  for each row execute function public.add_buyer_product_to_catalog();

revoke all on function public.add_buyer_product_to_catalog() from public, anon, authenticated;
