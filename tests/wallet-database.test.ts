import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
test('wallet uses atomic transfers/edits/plans, enforces ownership and partial debt limits', async () => {
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
    for (const file of (await readdir('supabase/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      const sql = (
        await readFile(`supabase/migrations/${file}`, 'utf8')
      ).replace('create extension if not exists pgcrypto;', '')
      await db.exec(sql)
    }

    const owner = '11111111-1111-4111-8111-111111111111',
      other = '22222222-2222-4222-8222-222222222222'
    await db.query('insert into auth.users values ($1),($2)', [owner, other])
    await db.exec('set role authenticated')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ])
    const account = (
      await db.query<{ id: string }>(
        "insert into wallet_accounts(owner_id,name,opening_balance) values($1,'Наличные',1000) returning id",
        [owner],
      )
    ).rows[0].id
    const bank = (
      await db.query<{ id: string }>(
        "insert into wallet_accounts(owner_id,name) values($1,'Карта') returning id",
        [owner],
      )
    ).rows[0].id
    const transfer = (
      await db.query<{ id: string }>(
        "insert into wallet_entries(owner_id,account_id,to_account_id,kind,amount,rate,to_amount) values($1,$2,$3,'transfer',100,1,100) returning id",
        [owner, account, bank],
      )
    ).rows[0].id
    await assert.rejects(
      db.query(
        "insert into wallet_entries(owner_id,account_id,to_account_id,kind,amount,rate,to_amount) values($1,$2,$2,'transfer',100,1,100)",
        [owner, account],
      ),
      /check constraint/,
    )
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ])
    assert.equal(
      (await db.query('select * from wallet_accounts')).rows.length,
      0,
    )
    assert.equal(
      (
        await db.query<{ snapshot: { accounts: unknown[] } }>(
          'select wallet_snapshot() as snapshot',
        )
      ).rows[0].snapshot.accounts.length,
      0,
    )
    await assert.rejects(
      db.query(
        "insert into wallet_entries(owner_id,account_id,kind,amount,rate) values($1,$2,'expense',100,1)",
        [other, account],
      ),
      /Account unavailable|foreign key/,
    )
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ])
    const loan = (
      await db.query<{ id: string }>(
        "select wallet_record_loan('Али','receivable',300,null,'Заём',$1,300,1) as id",
        [account],
      )
    ).rows[0].id
    await db.query(
      "insert into wallet_entries(owner_id,account_id,kind,amount,rate,debt_id) values($1,$2,'debt_receive',75,1,$3)",
      [owner, account, loan],
    )
    await assert.rejects(
      db.query(
        "insert into wallet_entries(owner_id,account_id,kind,amount,rate,debt_id) values($1,$2,'debt_receive',226,1,$3)",
        [owner, account, loan],
      ),
      /exceeds remaining/,
    )
    const plan = (
      await db.query<{ id: string }>(
        "insert into wallet_entries(owner_id,account_id,kind,amount,rate,planned) values($1,$2,'expense',50,1,true) returning id",
        [owner, account],
      )
    ).rows[0].id
    await db.query('select wallet_realize_plan($1,current_date)', [plan])
    await db.query('select wallet_realize_plan($1,current_date)', [plan])
    assert.equal(
      (
        await db.query<{ n: number }>(
          'select count(*)::int n from wallet_entries where amount=50 and not planned and voided_at is null',
        )
      ).rows[0].n,
      1,
    )
    const replacement = {
      account_id: account,
      to_account_id: bank,
      kind: 'transfer',
      amount: 150,
      rate: 1,
      to_amount: 150,
      category: 'Другое',
      note: 'Исправление',
      entry_date: new Date().toISOString().slice(0, 10),
      planned: false,
      order_id: null,
      debt_id: null,
    }
    await db.query('select wallet_replace_entry($1,$2)', [
      transfer,
      JSON.stringify(replacement),
    ])
    await assert.rejects(
      db.query('select wallet_replace_entry($1,$2)', [
        transfer,
        JSON.stringify(replacement),
      ]),
      /already changed/,
    )
    const actual = (
      await db.query<{ id: string }>(
        "select id from wallet_entries where kind='transfer' and voided_at is null",
      )
    ).rows[0].id
    await assert.rejects(
      db.query('select wallet_replace_entry($1,$2)', [
        actual,
        JSON.stringify({ ...replacement, to_account_id: account }),
      ]),
      /check constraint/,
    )
    assert.equal(
      (
        await db.query<{ n: number }>(
          'select count(*)::int n from wallet_entries where id=$1 and voided_at is null',
          [actual],
        )
      ).rows[0].n,
      1,
    )
    await db.query('select wallet_cancel_debt($1)', [loan])
    assert.equal(
      (
        await db.query<{ n: number }>(
          'select count(*)::int n from wallet_entries where debt_id=$1 and voided_at is null',
          [loan],
        )
      ).rows[0].n,
      0,
    )
    await assert.rejects(
      db.query(
        "insert into wallet_entries(owner_id,account_id,kind,amount,rate,debt_id) values($1,$2,'debt_receive',1,1,$3)",
        [owner, account, loan],
      ),
      /Debt unavailable/,
    )
    await assert.rejects(
      db.query('update wallet_accounts set owner_id=$1 where id=$2', [
        other,
        account,
      ]),
      /row-level security|foreign key/,
    )
    const order=(await db.query<{id:string;public_token:string}>("insert into buyer_orders(owner_id,title) values($1,'Новые курсы') returning id,public_token",[owner])).rows[0]
    const product=(await db.query<{id:string}>("insert into buyer_products(order_id,name,price,price_cny,cargo_cost,work_price_somoni,weight_grams,purchase_cost_tjs,cny_rate,usd_rate,image_path) values($1,'Платок',57.97,35.5,3.87,5,120,49.1,1.3832,9.224,$2) returning id",[order.id,owner+'/photo.jpg'])).rows[0]
    await db.query("update buyer_orders set status='waiting' where id=$1",[order.id])
    await db.exec('set role service_role')
    await db.query('select * from submit_buyer_order($1,$2)',[order.public_token,JSON.stringify([{product_id:product.id,quantity:2}])])
    await db.exec('set role authenticated')
    const receipt=(await db.query<{cost_price:string}>('select cost_price from buyer_submission_items where product_id=$1',[product.id])).rows[0]
    assert.equal(Number(receipt.cost_price),52.97)
    const snapshot=(await db.query<{value:{orders:{revenue:number;costs:number;cargo:number}[]}}>('select wallet_snapshot() as value')).rows[0].value
    assert.equal(Number(snapshot.orders[0].revenue),115.94)
    assert.equal(Number(snapshot.orders[0].costs),105.94)
    assert.equal(Number(snapshot.orders[0].cargo),7.74)
    await db.exec('set role anon')
    await assert.rejects(
      db.query('select wallet_snapshot()'),
      /permission denied/,
    )
  } finally {
    await db.close()
  }
})
