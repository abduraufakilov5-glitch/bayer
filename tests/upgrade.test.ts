import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'

test('catalog upgrade preserves existing order/snapshot/photo data and refuses unrelated FK dependencies', async () => {
  const db = new PGlite()
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now());alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;grant usage on schema public,storage to anon,authenticated,service_role;`,
    )
    const migrations = (await readdir('supabase/migrations'))
        .filter((f) => f.endsWith('.sql'))
        .sort(),
      upgrade = migrations.pop()!
    for (const name of migrations)
      await db.exec(
        (await readFile('supabase/migrations/' + name, 'utf8')).replace(
          'create extension if not exists pgcrypto;',
          '',
        ),
      )
    const owner = crypto.randomUUID()
    await db.query('insert into auth.users values($1)', [owner])
    const o = (
      await db.query<{ id: string; public_token: string }>(
        "insert into public.buyer_orders(owner_id,title) values($1,'Исторический заказ') returning id,public_token",
        [owner],
      )
    ).rows[0]
    const p = (
      await db.query<{ id: string; image_path: string; price: string }>(
        "insert into public.buyer_products(order_id,name,price,price_cny,work_price_somoni,weight_grams,cargo_cost,image_path) values($1,'Старый платок',68.4,40,10,80,2.4,$2) returning id,image_path,price",
        [o.id, owner + '/historical.jpg'],
      )
    ).rows[0]
    await db.query(
      "update public.buyer_orders set status='waiting' where id=$1",
      [o.id],
    )
    await db.query('select * from public.submit_buyer_order($1,$2)', [
      o.public_token,
      JSON.stringify([{ product_id: p.id, quantity: 2 }]),
    ])
    const before = (
      await db.query(
        'select id,price,quantity,cost_price from public.buyer_submission_items',
      )
    ).rows
    const sql = await readFile('supabase/migrations/' + upgrade, 'utf8')
    // Simulate an unexpected table belonging to a different application. The migration must abort.
    await db.exec(
      'create table public.unrelated_app(id uuid primary key,catalog_ref uuid references public.buyer_catalog_products(id));',
    )
    await db.exec('begin')
    await assert.rejects(db.exec(sql), /depend/)
    await db.exec('rollback')
    assert.ok(
      (
        await db.query<{ t: string }>(
          "select to_regclass('public.buyer_catalog_products') t",
        )
      ).rows[0].t,
    )
    assert.equal(
      (await db.query('select * from public.buyer_submissions')).rows.length,
      1,
    )
    await db.exec('drop table public.unrelated_app;begin')
    await db.exec(sql)
    await db.exec('commit')
    assert.deepEqual(
      (
        await db.query(
          'select id,price,quantity,cost_price from public.buyer_submission_items',
        )
      ).rows,
      before,
    )
    assert.deepEqual(
      (await db.query('select id,image_path,price from public.buyer_products'))
        .rows,
      [p],
    )
    assert.equal(
      (
        await db.query<{ image_path: string }>(
          'select image_path from public.buyer_submission_items',
        )
      ).rows[0].image_path,
      p.image_path,
    )
    assert.equal(
      (
        await db.query<{ t: null }>(
          "select to_regclass('public.buyer_catalog_products') t",
        )
      ).rows[0].t,
      null,
    )
  } finally {
    await db.close()
  }
})
