-- Validate on a restored backup before production. Existing products own all their fields/paths.
drop trigger if exists buyer_product_add_to_catalog on public.buyer_products;
drop function if exists public.add_buyer_product_to_catalog();
alter table public.buyer_orders add column cargo_method text not null default 'auto' check(cargo_method in ('auto','air')), add column cargo_rate numeric not null default 30 check(cargo_rate>=0), add column exchange_rate numeric not null default 1.4 check(exchange_rate>0), add column revision integer not null default 1, add column edit_version integer not null default 0, add column draft_hash text, add column link_revoked boolean not null default false;
alter table public.buyer_products add column thumbnail_path text;
alter table public.buyer_submissions drop constraint buyer_submissions_order_id_key;
alter table public.buyer_submissions add column revision integer not null default 1, add column note text not null default '' check(length(note)<=1000), add column request_id uuid, add column cargo_rate numeric not null default 30, add column exchange_rate numeric not null default 1.4;
create unique index buyer_submission_revision on public.buyer_submissions(order_id,revision);
alter table public.buyer_submission_items add column note text not null default '' check(length(note)<=300), add column image_path text, add column thumbnail_path text, add column supplier_url text, add column price_cny numeric, add column cargo_cost numeric, add column work_price_somoni numeric, add column weight_grams integer;
update public.buyer_submission_items si set image_path=p.image_path,supplier_url=p.supplier_url,price_cny=p.price_cny,cargo_cost=p.cargo_cost,work_price_somoni=p.work_price_somoni,weight_grams=p.weight_grams from public.buyer_products p where p.id=si.product_id;
create table public.buyer_purchases(order_id uuid not null references public.buyer_orders(id) on delete cascade,product_id uuid primary key references public.buyer_products(id) on delete cascade,purchased_quantity integer not null default 0 check(purchased_quantity between 0 and 99),cancelled_quantity integer not null default 0 check(cancelled_quantity between 0 and 99),actual_price_cny numeric check(actual_price_cny between 0 and 1000000),actual_exchange_rate numeric check(actual_exchange_rate>0 and actual_exchange_rate<=10000),actual_cargo numeric check(actual_cargo between 0 and 1000000),extra_cost numeric not null default 0 check(extra_cost between 0 and 1000000),problem text not null default '' check(length(problem)<=300),version integer not null default 0,updated_at timestamptz not null default now());
create table public.buyer_cash_entries(id uuid primary key,order_id uuid not null references public.buyer_orders(id) on delete cascade,kind text not null check(kind in ('payment','refund','expense','expense_refund')),amount numeric not null check(amount>0 and amount<=100000000),created_at timestamptz not null default now());
create index on public.buyer_cash_entries(order_id);
create table public.buyer_financial_months(owner_id uuid not null references auth.users(id) on delete cascade,month date not null,cash_received numeric not null default 0,actual_spent numeric not null default 0,unknown_costs integer not null default 0,primary key(owner_id,month));
create table public.buyer_image_gc(path text primary key,queued_at timestamptz not null default now(),attempts integer not null default 0,retry_at timestamptz not null default now());
create table public.buyer_job_lease(name text primary key,token uuid not null,expires_at timestamptz not null);
create table public.buyer_rate_limits(key text primary key,window_start timestamptz not null,hits integer not null);
create table public.buyer_job_runs(id bigint generated always as identity primary key,ran_at timestamptz not null default now(),orders_deleted integer not null,images_deleted integer not null,failures integer not null);
do $$ declare t text; begin foreach t in array array['buyer_purchases','buyer_cash_entries','buyer_financial_months','buyer_image_gc','buyer_job_lease','buyer_rate_limits','buyer_job_runs'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);end loop;end $$;
grant select on public.buyer_purchases,public.buyer_cash_entries,public.buyer_financial_months to authenticated;
create policy buyer_purchases_owner on public.buyer_purchases for select to authenticated using(exists(select 1 from public.buyer_orders o where o.id=order_id and o.owner_id=(select auth.uid())));
create policy buyer_cash_owner on public.buyer_cash_entries for select to authenticated using(exists(select 1 from public.buyer_orders o where o.id=order_id and o.owner_id=(select auth.uid())));
create policy buyer_months_owner on public.buyer_financial_months for select to authenticated using(owner_id=(select auth.uid()));
grant all on public.buyer_image_gc,public.buyer_job_lease,public.buyer_rate_limits,public.buyer_job_runs to service_role;
grant select,update on public.buyer_submissions to service_role;
grant select on public.buyer_orders,public.buyer_products,public.buyer_submission_items to service_role;
create or replace function public.guard_buyer_product() returns trigger language plpgsql security definer set search_path='' as $$
declare target public.buyer_orders%rowtype;
begin
 if tg_op='UPDATE' and (new.order_id<>old.order_id or new.id<>old.id or new.created_at<>old.created_at) then raise exception 'Product identity is immutable';end if;
 if tg_op='DELETE' then
 select * into target from public.buyer_orders where id=old.order_id for update;
 if not found then return old;end if;
 if target.status<>'draft' then raise exception 'Published products are immutable';end if;
 if exists(select 1 from public.buyer_purchases where product_id=old.id and purchased_quantity>0) then raise exception 'Purchased product cannot be removed';end if;return old;end if;
 select * into target from public.buyer_orders where id=new.order_id for update;
 if not found or target.status<>'draft' or target.deleted_at is not null or target.created_at<=now()-interval '25 days' then raise exception 'Published products are immutable';end if;
 perform pg_advisory_xact_lock(hashtext(new.image_path));
 if new.thumbnail_path is not null then perform pg_advisory_xact_lock(hashtext(new.thumbnail_path));end if;
 if split_part(new.image_path,'/',1)<>target.owner_id::text or (new.thumbnail_path is not null and split_part(new.thumbnail_path,'/',1)<>target.owner_id::text) then raise exception 'Invalid image owner';end if;
 if exists(select 1 from public.buyer_image_gc where path in(new.image_path,new.thumbnail_path)) and (tg_op='INSERT' or (new.image_path,new.thumbnail_path) is distinct from (old.image_path,old.thumbnail_path)) then raise exception 'Image is being deleted; upload again';end if;
 if new.supplier_url is not null and (length(new.supplier_url)>2048 or new.supplier_url !~ '^https?://') then raise exception 'Invalid supplier URL';end if;
 if new.price_cny is not null then
 new.cargo_cost:=round(new.weight_grams::numeric/1000*target.cargo_rate,2);new.price:=round(new.price_cny*target.exchange_rate+new.cargo_cost+new.work_price_somoni,2);
 elsif tg_op='INSERT' then new.price:=null;end if;
 return new;
