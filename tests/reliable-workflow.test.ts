import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
import { calculateClientPrice } from '../lib/pricing'
import { daysRemaining, expiresAt } from '../lib/retention'
const owner = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222',
  order = '33333333-3333-4333-8333-333333333333',
  product = '44444444-4444-4444-8444-444444444444'
test('cargo, notes, revisions, procurement, cash, retention and safe storage queue in PostgreSQL', async (t) => {
  const db = new PGlite()
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now());alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;grant usage on schema public,storage to anon,authenticated,service_role;`,
    )
    for (const file of (await readdir('supabase/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort())
      await db.exec(
        (await readFile('supabase/migrations/' + file, 'utf8')).replace(
          'create extension if not exists pgcrypto;',
          '',
        ),
      )
    await db.query('insert into auth.users values($1),($2)', [owner, other])
    await db.exec('set role authenticated')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ])
    const item = {
      id: product,
      name: 'Платок',
      price_cny: 40,
      work_price_somoni: 10,
      weight_grams: 80,
      image_path: owner + '/order/photo.jpg',
      thumbnail_path: owner + '/order/thumb.jpg',
      supplier_url: 'https://example.com/supplier',
    }
    const save = async (cargo: string, version: number, items = [item]) =>
      (
        await db.query<{ edit_version: number; public_token: string }>(
          "select (public.buyer_save_draft($1,'Заказ',$2,$3,$4)).*",
          [order, cargo, version, JSON.stringify(items)],
        )
      ).rows[0]
    let token = ''
    await t.test(
      'auto/air server prices match preview; idempotent saves and stale tabs',
      async () => {
        const first = await save('auto', 0)
        token = first.public_token
        assert.equal(first.edit_version, 1)
        assert.equal(
          (
            await db.query<{ price: string }>(
              'select price from public.buyer_products',
            )
          ).rows[0].price,
          String(calculateClientPrice(40, 10, 80)) + '0',
        )
        assert.equal((await save('auto', 0)).edit_version, 1)
        await save('air', 1)
        assert.equal(
          (
            await db.query<{ price: string }>(
              'select price from public.buyer_products',
            )
          ).rows[0].price,
          '70.80',
        )
        await assert.rejects(save('auto', 0), /another tab/)
        await assert.rejects(
          db.query(
            "update public.buyer_orders set created_at=now()-interval '30 days' where id=$1",
            [order],
          ),
          /immutable/,
        )
      },
    )
    const payload = JSON.stringify([
        {
          product_id: product,
          quantity: 3,
          note: 'Тёмный оттенок <script>alert(1)</script>',
        },
      ]),
      request = '55555555-5555-4555-8555-555555555555'
    await t.test(
      'publish, notes, concurrent/retried confirmation and frozen economics',
      async () => {
        await db.query("select public.buyer_order_action($1,'publish')", [
          order,
        ])
        await assert.rejects(save('auto', 2), /unavailable/)
        await db.exec('set role service_role')
        const submit = () =>
          db.query('select * from public.submit_buyer_order($1,$2,$3,1,$4)', [
            token,
            payload,
            'Именно эти цвета',
            request,
          ])
        const [a, b] = await Promise.all([submit(), submit()])
        assert.deepEqual(a.rows, b.rows)
        assert.equal(
          (
            await db.query<{ note: string }>(
              'select note from public.buyer_submission_items',
            )
          ).rows[0].note,
          'Тёмный оттенок <script>alert(1)</script>',
        )
        await assert.rejects(
          db.query('select * from public.submit_buyer_order($1,$2,$3,1,$4)', [
            token,
            payload,
            'другая заметка',
            request,
          ]),
          /already submitted/,
        )
        await db.exec('set role authenticated')
        const f = (
          await db.query<{
            f: { cash_received: number; actual_profit: number }
          }>('select public.buyer_finance_summary() f')
        ).rows[0].f
        assert.equal(f.cash_received, 0)
        assert.equal(f.actual_profit, null)
      },
    )
    await t.test(
      'partial purchase, unknown cost, cash retries, refunds and completion guard',
      async () => {
        await db.query(
          "select public.buyer_save_purchase($1,$2,0,1,0,null,null,null,0,'Остальное позже')",
          [order, product],
        )
        let f = (
          await db.query<{ f: { actual_profit: number | null } }>(
            'select public.buyer_finance_summary() f',
          )
        ).rows[0].f
        assert.equal(f.actual_profit, null)
        await assert.rejects(
          db.query(
            "update public.buyer_orders set status='ordered' where id=$1",
            [order],
          ),
          /purchase positions/,
        )
        const id = crypto.randomUUID()
        for (let n = 0; n < 2; n++)
          await db.query(
            "select public.buyer_record_cash($1,$2,'payment',200)",
            [id, order],
          )
        assert.equal(
          (await db.query('select * from public.buyer_cash_entries')).rows
            .length,
          1,
        )
        await db.query("select public.buyer_record_cash($1,$2,'refund',10)", [
          crypto.randomUUID(),
          order,
        ])
        await db.query(
          "select public.buyer_save_purchase($1,$2,1,2,1,40,1.3,9.6,2,'Один отсутствует')",
          [order, product],
        )
        f = (
          await db.query<{ f: { actual_profit: number } }>(
            'select public.buyer_finance_summary() f',
          )
        ).rows[0].f
        assert.equal(f.actual_profit, 74.4)
        await assert.rejects(
          db.query(
            "select public.buyer_save_purchase($1,$2,1,3,0,40,1.3,9.6,2,'')",
            [order, product],
          ),
          /changed/,
        )
      },
    )
    await t.test(
      'reapproval retains purchase and history; stale revisions and reductions blocked',
      async () => {
        await db.query("select public.buyer_order_action($1,'reopen')", [order])
        await save('auto', 3)
        await db.query("select public.buyer_order_action($1,'publish')", [
          order,
        ])
        await db.exec('set role service_role')
        await assert.rejects(
          db.query("select * from public.submit_buyer_order($1,$2,'',1,null)", [
            token,
            payload,
          ]),
          /changed/,
        )
        await assert.rejects(
          db.query("select * from public.submit_buyer_order($1,$2,'',2,null)", [
            token,
            JSON.stringify([{ product_id: product, quantity: 1 }]),
          ]),
          /purchased/,
        )
        await db.query(
          "select * from public.submit_buyer_order($1,$2,'',2,null)",
          [token, payload],
        )
        assert.equal(
          (await db.query('select * from public.buyer_submissions')).rows
            .length,
          2,
        )
        await db.exec('set role authenticated')
        assert.equal(
          (await db.query('select * from public.buyer_purchases')).rows.length,
          1,
        )
        await db.exec('set role authenticated')
        await db.query(
          "update public.buyer_orders set status='ordered' where id=$1",
          [order],
        )
        await db.query(
          "update public.buyer_orders set status='completed' where id=$1",
          [order],
        )
      },
    )
    await t.test(
      'foreign owner and anonymous cannot read/write finance, notes or operational RPCs',
      async () => {
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
          other,
        ])
        assert.equal(
          (await db.query('select * from public.buyer_purchases')).rows.length,
          0,
        )
        assert.equal(
          (await db.query('select * from public.buyer_cash_entries')).rows
            .length,
          0,
        )
        await assert.rejects(
          db.query("select public.buyer_order_action($1,'reopen')", [order]),
          /unavailable/,
        )
        await assert.rejects(save('auto', 4), /Not found/)
        await assert.rejects(
          db.query('select public.buyer_claim_job($1)', [request]),
          /permission denied/,
        )
        await db.exec('set role anon')
        await assert.rejects(
          db.query('select * from public.buyer_submission_items'),
          /permission denied/,
        )
      },
    )
    await t.test(
      '25-day UTC boundary, all statuses, shared image protection, aggregates and retry lease',
      async () => {
        await db.exec('reset role')
        const created = '2026-09-20T16:00:00Z'
        assert.equal(daysRemaining(created, expiresAt(created) - 1), 1)
        assert.equal(daysRemaining(created, expiresAt(created)), 0)
        // Clock fixture: set historical creation while leaving production immutability enabled afterwards.
        await db.exec(
          'alter table public.buyer_orders disable trigger guard_buyer_order',
        )
        await db.query(
          "update public.buyer_orders set created_at=now()-interval '25 days' where id=$1",
          [order],
        )
        await db.exec(
          'alter table public.buyer_orders enable trigger guard_buyer_order',
        )
        const retained = crypto.randomUUID()
        await db.query(
          "insert into public.buyer_orders(id,owner_id,title) values($1,$2,'Другой заказ')",
          [retained, owner],
        )
        await db.query(
          "insert into public.buyer_products(order_id,name,image_path) values($1,'Общее фото',$2)",
          [retained, item.image_path],
        )
        const job = crypto.randomUUID()
        assert.equal(
          (
            await db.query<{ ok: boolean }>(
              'select public.buyer_claim_job($1) ok',
              [job],
            )
          ).rows[0].ok,
          true,
        )
        assert.equal(
          (
            await db.query<{ ok: boolean }>(
              'select public.buyer_claim_job($1) ok',
              [crypto.randomUUID()],
            )
          ).rows[0].ok,
          false,
        )
        assert.equal(
          (
            await db.query<{ n: number }>(
              'select public.buyer_cleanup_batch($1) n',
              [job],
            )
          ).rows[0].n,
          1,
        )
        assert.equal(
          (await db.query('select * from public.buyer_submissions')).rows
            .length,
          0,
        )
        assert.equal(
          (await db.query('select * from public.buyer_orders')).rows.length,
          1,
        )
        const paths = (
          await db.query<{ path: string }>(
            'select * from public.buyer_gc_paths($1)',
            [job],
          )
        ).rows.map((r) => r.path)
        assert.ok(!paths.includes(item.image_path))
        assert.ok(paths.includes(item.thumbnail_path))
        await db.query('select public.buyer_gc_ack($1,$2,false)', [
          job,
          [item.thumbnail_path],
        ])
        assert.equal(
          (await db.query('select * from public.buyer_gc_paths($1)', [job]))
            .rows.length,
          0,
        )
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
          owner,
        ])
        await db.exec('set role authenticated')
        const f = (
          await db.query<{ f: { actual_profit: number } }>(
            'select public.buyer_finance_summary() f',
          )
        ).rows[0].f
        assert.equal(f.actual_profit, 74.4)
      },
    )
  } finally {
    await db.close()
  }
})
