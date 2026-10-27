-- Additive wallet: legacy order workflow and historical receipts remain intact.
alter table public.buyer_catalog_products alter column weight_grams set default 120;
alter table public.buyer_products
  add column purchase_cost_tjs numeric(12,2) check (purchase_cost_tjs >= 0),
  add column cny_rate numeric(16,6) check (cny_rate > 0),
  add column usd_rate numeric(16,6) check (usd_rate > 0);

create table public.wallet_accounts (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  name text not null check (length(trim(name)) between 1 and 80),
  currency text not null default 'TJS' check (currency in ('TJS','USD','CNY','RUB')),
  opening_balance numeric(14,2) not null default 0, created_at timestamptz not null default now(),
  unique(owner_id,id)
);
create table public.wallet_debts (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  person text not null check (length(trim(person)) between 1 and 140),
  direction text not null check (direction in ('receivable','payable')),
  amount_tjs numeric(14,2) not null check(amount_tjs > 0),
  due_date date, note text not null default '' check(length(note)<=1000),
  created_at timestamptz not null default now(), cancelled_at timestamptz, unique(owner_id,id)
);
create table public.wallet_entries (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  account_id uuid not null, to_account_id uuid,
  kind text not null check (kind in ('income','expense','transfer','loan_in','loan_out','debt_receive','debt_pay','order_payment','order_refund','expense_refund')),
  amount numeric(14,2) not null check(amount>0), rate numeric(16,6) not null check(rate>0),
  to_amount numeric(14,2) check(to_amount>0),
  category text not null default 'Другое' check(length(category) between 1 and 80),
  note text not null default '' check(length(note)<=1000),
  entry_date date not null default (now() at time zone 'Asia/Dushanbe')::date,
  planned boolean not null default false, order_id uuid references public.buyer_orders(id), debt_id uuid,
  created_at timestamptz not null default now(), voided_at timestamptz,
  foreign key(owner_id,account_id) references public.wallet_accounts(owner_id,id),
  foreign key(owner_id,to_account_id) references public.wallet_accounts(owner_id,id),
  foreign key(owner_id,debt_id) references public.wallet_debts(owner_id,id),
  check((kind='transfer' and to_account_id is not null and to_amount is not null and to_account_id<>account_id) or (kind<>'transfer' and to_account_id is null and to_amount is null)),
  check((kind in ('debt_receive','debt_pay','loan_in','loan_out')) = (debt_id is not null)),
  check(kind not in ('order_payment','order_refund') or order_id is not null),
  check(not planned or kind in ('income','expense')),
  check(entry_date <= (now() at time zone 'Asia/Dushanbe')::date or planned)
);
create table public.wallet_order_settings (
  order_id uuid primary key references public.buyer_orders(id),
  owner_id uuid not null references auth.users(id), cancelled boolean not null default false,
  actual_weight_grams integer check(actual_weight_grams between 1 and 100000000),
  cargo_rate_tjs numeric(14,6) check(cargo_rate_tjs>0)
);
create table public.wallet_rates (
  owner_id uuid primary key references auth.users(id), usd numeric not null check(usd>0),
  cny numeric not null check(cny>0), rub numeric not null check(rub>0),
  date date not null, fetched_at timestamptz not null, source text not null
);
create index wallet_entries_owner_date on public.wallet_entries(owner_id,entry_date desc);
create index wallet_entries_account on public.wallet_entries(account_id);
create index wallet_entries_to_account on public.wallet_entries(to_account_id);
create index wallet_entries_debt on public.wallet_entries(debt_id);
create index wallet_entries_order on public.wallet_entries(order_id);
create index wallet_order_owner on public.wallet_order_settings(owner_id);
create index wallet_debts_owner on public.wallet_debts(owner_id);

alter table public.wallet_accounts enable row level security;
alter table public.wallet_debts enable row level security;
alter table public.wallet_entries enable row level security;
alter table public.wallet_order_settings enable row level security;
alter table public.wallet_rates enable row level security;
create policy own_accounts on public.wallet_accounts for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy own_debts on public.wallet_debts for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy own_entries on public.wallet_entries for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy own_order_settings on public.wallet_order_settings for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()) and exists(select 1 from public.buyer_orders o where o.id=order_id and o.owner_id=(select auth.uid())));
create policy own_rates on public.wallet_rates for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on public.wallet_accounts,public.wallet_debts,public.wallet_entries,public.wallet_order_settings,public.wallet_rates from anon;
grant select,insert,update on public.wallet_accounts,public.wallet_debts,public.wallet_entries,public.wallet_order_settings,public.wallet_rates to authenticated;