end $$;
create or replace function public.guard_buyer_order() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then if current_user in ('authenticated','anon') then raise exception 'Orders cannot be permanently deleted directly';end if;return old;end if;
 if tg_op='INSERT' then
 if new.status<>'draft' or new.confirmed_at is not null or new.deleted_at is not null or new.revision<>1 or new.edit_version<>0 then raise exception 'New orders must be active drafts';end if;new.created_at:=now();new.exchange_rate:=1.4;new.cargo_rate:=case when new.cargo_method='air' then 60 else 30 end;return new;end if;
 if new.owner_id<>old.owner_id or new.id<>old.id or new.order_number<>old.order_number or new.created_at<>old.created_at then raise exception 'Order identity is immutable';end if;
 if current_user not in ('authenticated','anon') then return new;end if;
 if new.revision<>old.revision or new.edit_version<>old.edit_version or new.public_token<>old.public_token or new.link_revoked<>old.link_revoked then raise exception 'Use controlled order actions';end if;
 if (new.cargo_method,new.cargo_rate,new.exchange_rate) is distinct from (old.cargo_method,old.cargo_rate,old.exchange_rate) then raise exception 'Use atomic draft editor';end if;
 if new.confirmed_at is distinct from old.confirmed_at then raise exception 'A client submission is required';end if;
 if new.status<>old.status then
 if old.status='draft' and new.status='waiting' then
 if not exists(select 1 from public.buyer_products where order_id=old.id) then raise exception 'Add products before publishing';end if;
 elsif (old.status='received' and new.status='ordered') or (old.status='ordered' and new.status='completed') then
 if exists(select 1 from public.buyer_submission_items si join public.buyer_submissions s on s.id=si.submission_id left join public.buyer_purchases p on p.product_id=si.product_id where s.order_id=old.id and s.revision=old.revision and coalesce(p.purchased_quantity,0)+coalesce(p.cancelled_quantity,0)<si.quantity) then raise exception 'Finish all purchase positions first';end if;
 else raise exception 'Invalid status transition';end if;end if;return new;
