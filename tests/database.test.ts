import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Embedded Postgres exercises real migrations, RLS and PL/pgSQL. Supabase's
// auth/storage schemas are minimal fixtures, not a hosted Supabase instance.
test('fresh migrations, buyer isolation, immutable publication and atomic/idempotent confirmation', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      create table storage.buckets(id text primary key, name text, public boolean);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
      grant usage on schema public, storage to anon, authenticated, service_role;
    `)
    for (const file of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
      const sql = (await readFile(`supabase/migrations/${file}`, 'utf8')).replace('create extension if not exists pgcrypto;', '')
      await db.exec(sql)
    }
    const owner = '11111111-1111-4111-8111-111111111111'
    const other = '22222222-2222-4222-8222-222222222222'
    await db.query('insert into auth.users values ($1), ($2)', [owner, other])
    await db.exec('set role authenticated')
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner])
    const order = (await db.query<{id:string; public_token:string}>("insert into public.buyer_orders(owner_id,title) values ($1,'Осенняя закупка') returning id,public_token", [owner])).rows[0]
    await assert.rejects(db.query("update public.buyer_orders set status='waiting' where id=$1", [order.id]), /products/)
    const product = (await db.query<{id:string}>("insert into public.buyer_products(order_id,name,price,price_cny,cargo_cost,work_price_somoni,weight_grams,image_path) values ($1,'Платок',56.4,35,2.4,5,80,$2) returning id", [order.id, owner+'/scarf.jpg'])).rows[0]
    await assert.rejects(db.query("insert into public.buyer_products(order_id,name,price,image_path) values ($1,'Чужое фото',1,$2)", [order.id, other+'/photo.jpg']), /Invalid image owner/)
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [other])
    assert.equal((await db.query('select * from public.buyer_orders')).rows.length, 0)
    assert.equal((await db.query('select * from public.buyer_products')).rows.length, 0)
    await assert.rejects(db.query("insert into public.buyer_products(order_id,name,price,image_path) values ($1,'Чужой товар',1,$2)", [order.id, other+'/photo.jpg']))
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner])
    const unpriced = (await db.query<{id:string}>("insert into public.buyer_products(order_id,name,image_path) values ($1,'Без цены',$2) returning id", [order.id, owner+'/unpriced.jpg'])).rows[0]
    await db.query("update public.buyer_orders set status='waiting' where id=$1", [order.id])
    await assert.rejects(db.query('update public.buyer_products set price=1 where id=$1',[product.id]), /immutable/)
    await assert.rejects(db.query('delete from public.buyer_products where id=$1',[product.id]), /immutable/)
    await assert.rejects(db.query('delete from public.buyer_orders where id=$1',[order.id]), /cannot be permanently deleted/)
    await db.query("update public.buyer_orders set title='Осенняя закупка — обновлено' where id=$1", [order.id])
    assert.equal((await db.query<{title:string}>('select title from public.buyer_orders where id=$1',[order.id])).rows[0].title, 'Осенняя закупка — обновлено')
    await assert.rejects(db.query("update public.buyer_orders set status='completed' where id=$1", [order.id]), /Invalid status/)
    await assert.rejects(db.query("update public.buyer_orders set status='received',confirmed_at=now() where id=$1", [order.id]), /submission is required/)
    const payload = [{ product_id: product.id, quantity: 3 }, {product_id: unpriced.id, quantity: 2}]
    await assert.rejects(db.query('select * from public.submit_buyer_order($1,$2)', [order.public_token, JSON.stringify(payload)]), /permission denied/)
    await db.exec('set role anon')
    await assert.rejects(db.query('select * from public.buyer_orders'), /permission denied/)
    await assert.rejects(db.query('select * from public.submit_buyer_order($1,$2)', [order.public_token, JSON.stringify(payload)]), /permission denied/)
    await db.exec('set role service_role')
    for (const invalid of [null, [], [...payload, ...payload], [{product_id: product.id, quantity:100}], [{product_id:product.id,quantity:1.5}], [{product_id:other,quantity:2}]]) {
      await assert.rejects(db.query('select * from public.submit_buyer_order($1,$2)', [order.public_token, JSON.stringify(invalid)]), /Invalid items/)
    }
    const receipt = await db.query('select * from public.submit_buyer_order($1,$2)', [order.public_token, JSON.stringify(payload)])
    const repeated = await db.query('select * from public.submit_buyer_order($1,$2)', [order.public_token, JSON.stringify(payload)])
    assert.deepEqual(repeated.rows, receipt.rows)
    assert.equal((receipt.rows[0] as {total_quantity: number}).total_quantity, 5)
    await assert.rejects(db.query('select * from public.submit_buyer_order($1,$2)', [order.public_token, JSON.stringify([{product_id:product.id,quantity:4}])]), /already submitted/)
    await db.exec('reset role')
    assert.equal((await db.query<{count:number}>('select count(*)::int as count from public.buyer_submissions')).rows[0].count, 1)
    assert.equal((await db.query<{total:string}>('select sum(price*quantity)::text as total from public.buyer_submission_items')).rows[0].total, '169.20')
    await db.exec('set role authenticated')
    const finance = (await db.query<{revenue:string;spent:string;earned:string;confirmed_orders:number}>('select * from public.buyer_finance_summary()')).rows[0]
    assert.equal(finance.revenue, '169.20')
    assert.equal(finance.spent, '154.20')
    assert.equal(finance.earned, '15.00')
    assert.equal(Number(finance.confirmed_orders), 1)
    await db.query('update public.buyer_orders set deleted_at=now() where id=$1',[order.id])
    const emptyFinance = (await db.query<{revenue:string;confirmed_orders:number}>('select * from public.buyer_finance_summary()')).rows[0]
    assert.equal(emptyFinance.revenue, '0')
    assert.equal(Number(emptyFinance.confirmed_orders), 0)
    await db.exec('set role service_role')
    await assert.rejects(db.query('select * from public.submit_buyer_order($1,$2)', [order.public_token, JSON.stringify(payload)]), /not available/)
    await db.exec('set role authenticated')
    await db.query('update public.buyer_orders set deleted_at=null where id=$1',[order.id])
    await db.query("update public.buyer_orders set status='ordered' where id=$1", [order.id])
    await db.query("update public.buyer_orders set status='completed' where id=$1", [order.id])
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [other])
    assert.equal((await db.query('select * from public.buyer_submissions')).rows.length, 0)
    assert.equal((await db.query('select * from public.buyer_submission_items')).rows.length, 0)
  } finally { await db.close() }
})