-- Serialize each owner's ledger writes, validate linked ownership and debt settlements.
create function public.guard_wallet_entry() returns trigger language plpgsql set search_path='' as $$
declare d public.wallet_debts%rowtype; a public.wallet_accounts%rowtype; paid numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text,0));
  if tg_op='UPDATE' then
    if old.voided_at is not null then raise exception 'Voided entry is immutable'; end if;
    if (to_jsonb(new)-'voided_at') is distinct from (to_jsonb(old)-'voided_at') then raise exception 'Void and replace entries to preserve history'; end if;
    return new;
  end if;
  select * into a from public.wallet_accounts where id=new.account_id and owner_id=new.owner_id;
  if not found then raise exception 'Account unavailable'; end if;
  if a.currency='TJS' and new.rate<>1 then raise exception 'TJS rate must be 1'; end if;
  if new.order_id is not null and not exists(select 1 from public.buyer_orders where id=new.order_id and owner_id=new.owner_id) then raise exception 'Order unavailable'; end if;
  if new.debt_id is not null then
    select * into d from public.wallet_debts where id=new.debt_id and owner_id=new.owner_id for update;
    if not found or d.cancelled_at is not null then raise exception 'Debt unavailable'; end if;
    if (new.kind in ('debt_receive','loan_out') and d.direction<>'receivable') or (new.kind in ('debt_pay','loan_in') and d.direction<>'payable') then raise exception 'Wrong debt direction'; end if;
    if new.kind in ('debt_receive','debt_pay') then
      select coalesce(sum(round(amount*rate,2)),0) into paid from public.wallet_entries where debt_id=d.id and kind in ('debt_receive','debt_pay') and voided_at is null;
      if paid+round(new.amount*new.rate,2)>d.amount_tjs then raise exception 'Payment exceeds remaining debt'; end if;
    else
      if exists(select 1 from public.wallet_entries where debt_id=d.id and kind in ('loan_in','loan_out') and voided_at is null) or round(new.amount*new.rate,2)<>d.amount_tjs then raise exception 'Invalid loan principal'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger wallet_entry_guard before insert or update on public.wallet_entries for each row execute function public.guard_wallet_entry();

-- Debts are opening obligations; loan entries are optional and affect cash only once.
create function public.wallet_record_loan(p_person text,p_direction text,p_amount numeric,p_due date,p_note text,p_account uuid default null,p_cash_amount numeric default null,p_rate numeric default 1)
returns uuid language plpgsql security invoker set search_path='' as $$
declare d uuid;
begin
  insert into public.wallet_debts(owner_id,person,direction,amount_tjs,due_date,note) values(auth.uid(),p_person,p_direction,p_amount,p_due,p_note) returning id into d;
  if p_account is not null then
    insert into public.wallet_entries(owner_id,account_id,kind,amount,rate,category,note,debt_id)
      values(auth.uid(),p_account,case when p_direction='receivable' then 'loan_out' else 'loan_in' end,p_cash_amount,p_rate,'Долги',p_note,d);
  end if;
  return d;
end $$;
revoke all on function public.wallet_record_loan(text,text,numeric,date,text,uuid,numeric,numeric) from public,anon;
grant execute on function public.wallet_record_loan(text,text,numeric,date,text,uuid,numeric,numeric) to authenticated;

-- A plan is realized on its existing row: no second payment can be created by retry.
create function public.wallet_realize_plan(p_id uuid,p_date date)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  -- Replace the plan with a linked, deterministic actual entry, then void the plan.
  insert into public.wallet_entries(id,owner_id,account_id,kind,amount,rate,category,note,entry_date,order_id)
    select md5(id::text || ':actual')::uuid,owner_id,account_id,case when kind='income' and order_id is not null then 'order_payment' else kind end,amount,rate,category,note,p_date,order_id
    from public.wallet_entries where id=p_id and owner_id=auth.uid() and planned and voided_at is null
    on conflict(id) do nothing;
  update public.wallet_entries set voided_at=now() where id=p_id and owner_id=auth.uid() and planned and voided_at is null;
end $$;
revoke all on function public.wallet_realize_plan(uuid,date) from public,anon;
grant execute on function public.wallet_realize_plan(uuid,date) to authenticated;