end $$;
create function public.buyer_save_draft(p_id uuid,p_title text,p_cargo text,p_version integer,p_products jsonb) returns public.buyer_orders language plpgsql security definer set search_path='' as $$
declare target public.buyer_orders%rowtype;item jsonb;ids uuid[]:='{}';
begin
 if auth.uid() is null then raise exception 'Unauthorized';end if;
 if p_version is null or p_version<0 then raise exception 'Invalid version';end if;
 if length(trim(p_title)) not between 1 and 140 or p_cargo not in ('auto','air') or jsonb_typeof(p_products) is distinct from 'array' or jsonb_array_length(p_products)>300 then raise exception 'Invalid draft';end if;
 insert into public.buyer_orders(id,owner_id,title) values(p_id,auth.uid(),trim(p_title)) on conflict(id) do nothing;
 select * into target from public.buyer_orders where id=p_id for update;
 if target.owner_id is distinct from auth.uid() then raise exception 'Not found';end if;
 if target.status<>'draft' or target.deleted_at is not null or target.created_at<=now()-interval '25 days' then raise exception 'Draft unavailable';end if;
 if target.edit_version=p_version+1 and target.draft_hash=md5(p_title||p_cargo||p_products::text) then return target;end if;
 if target.edit_version<>p_version then raise exception 'Draft changed in another tab; reload before saving';end if;
 update public.buyer_orders set title=trim(p_title),cargo_method=p_cargo,cargo_rate=case when p_cargo='air' then 60 else 30 end,edit_version=edit_version+1,draft_hash=md5(p_title||p_cargo||p_products::text) where id=p_id;
 for item in select * from jsonb_array_elements(p_products) loop
 if (item->>'id')::uuid=any(ids) then raise exception 'Duplicate product';end if;ids:=array_append(ids,(item->>'id')::uuid);
 if exists(select 1 from public.buyer_products where id=(item->>'id')::uuid and order_id<>p_id) then raise exception 'Invalid product';end if;
 if jsonb_typeof(item->'name') is distinct from 'string' or jsonb_typeof(item->'weight_grams') is distinct from 'number' or jsonb_typeof(item->'work_price_somoni') is distinct from 'number' or not(item ? 'price_cny') or (item->>'weight_grams') !~ '^[0-9]+$' then raise exception 'Invalid pricing';end if;
 perform pg_advisory_xact_lock(hashtext(item->>'image_path'));
 if not exists(select 1 from storage.objects where bucket_id='buyer-product-images' and name=item->>'image_path') then raise exception 'Image upload expired; upload again';end if;
 if item->>'thumbnail_path' is not null and not exists(select 1 from storage.objects where bucket_id='buyer-product-images' and name=item->>'thumbnail_path') then raise exception 'Thumbnail upload expired; upload again';end if;
 if length(trim(item->>'name')) not between 1 and 200 or (item->>'weight_grams')::int not between 1 and 5000 or (item->>'work_price_somoni')::numeric not between 0 and 1000000 or (item->>'price_cny')::numeric not between 0 and 1000000 then raise exception 'Invalid pricing';end if;
 insert into public.buyer_products(id,order_id,name,price_cny,weight_grams,work_price_somoni,image_path,thumbnail_path,supplier_url,sort_order) values((item->>'id')::uuid,p_id,trim(item->>'name'),(item->>'price_cny')::numeric,(item->>'weight_grams')::int,(item->>'work_price_somoni')::numeric,item->>'image_path',item->>'thumbnail_path',nullif(item->>'supplier_url',''),cardinality(ids)-1)
 on conflict(id) do update set name=excluded.name,price_cny=excluded.price_cny,weight_grams=excluded.weight_grams,work_price_somoni=excluded.work_price_somoni,image_path=excluded.image_path,thumbnail_path=excluded.thumbnail_path,supplier_url=excluded.supplier_url,sort_order=excluded.sort_order;
 end loop;
 delete from public.buyer_products where order_id=p_id and not(id=any(ids));select * into target from public.buyer_orders where id=p_id;return target;
