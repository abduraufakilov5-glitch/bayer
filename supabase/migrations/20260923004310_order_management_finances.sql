alter table public.buyer_orders
  add column if not exists deleted_at timestamptz;

create index if not exists buyer_orders_owner_deleted_created_idx
  on public.buyer_orders(owner_id, deleted_at, created_at desc);

alter table public.buyer_submission_items
  add column if not exists cost_price numeric(12,2) check (cost_price is null or cost_price >= 0),
  add column if not exists buyer_earnings numeric(12,2) check (buyer_earnings is null or buyer_earnings >= 0);

-- Preserve the known economics of already confirmed orders. These rows are
-- snapshots, so later catalog edits cannot rewrite historical profit.
update public.buyer_submission_items si
set cost_price = case when p.price_cny is null then null else round((p.price_cny * 1.4 + coalesce(p.cargo_cost, 0))::numeric, 2) end,
    buyer_earnings = coalesce(p.work_price_somoni, 0)
from public.buyer_products p
where p.id = si.product_id
  and (si.cost_price is null or si.buyer_earnings is null);

create or replace function public.guard_buyer_order()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Published orders cannot be permanently deleted'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.confirmed_at is not null or new.deleted_at is not null then
      raise exception 'New orders must be active drafts';
    end if;
    return new;
  end if;
  if new.owner_id <> old.owner_id or new.id <> old.id or new.public_token <> old.public_token
     or new.order_number <> old.order_number then raise exception 'Order identity is immutable'; end if;
  if new.confirmed_at is distinct from old.confirmed_at and not (old.status = 'waiting' and new.status = 'received') then
    raise exception 'Confirmation time is immutable';
  end if;
  if old.deleted_at is not null and new.deleted_at is not null
     and (new.status is distinct from old.status or new.title is distinct from old.title) then
    raise exception 'Deleted orders are immutable until restored';
  end if;
  if new.status <> old.status then
    if old.deleted_at is not null or new.deleted_at is not null then raise exception 'Deleted orders cannot change status'; end if;
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

  select * into target from public.buyer_orders o
  where o.public_token = p_token and o.deleted_at is null for update;
  if not found or target.status = 'draft' then raise exception 'Order is not available'; end if;
  if target.status <> 'waiting' then
    select * into receipt from public.buyer_submissions s where s.order_id = target.id;
    if found and (select count(*) from public.buyer_submission_items si where si.submission_id = receipt.id) = cardinality(ids)
      and not exists(select 1 from jsonb_array_elements(p_items) i where not exists(
        select 1 from public.buyer_submission_items si where si.submission_id = receipt.id
        and si.product_id = (i->>'product_id')::uuid and si.quantity = (i->>'quantity')::integer)) then
      return query select receipt.id, target.id, target.order_number, receipt.total_quantity, receipt.confirmed_at;
      return;
    end if;
    raise exception 'Order already submitted';
  end if;
  if (select count(*) from public.buyer_products p where p.order_id = target.id and p.id = any(ids)) <> cardinality(ids) then
    raise exception 'Invalid items';
  end if;

  insert into public.buyer_submissions(order_id, total_quantity) values (target.id, total) returning * into receipt;
  insert into public.buyer_submission_items(
    submission_id, product_id, product_name, price, quantity, cost_price, buyer_earnings
  )
    select receipt.id, p.id, p.name, p.price, (i->>'quantity')::integer,
           case when p.price_cny is null then null else round((p.price_cny * 1.4 + coalesce(p.cargo_cost, 0))::numeric, 2) end,
           coalesce(p.work_price_somoni, 0)
    from jsonb_array_elements(p_items) i
    join public.buyer_products p on p.id = (i->>'product_id')::uuid and p.order_id = target.id;
  update public.buyer_orders o set status = 'received', confirmed_at = receipt.confirmed_at where o.id = target.id;
  return query select receipt.id, target.id, target.order_number, receipt.total_quantity, receipt.confirmed_at;
end $$;

revoke all on function public.submit_buyer_order(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_buyer_order(uuid, jsonb) to service_role;

create or replace function public.buyer_finance_summary()
returns table(
  revenue numeric, spent numeric, earned numeric,
  month_revenue numeric, month_spent numeric, month_earned numeric,
  confirmed_orders bigint
)
language sql stable security invoker set search_path = '' as $$
  select
    coalesce(sum(si.price * si.quantity), 0),
    coalesce(sum(si.cost_price * si.quantity), 0),
    coalesce(sum(si.buyer_earnings * si.quantity), 0),
    coalesce(sum(si.price * si.quantity) filter (where s.confirmed_at >= date_trunc('month', now())), 0),
    coalesce(sum(si.cost_price * si.quantity) filter (where s.confirmed_at >= date_trunc('month', now())), 0),
    coalesce(sum(si.buyer_earnings * si.quantity) filter (where s.confirmed_at >= date_trunc('month', now())), 0),
    count(distinct s.order_id)
  from public.buyer_submissions s
  join public.buyer_orders o on o.id = s.order_id
  join public.buyer_submission_items si on si.submission_id = s.id
  where o.owner_id = (select auth.uid()) and o.deleted_at is null
$$;

revoke all on function public.buyer_finance_summary() from public, anon;
grant execute on function public.buyer_finance_summary() to authenticated;