-- Use new purchase snapshots; retain the historical 1.4 fallback for old products.
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
           case when p.price_cny is null then null else round((coalesce(p.purchase_cost_tjs, p.price_cny * 1.4) + coalesce(p.cargo_cost, 0))::numeric, 2) end,
           coalesce(p.work_price_somoni, 0)
    from jsonb_array_elements(p_items) i
    join public.buyer_products p on p.id = (i->>'product_id')::uuid and p.order_id = target.id;
  update public.buyer_orders o set status = 'received', confirmed_at = receipt.confirmed_at where o.id = target.id;
  return query select receipt.id, target.id, target.order_number, receipt.total_quantity, receipt.confirmed_at;
end $$;

revoke all on function public.submit_buyer_order(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_buyer_order(uuid, jsonb) to service_role;

revoke update on public.wallet_debts from authenticated;
create function public.wallet_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object(
  'accounts',coalesce((select jsonb_agg(a order by a.created_at) from public.wallet_accounts a where a.owner_id=auth.uid()),'[]'::jsonb),
  'entries',coalesce((select jsonb_agg(e order by e.entry_date desc,e.created_at desc) from public.wallet_entries e where e.owner_id=auth.uid()),'[]'::jsonb),
  'debts',coalesce((select jsonb_agg(d order by d.created_at desc) from public.wallet_debts d where d.owner_id=auth.uid()),'[]'::jsonb),
  'settings',coalesce((select jsonb_agg(s) from public.wallet_order_settings s where s.owner_id=auth.uid()),'[]'::jsonb),
  'orders',coalesce((select jsonb_agg(row_to_json(x)) from (
    select o.id,o.title,o.order_number,o.status,o.deleted_at,
      (select case when count(*)=count(si.price) then sum(si.price*si.quantity) end from public.buyer_submissions s join public.buyer_submission_items si on si.submission_id=s.id where s.order_id=o.id) revenue,
      (select case when count(*)=count(si.cost_price) then sum(si.cost_price*si.quantity) end from public.buyer_submissions s join public.buyer_submission_items si on si.submission_id=s.id where s.order_id=o.id) costs,
      (select case when count(*)=count(p.cargo_cost) then sum(p.cargo_cost*si.quantity) end from public.buyer_submissions s join public.buyer_submission_items si on si.submission_id=s.id left join public.buyer_products p on p.id=si.product_id where s.order_id=o.id) cargo,
      (select sum(p.weight_grams*si.quantity) from public.buyer_submissions s join public.buyer_submission_items si on si.submission_id=s.id left join public.buyer_products p on p.id=si.product_id where s.order_id=o.id) weight
    from public.buyer_orders o where o.owner_id=auth.uid()
  ) x),'[]'::jsonb)
)
$$;
revoke all on function public.wallet_snapshot() from public,anon;
grant execute on function public.wallet_snapshot() to authenticated;
create function public.wallet_replace_entry(p_original uuid,p_entry jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  update public.wallet_entries set voided_at=now() where id=p_original and owner_id=auth.uid() and voided_at is null;
  if not found then raise exception 'Entry already changed'; end if;
  insert into public.wallet_entries(owner_id,account_id,to_account_id,kind,amount,rate,to_amount,category,note,entry_date,planned,order_id,debt_id)
  values(auth.uid(),(p_entry->>'account_id')::uuid,(p_entry->>'to_account_id')::uuid,p_entry->>'kind',(p_entry->>'amount')::numeric,(p_entry->>'rate')::numeric,(p_entry->>'to_amount')::numeric,p_entry->>'category',p_entry->>'note',(p_entry->>'entry_date')::date,(p_entry->>'planned')::boolean,(p_entry->>'order_id')::uuid,(p_entry->>'debt_id')::uuid);
end $$;
revoke all on function public.wallet_replace_entry(uuid,jsonb) from public,anon;
grant execute on function public.wallet_replace_entry(uuid,jsonb) to authenticated;

grant update(cancelled_at) on public.wallet_debts to authenticated;
create function public.wallet_cancel_debt(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  update public.wallet_entries set voided_at=now() where debt_id=p_id and owner_id=auth.uid() and voided_at is null;
  update public.wallet_debts set cancelled_at=now() where id=p_id and owner_id=auth.uid() and cancelled_at is null;
end $$;
revoke all on function public.wallet_cancel_debt(uuid) from public,anon;
grant execute on function public.wallet_cancel_debt(uuid) to authenticated;