end $$;
create function public.buyer_order_action(p_id uuid,p_action text) returns public.buyer_orders language plpgsql security definer set search_path='' as $$
declare target public.buyer_orders%rowtype;
begin
 select * into target from public.buyer_orders where id=p_id and owner_id=auth.uid() and deleted_at is null for update;
 if not found or target.created_at<=now()-interval '25 days' then raise exception 'Order unavailable';end if;
 if p_action='reopen' and target.status in ('waiting','received','ordered') then update public.buyer_orders set status='draft',revision=revision+1,edit_version=edit_version+1,confirmed_at=null where id=p_id;
 elsif p_action='revoke' and target.status='waiting' then update public.buyer_orders set link_revoked=true where id=p_id;
 elsif p_action='rotate' and target.status in ('draft','waiting') then update public.buyer_orders set public_token=gen_random_uuid(),link_revoked=false where id=p_id;
 elsif p_action='publish' and target.status='draft' then
 if not exists(select 1 from public.buyer_products where order_id=p_id) then raise exception 'Add products before publishing';end if;update public.buyer_orders set status='waiting',link_revoked=false where id=p_id;
 else raise exception 'Invalid order action';end if;
 select * into target from public.buyer_orders where id=p_id;return target;
end $$;
drop function public.submit_buyer_order(uuid,jsonb);
create function public.submit_buyer_order(p_token uuid,p_items jsonb,p_note text default '',p_revision integer default 1,p_request_id uuid default null)
returns table(submission_id uuid,order_id uuid,order_number bigint,total_quantity integer,confirmed_at timestamptz,item_count integer) language plpgsql security definer set search_path='' as $$
declare target public.buyer_orders%rowtype;receipt public.buyer_submissions%rowtype;item jsonb;ids uuid[]:='{}';qty integer;total integer:=0;
begin
 if p_revision is null or p_revision<1 then raise exception 'Invalid revision';end if;
 if p_note is null or length(p_note)>1000 or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 300 then raise exception 'Invalid items';end if;
 for item in select * from jsonb_array_elements(p_items) loop
 if jsonb_typeof(item->'product_id') is distinct from 'string' or jsonb_typeof(item->'quantity') is distinct from 'number' or (item->>'quantity') !~ '^[0-9]{1,2}$' or (item->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or (item ? 'note' and jsonb_typeof(item->'note')<>'string') or length(coalesce(item->>'note',''))>300 then raise exception 'Invalid items';end if;
 qty:=(item->>'quantity')::int;if qty<1 or (item->>'product_id')::uuid=any(ids) then raise exception 'Invalid items';end if;ids:=array_append(ids,(item->>'product_id')::uuid);total:=total+qty;end loop;
 select * into target from public.buyer_orders o where o.public_token=p_token and o.deleted_at is null and not o.link_revoked and o.created_at>now()-interval '25 days' for update;
 if not found or target.status='draft' then raise exception 'Order is not available';end if;
 if p_revision<>target.revision then raise exception 'Order changed; reload';end if;
 select * into receipt from public.buyer_submissions s where s.order_id=target.id and s.revision=target.revision;
 if found then
 if receipt.note=p_note and receipt.request_id is not distinct from p_request_id and (select count(*) from public.buyer_submission_items existing where existing.submission_id=receipt.id)=cardinality(ids) and not exists(select 1 from jsonb_array_elements(p_items) i where not exists(select 1 from public.buyer_submission_items si where si.submission_id=receipt.id and si.product_id=(i->>'product_id')::uuid and si.quantity=(i->>'quantity')::int and si.note=coalesce(i->>'note',''))) then return query select receipt.id,target.id,target.order_number,receipt.total_quantity,receipt.confirmed_at,cardinality(ids);return;end if;raise exception 'Order already submitted';end if;
 if target.status<>'waiting' then raise exception 'Order is not available';end if;
 if (select count(*) from public.buyer_products p where p.order_id=target.id and p.id=any(ids))<>cardinality(ids) then raise exception 'Invalid items';end if;
 if exists(select 1 from public.buyer_purchases p where p.order_id=target.id and p.purchased_quantity+p.cancelled_quantity>coalesce((select (i->>'quantity')::int from jsonb_array_elements(p_items) i where (i->>'product_id')::uuid=p.product_id),0)) then raise exception 'Selection below purchased quantity';end if;
 insert into public.buyer_submissions(order_id,total_quantity,revision,note,request_id,cargo_rate,exchange_rate) values(target.id,total,target.revision,p_note,p_request_id,target.cargo_rate,target.exchange_rate) returning * into receipt;
 insert into public.buyer_submission_items(submission_id,product_id,product_name,price,quantity,note,image_path,thumbnail_path,supplier_url,price_cny,cargo_cost,work_price_somoni,weight_grams,cost_price,buyer_earnings)
 select receipt.id,p.id,p.name,p.price,(i->>'quantity')::int,coalesce(i->>'note',''),p.image_path,p.thumbnail_path,p.supplier_url,p.price_cny,p.cargo_cost,p.work_price_somoni,p.weight_grams,case when p.price_cny is null or p.cargo_cost is null then null else round(p.price_cny*target.exchange_rate+p.cargo_cost,2) end,p.work_price_somoni from jsonb_array_elements(p_items) i join public.buyer_products p on p.id=(i->>'product_id')::uuid;
 update public.buyer_orders set status='received',confirmed_at=receipt.confirmed_at where id=target.id;return query select receipt.id,target.id,target.order_number,receipt.total_quantity,receipt.confirmed_at,cardinality(ids);
end $$;
create function public.buyer_save_purchase(p_order uuid,p_product uuid,p_version integer,p_quantity integer,p_cancelled integer,p_cny numeric,p_rate numeric,p_cargo numeric,p_extra numeric,p_problem text) returns public.buyer_purchases language plpgsql security definer set search_path='' as $$
declare target public.buyer_orders%rowtype;result public.buyer_purchases%rowtype;qty integer;
begin
 select * into target from public.buyer_orders where id=p_order and owner_id=auth.uid() and deleted_at is null for update;
 if not found or target.status not in ('received','ordered') or target.created_at<=now()-interval '25 days' then raise exception 'Purchase unavailable';end if;
 select si.quantity into qty from public.buyer_submission_items si join public.buyer_submissions s on s.id=si.submission_id where s.order_id=p_order and s.revision=target.revision and si.product_id=p_product;
 if qty is null or p_quantity+p_cancelled>qty then raise exception 'Invalid purchase quantity';end if;
 insert into public.buyer_purchases(order_id,product_id) values(p_order,p_product) on conflict do nothing;select * into result from public.buyer_purchases where product_id=p_product;
 if p_version is null or result.version<>p_version then raise exception 'Purchase changed; reload';end if;
 update public.buyer_purchases set purchased_quantity=p_quantity,cancelled_quantity=p_cancelled,actual_price_cny=p_cny,actual_exchange_rate=p_rate,actual_cargo=p_cargo,extra_cost=p_extra,problem=p_problem,version=version+1,updated_at=now() where product_id=p_product returning * into result;return result;
end $$;
create function public.buyer_record_cash(p_id uuid,p_order uuid,p_kind text,p_amount numeric) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.buyer_orders where id=p_order and owner_id=auth.uid() and deleted_at is null and created_at>now()-interval '25 days' for update;if not found then raise exception 'Order unavailable';end if;
 if exists(select 1 from public.buyer_cash_entries where id=p_id and (order_id<>p_order or kind<>p_kind or amount<>p_amount)) then raise exception 'Idempotency conflict';end if;
 insert into public.buyer_cash_entries(id,order_id,kind,amount) values(p_id,p_order,p_kind,p_amount) on conflict do nothing;
end $$;
alter table public.buyer_products drop column catalog_product_id;
drop table public.buyer_catalog_products;
create function public.buyer_queue_product_images() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.buyer_image_gc(path) select x from unnest(array[old.image_path,old.thumbnail_path]) x where x is not null and (tg_op='DELETE' or x not in(new.image_path,coalesce(new.thumbnail_path,''))) on conflict do nothing;return old;
end $$;
create trigger buyer_queue_product_images after delete or update of image_path,thumbnail_path on public.buyer_products for each row execute function public.buyer_queue_product_images();
create function public.buyer_archive_finance() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.buyer_financial_months(owner_id,month,cash_received,actual_spent,unknown_costs)
 select old.owner_id,m,sum(cash),sum(cost),sum(unknowns)::int from (
 select date_trunc('month',created_at at time zone 'UTC')::date m,case kind when 'payment' then amount when 'refund' then -amount else 0 end cash,case kind when 'expense' then amount when 'expense_refund' then -amount else 0 end cost,0 unknowns from public.buyer_cash_entries where order_id=old.id
 union all select date_trunc('month',updated_at at time zone 'UTC')::date,0,coalesce(round(actual_price_cny*actual_exchange_rate*purchased_quantity+actual_cargo+extra_cost,2),0),case when purchased_quantity>0 and (actual_price_cny is null or actual_exchange_rate is null or actual_cargo is null) then 1 else 0 end from public.buyer_purchases where order_id=old.id and purchased_quantity>0
 ) a group by m on conflict(owner_id,month) do update set cash_received=public.buyer_financial_months.cash_received+excluded.cash_received,actual_spent=public.buyer_financial_months.actual_spent+excluded.actual_spent,unknown_costs=public.buyer_financial_months.unknown_costs+excluded.unknown_costs;
 insert into public.buyer_financial_months(owner_id,month,unknown_costs) select old.owner_id,date_trunc('month',s.confirmed_at at time zone 'UTC')::date,count(*)::int from public.buyer_submissions s join public.buyer_submission_items si on si.submission_id=s.id left join public.buyer_purchases p on p.product_id=si.product_id where s.order_id=old.id and s.revision=old.revision and coalesce(p.purchased_quantity,0)+coalesce(p.cancelled_quantity,0)<si.quantity group by s.confirmed_at on conflict(owner_id,month) do update set unknown_costs=public.buyer_financial_months.unknown_costs+excluded.unknown_costs;
 insert into public.buyer_image_gc(path) select distinct x from public.buyer_submission_items si join public.buyer_submissions s on s.id=si.submission_id cross join lateral unnest(array[si.image_path,si.thumbnail_path]) x where s.order_id=old.id and x is not null on conflict do nothing;return old;
end $$;
create trigger buyer_archive_finance before delete on public.buyer_orders for each row execute function public.buyer_archive_finance();
create function public.buyer_claim_job(p_token uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 insert into public.buyer_job_lease values('maintenance',p_token,now()+interval '5 minutes') on conflict(name) do update set token=excluded.token,expires_at=excluded.expires_at where public.buyer_job_lease.expires_at<now();return exists(select 1 from public.buyer_job_lease where name='maintenance' and token=p_token);
end $$;
create function public.buyer_cleanup_batch(p_token uuid) returns integer language plpgsql security definer set search_path='' as $$
declare n integer; candidate record;
begin
 perform 1 from public.buyer_job_lease where name='maintenance' and token=p_token and expires_at>now() for update;if not found then raise exception 'Lease expired';end if;
 with doomed as(select id from public.buyer_orders where created_at<=now()-interval '25 days' order by created_at limit 50 for update skip locked) delete from public.buyer_orders where id in(select id from doomed);get diagnostics n=row_count;
 for candidate in select name from storage.objects where bucket_id='buyer-product-images' and created_at<now()-interval '24 hours' and not exists(select 1 from public.buyer_image_gc g where g.path=storage.objects.name) and not exists(select 1 from public.buyer_products p where storage.objects.name in(p.image_path,p.thumbnail_path)) and not exists(select 1 from public.buyer_submission_items si where storage.objects.name in(si.image_path,si.thumbnail_path)) order by created_at limit 200 loop
 perform pg_advisory_xact_lock(hashtext(candidate.name));
 insert into public.buyer_image_gc(path) select candidate.name where not exists(select 1 from public.buyer_products p where candidate.name in(p.image_path,p.thumbnail_path)) and not exists(select 1 from public.buyer_submission_items si where candidate.name in(si.image_path,si.thumbnail_path)) on conflict do nothing;
 end loop;
 delete from public.buyer_rate_limits where window_start<now()-interval '1 hour';delete from public.buyer_job_runs where ran_at<now()-interval '30 days';return n;
end $$;
create function public.buyer_gc_paths(p_token uuid) returns table(path text) language sql security definer set search_path='' as $$
 select gc.path from public.buyer_image_gc gc where retry_at<=now() and exists(select 1 from public.buyer_job_lease where name='maintenance' and token=p_token and expires_at>now()) and not exists(select 1 from public.buyer_products p where gc.path in(p.image_path,p.thumbnail_path)) and not exists(select 1 from public.buyer_submission_items si where gc.path in(si.image_path,si.thumbnail_path)) order by queued_at limit 100
$$;
create function public.buyer_limit_public(p_key text) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 insert into public.buyer_rate_limits values(p_key,now(),1) on conflict(key) do update set hits=case when public.buyer_rate_limits.window_start<now()-interval '1 minute' then 1 else public.buyer_rate_limits.hits+1 end,window_start=case when public.buyer_rate_limits.window_start<now()-interval '1 minute' then now() else public.buyer_rate_limits.window_start end returning hits into n;return n<=120;
end $$;
drop function public.buyer_finance_summary();
create function public.buyer_finance_summary() returns jsonb language sql stable security invoker set search_path='' as $$
 with chosen as(select si.* from public.buyer_submission_items si join public.buyer_submissions s on s.id=si.submission_id join public.buyer_orders o on o.id=s.order_id where o.owner_id=auth.uid() and o.deleted_at is null and o.revision=s.revision),
 planned as(select case when count(*) filter(where price is null)>0 then null else coalesce(sum(price*quantity),0) end revenue,case when count(*) filter(where cost_price is null)>0 then null else coalesce(sum(cost_price*quantity),0) end spent from chosen),
 cash as(select coalesce(sum(case kind when 'payment' then amount when 'refund' then -amount else 0 end),0) received,coalesce(sum(case kind when 'expense' then amount when 'expense_refund' then -amount else 0 end),0) spent from public.buyer_cash_entries),
 purchases as(select coalesce(sum(round(actual_price_cny*actual_exchange_rate*purchased_quantity+actual_cargo+extra_cost,2)),0) spent,count(*) filter(where purchased_quantity>0 and (actual_price_cny is null or actual_exchange_rate is null or actual_cargo is null)) unknowns from public.buyer_purchases where purchased_quantity>0),
 history as(select coalesce(sum(cash_received),0) received,coalesce(sum(actual_spent),0) spent,coalesce(sum(unknown_costs),0) unknowns from public.buyer_financial_months)
 select jsonb_build_object('planned_revenue',planned.revenue,'planned_cost',planned.spent,'planned_profit',planned.revenue-planned.spent,'cash_received',cash.received+history.received,'actual_spent',case when purchases.unknowns+history.unknowns>0 then null else cash.spent+purchases.spent+history.spent end,'actual_profit',case when purchases.unknowns+history.unknowns>0 or exists(select 1 from chosen c left join public.buyer_purchases p on p.product_id=c.product_id where coalesce(p.purchased_quantity,0)+coalesce(p.cancelled_quantity,0)<c.quantity) then null else cash.received+history.received-cash.spent-purchases.spent-history.spent end) from planned,cash,purchases,history
$$;
revoke all on function public.buyer_save_draft(uuid,text,text,integer,jsonb),public.buyer_order_action(uuid,text),public.buyer_save_purchase(uuid,uuid,integer,integer,integer,numeric,numeric,numeric,numeric,text),public.buyer_record_cash(uuid,uuid,text,numeric),public.buyer_finance_summary() from public,anon;
grant execute on function public.buyer_save_draft(uuid,text,text,integer,jsonb),public.buyer_order_action(uuid,text),public.buyer_save_purchase(uuid,uuid,integer,integer,integer,numeric,numeric,numeric,numeric,text),public.buyer_record_cash(uuid,uuid,text,numeric),public.buyer_finance_summary() to authenticated;
revoke all on function public.submit_buyer_order(uuid,jsonb,text,integer,uuid),public.buyer_claim_job(uuid),public.buyer_cleanup_batch(uuid),public.buyer_gc_paths(uuid),public.buyer_limit_public(text),public.buyer_queue_product_images(),public.buyer_archive_finance() from public,anon,authenticated;
grant execute on function public.submit_buyer_order(uuid,jsonb,text,integer,uuid),public.buyer_claim_job(uuid),public.buyer_cleanup_batch(uuid),public.buyer_gc_paths(uuid),public.buyer_limit_public(text) to service_role;
create function public.buyer_gc_ack(p_token uuid,p_paths text[],p_success boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.buyer_job_lease where name='maintenance' and token=p_token and expires_at>now() for update;if not found then raise exception 'Lease expired';end if;
 if cardinality(p_paths)>100 then raise exception 'Batch too large';end if;
 if p_success then delete from public.buyer_image_gc where path=any(p_paths);
 else update public.buyer_image_gc set attempts=attempts+1,retry_at=now()+make_interval(secs=>least(86400,power(2,least(attempts,10))::int*60)) where path=any(p_paths);end if;
end $$;
revoke all on function public.buyer_gc_ack(uuid,text[],boolean) from public,anon,authenticated;
grant execute on function public.buyer_gc_ack(uuid,text[],boolean) to service_role;

-- Owner-scoped monthly actual figures combine live rows and anonymous expired-order sums.
create function public.buyer_finance_monthly() returns table(month date,cash_received numeric,actual_spent numeric,actual_profit numeric)
language sql stable security invoker set search_path='' as $$
 with movements as (
 select m.month,m.cash_received,m.actual_spent,m.unknown_costs from public.buyer_financial_months m
 union all select date_trunc('month',c.created_at at time zone 'UTC')::date,
 case c.kind when 'payment' then c.amount when 'refund' then -c.amount else 0 end,
 case c.kind when 'expense' then c.amount when 'expense_refund' then -c.amount else 0 end,0 from public.buyer_cash_entries c
 union all select date_trunc('month',p.updated_at at time zone 'UTC')::date,0,
 coalesce(round(p.actual_price_cny*p.actual_exchange_rate*p.purchased_quantity+p.actual_cargo+p.extra_cost,2),0),
 case when p.actual_price_cny is null or p.actual_exchange_rate is null or p.actual_cargo is null then 1 else 0 end
 from public.buyer_purchases p where p.purchased_quantity>0
 union all select date_trunc('month',s.confirmed_at at time zone 'UTC')::date,0,0,1
 from public.buyer_submissions s join public.buyer_orders o on o.id=s.order_id and o.revision=s.revision
 join public.buyer_submission_items si on si.submission_id=s.id left join public.buyer_purchases p on p.product_id=si.product_id
 where coalesce(p.purchased_quantity,0)+coalesce(p.cancelled_quantity,0)<si.quantity
 ) select m.month,sum(m.cash_received),case when sum(m.unknown_costs)>0 then null else sum(m.actual_spent) end,
 case when sum(m.unknown_costs)>0 then null else sum(m.cash_received)-sum(m.actual_spent) end
 from movements m group by m.month order by m.month desc
$$;
revoke all on function public.buyer_finance_monthly() from public,anon;
grant execute on function public.buyer_finance_monthly() to authenticated;
