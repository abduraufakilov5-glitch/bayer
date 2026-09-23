-- Optional prices: preserve all existing prices, ownership checks and atomic confirmation.
create or replace function public.guard_buyer_order()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Published orders cannot be deleted'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.confirmed_at is not null then raise exception 'New orders must be drafts'; end if;
    return new;
  end if;
  if new.owner_id <> old.owner_id or new.id <> old.id or new.public_token <> old.public_token
     or new.order_number <> old.order_number then raise exception 'Order identity is immutable'; end if;
  if old.status <> 'draft' and new.title <> old.title then raise exception 'Published orders are immutable'; end if;
  if new.confirmed_at is distinct from old.confirmed_at and not (old.status = 'waiting' and new.status = 'received') then
    raise exception 'Confirmation time is immutable';
  end if;
  if new.status <> old.status then
    if old.status = 'draft' and new.status = 'waiting' then
      if not exists(select 1 from public.buyer_products p where p.order_id = old.id)
         or (select count(*) from public.buyer_products p where p.order_id = old.id) > 300 then
        raise exception 'Add 1 to 300 products before publishing';
      end if;
    elsif old.status = 'waiting' and new.status = 'received' then
      if not exists(select 1 from public.buyer_submissions s where s.order_id = old.id and s.confirmed_at = new.confirmed_at) then
        raise exception 'A client submission is required';
      end if;
    elsif not ((old.status = 'received' and new.status = 'ordered') or (old.status = 'ordered' and new.status = 'completed')) then
      raise exception 'Invalid status transition';
    end if;
  end if;
  return new;
end $$;

create or replace function public.submit_buyer_order(p_token uuid, p_items jsonb)
returns table(submission_id uuid, order_id uuid, order_number bigint, total_quantity integer, confirmed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  target public.buyer_orders%rowtype;
  receipt public.buyer_submissions%rowtype;
  item jsonb;
  ids uuid[] := '{}';
  item_id uuid;
  qty integer;
  total integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Invalid items'; end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 300 then raise exception 'Invalid items'; end if;
  for item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'product_id') is distinct from 'string'
       or jsonb_typeof(item->'quantity') is distinct from 'number'
       or (item->>'quantity') !~ '^[0-9]{1,2}$'
       or (item->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid items'; end if;
    item_id := (item->>'product_id')::uuid;
    qty := (item->>'quantity')::integer;
    if qty < 1 or qty > 99 or item_id = any(ids) then raise exception 'Invalid items'; end if;
    ids := array_append(ids, item_id);
    total := total + qty;
  end loop;

  -- Serializes confirmation, publication and product writes for this order.
  select * into target from public.buyer_orders o where o.public_token = p_token for update;
  if not found or target.status = 'draft' then raise exception 'Order is not available'; end if;
  if target.status <> 'waiting' then
    select * into receipt from public.buyer_submissions s where s.order_id = target.id;
    -- Retrying the same request after a lost response is safe, including later statuses.
    if found and (select count(*) from public.buyer_submission_items si where si.submission_id = receipt.id) = cardinality(ids)
      and not exists(select 1 from jsonb_array_elements(p_items) i where not exists(
        select 1 from public.buyer_submission_items si where si.submission_id = receipt.id
        and si.product_id = (i->>'product_id')::uuid and si.quantity = (i->>'quantity')::integer)) then
      return query select receipt.id, target.id, target.order_number, receipt.total_quantity, receipt.confirmed_at;
      return;
    end if;
    raise exception 'Order already submitted';
  end if;
  if (select count(*) from public.buyer_products p where p.order_id = target.id and p.id = any(ids)) <> cardinality(ids) then raise exception 'Invalid items'; end if;

  insert into public.buyer_submissions(order_id, total_quantity) values (target.id, total) returning * into receipt;
  insert into public.buyer_submission_items(submission_id, product_id, product_name, price, quantity)
    select receipt.id, p.id, p.name, p.price, (i->>'quantity')::integer
    from jsonb_array_elements(p_items) i join public.buyer_products p on p.id = (i->>'product_id')::uuid and p.order_id = target.id;
  update public.buyer_orders o set status = 'received', confirmed_at = receipt.confirmed_at where o.id = target.id;
  return query select receipt.id, target.id, target.order_number, receipt.total_quantity, receipt.confirmed_at;
end $$;
revoke all on function public.submit_buyer_order(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_buyer_order(uuid, jsonb) to service_role;
revoke all on function public.guard_buyer_order(), public.guard_buyer_product() from public, anon, authenticated;

-- Server-only notification lease; client roles still have SELECT only.
alter table public.buyer_submissions add column if not exists telegram_claimed_at timestamptz;
