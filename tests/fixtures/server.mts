// Loopback-only Supabase HTTP adapter backed by real embedded PostgreSQL.
// Auth and Storage transport are fixtures; migrations, RLS, triggers and RPCs are real.
import { createServer } from 'node:http'
import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { createHandler } from '../../supabase/functions/buyer-public-order/handler'
const owner = '33333333-3333-4333-8333-333333333333',
  token = '11111111-1111-4111-8111-111111111111',
  product = '22222222-2222-4222-8222-222222222222',
  unpriced = '44444444-4444-4444-8444-444444444444'
const db = new PGlite(),
  files = new Map<string, Buffer>()
await db.exec(
  `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;create table storage.buckets(id text primary key,name text,public boolean);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now(),unique(bucket_id,name));alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;grant usage on schema public,storage to anon,authenticated,service_role;`,
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
const user = {
  id: owner,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'buyer@example.test',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}
const jwt = [
  Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
  Buffer.from(
    JSON.stringify({
      sub: owner,
      aud: 'authenticated',
      role: 'authenticated',
      exp: 4102444800,
    }),
  ).toString('base64url'),
  'fixture',
].join('.')
let queue = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn)
  queue = result.then(
    () => {},
    () => {},
  )
  return result
}
async function reset() {
  await db.exec(
    `reset role;truncate public.buyer_orders cascade;truncate public.buyer_image_gc,public.buyer_rate_limits;insert into auth.users values('${owner}') on conflict do nothing;`,
  )
  await db.query(
    "insert into public.buyer_orders(id,owner_id,title,public_token) values($1,$2,'Осенняя закупка',$1)",
    [token, owner],
  )
  await db.query(
    "insert into storage.objects(bucket_id,name) values('buyer-product-images',$1) on conflict do nothing",
    [owner + '/photo.svg'],
  )
  await db.query(
    "insert into public.buyer_products(id,order_id,name,price_cny,cargo_cost,weight_grams,work_price_somoni,image_path) values($1,$2,'Шёлковый платок',35,2.4,80,5,$3),($4,$2,'Сумка без цены',null,2.4,80,0,$3)",
    [product, token, owner + '/photo.svg', unpriced],
  )
  await db.query(
    "update public.buyer_orders set status='waiting' where id=$1",
    [token],
  )
}
await reset()
const client = createClient('http://127.0.0.1:54329', 'fixture-service', {
    auth: { persistSession: false },
  }),
  publicHandler = createHandler(client)
const tables = new Set([
  'buyer_orders',
  'buyer_products',
  'buyer_submissions',
  'buyer_purchases',
  'buyer_cash_entries',
  'buyer_financial_months',
  'buyer_image_gc',
  'buyer_job_lease',
  'buyer_job_runs',
])
function field(s: string) {
  if (!/^[a-z_]+$/.test(s)) throw Error('field')
  return '"' + s + '"'
}
createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  const url = new URL(req.url!, 'http://127.0.0.1:54329'),
    parts: Buffer[] = []
  for await (const part of req) parts.push(Buffer.from(part))
  const bytes = Buffer.concat(parts),
    body =
      bytes.length && req.headers['content-type']?.includes('json')
        ? JSON.parse(bytes.toString())
        : {}
  try {
    let data: unknown = {}
    if (url.pathname === '/__large') {
      await serial(async () => {
        await db.query(
          "update public.buyer_orders set status='draft' where id=$1",
          [token],
        )
        await db.query(
          "insert into public.buyer_products(order_id,name,image_path) select $1,'Платок '||g,$2 from generate_series(1,298) g",
          [token, owner + '/photo.svg'],
        )
        await db.query(
          "update public.buyer_orders set status='waiting' where id=$1",
          [token],
        )
      })
      data = { ok: true }
    } else if (url.pathname === '/__reset') {
      await serial(reset)
      data = { ok: true }
    } else if (url.pathname === '/auth/v1/user') data = user
    else if (url.pathname === '/auth/v1/token')
      data = {
        access_token: jwt,
        refresh_token: 'fixture-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        user,
      }
    else if (url.pathname === '/auth/v1/logout') {
      res.writeHead(204)
      res.end()
      return
    } else if (url.pathname === '/functions/v1/buyer-public-order') {
      const response = await publicHandler(
        new Request(url, {
          method: req.method,
          headers: req.headers as HeadersInit,
          ...(req.method === 'POST' ? { body: bytes } : {}),
        }),
      )
      res.writeHead(response.status)
      res.end(await response.text())
      return
    } else if (url.pathname.endsWith('/photo.svg')) {
      res.setHeader('Content-Type', 'image/svg+xml')
      res.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600"><rect width="480" height="600" fill="#ebe1d5"/><path d="M60 100h360v400H60z" fill="#82604e"/></svg>',
      )
      return
    } else if (url.pathname.startsWith('/storage/v1/object/sign/')) {
      const path = url.pathname.slice(
        '/storage/v1/object/sign/buyer-product-images'.length,
      )
      if (!path)
        data = (body.paths ?? []).map((path: string) => ({
          path,
          signedURL: '/object/read/buyer-product-images/' + path,
        }))
      else data = { signedURL: '/object/read/buyer-product-images' + path }
    } else if (url.pathname.startsWith('/storage/v1/object/read/')) {
      const path = decodeURIComponent(
        url.pathname.slice(
          '/storage/v1/object/read/buyer-product-images/'.length,
        ),
      )
      if (path.endsWith('photo.svg')) {
        res.setHeader('Content-Type', 'image/svg+xml')
        res.end(
          '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600"><rect width="480" height="600" fill="#b58e6d"/></svg>',
        )
        return
      }
      const file = files.get(path)
      if (!file) {
        res.writeHead(404)
        res.end()
        return
      }
      res.setHeader('Content-Type', 'image/jpeg')
      res.end(file)
      return
    } else if (url.pathname.startsWith('/storage/v1/object/')) {
      const path = decodeURIComponent(
        url.pathname.slice('/storage/v1/object/buyer-product-images/'.length),
      )
      if (files.has(path) && req.headers['x-upsert'] !== 'true') {
        res.writeHead(409)
        res.end(
          JSON.stringify({
            statusCode: '409',
            error: 'Duplicate',
            message: 'The resource already exists',
          }),
        )
        return
      }
      let image = bytes
      if (req.headers['content-type']?.includes('multipart/form-data')) {
        const form = await new Request('http://127.0.0.1/upload', {
          method: 'POST',
          headers: { 'content-type': req.headers['content-type'] },
          body: bytes,
        }).formData()
        for (const value of form.values())
          if (value instanceof File) {
            image = Buffer.from(await value.arrayBuffer())
            break
          }
      }
      files.set(path, image)
      await serial(() =>
        db.query(
          "insert into storage.objects(bucket_id,name) values('buyer-product-images',$1) on conflict do nothing",
          [path],
        ),
      )
      data = { Key: path }
    } else if (url.pathname.startsWith('/rest/v1/')) {
      data = await serial(async () => {
        await db.exec('reset role')
        const isService = req.headers.apikey === 'fixture-service'
        if (!isService) {
          await db.exec('set role authenticated')
          await db.query(
            "select set_config('request.jwt.claim.sub',$1,false)",
            [owner],
          )
        } else await db.exec('set role service_role')
        try {
          if (url.pathname.startsWith('/rest/v1/rpc/')) {
            const name = url.pathname.split('/').pop()!
            if (!/^buyer_|^submit_buyer_order$/.test(name)) throw Error('RPC')
            const keys = Object.keys(body)
            const args = keys
              .map((k, n) => field(k) + '=> $' + (n + 1))
              .join(',')
            const result = await db.query<{ result: unknown }>(
              'select to_jsonb(public.' +
                field(name) +
                '(' +
                args +
                ')) result',
              keys.map((k) =>
                typeof body[k] === 'object' && body[k] !== null
                  ? JSON.stringify(body[k])
                  : body[k],
              ),
            )
            return name === 'submit_buyer_order'
              ? result.rows.map((r) => r.result)
              : result.rows[0].result
          }
          const table = url.pathname.split('/').pop()!
          if (!tables.has(table)) throw Error('Table')
          const values: unknown[] = [],
            conditions: string[] = []
          for (const [k, v] of url.searchParams) {
            if (['select', 'order', 'offset', 'limit'].includes(k)) continue
            const [op, ...rest] = v.split('.'),
              value = rest.join('.')
            if (op === 'eq' || op === 'gt' || op === 'lt' || op === 'neq') {
              values.push(value)
              conditions.push(
                field(k) +
                  { eq: '=', gt: '>', lt: '<', neq: '<>' }[op] +
                  '$' +
                  values.length,
              )
            }
            if (op === 'is')
              conditions.push(
                field(k) + ' is ' + (value === 'null' ? 'null' : 'true'),
              )
            if (op === 'not' && value === 'is.null')
              conditions.push(field(k) + ' is not null')
            if (op === 'ilike') {
              values.push(value)
              conditions.push(field(k) + ' ilike $' + values.length)
            }
          }
          const where = conditions.length
            ? ' where ' + conditions.join(' and ')
            : ''
          if (req.method === 'PATCH') {
            const assignments = Object.keys(body).map((k) => {
              values.push(body[k])
              return field(k) + '=$' + values.length
            })
            await db.query(
              'update public.' +
                field(table) +
                ' set ' +
                assignments.join(',') +
                where,
              values,
            )
            return null
          }
          let rows = (
            await db.query(
              'select * from public.' + field(table) + where,
              values,
            )
          ).rows as Record<string, unknown>[]
          if (url.searchParams.has('order')) {
            const key = url.searchParams.get('order')!.split('.')[0]
            rows.sort(
              (a, b) =>
                String(a[key]).localeCompare(String(b[key])) *
                (url.searchParams.get('order')!.includes('.desc') ? -1 : 1),
            )
          }
          res.setHeader(
            'Content-Range',
            `0-${Math.max(0, rows.length - 1)}/${rows.length}`,
          )
          res.setHeader('Access-Control-Expose-Headers', 'Content-Range')
          if (url.searchParams.has('limit'))
            rows = rows.slice(0, Number(url.searchParams.get('limit')))
          if (
            table === 'buyer_submissions' &&
            url.searchParams.get('select')?.includes('buyer_submission_items')
          )
            for (const row of rows)
              row.buyer_submission_items = (
                await db.query(
                  'select * from public.buyer_submission_items where submission_id=$1',
                  [row.id],
                )
              ).rows
          return String(req.headers.accept).includes('vnd.pgrst.object')
            ? (rows[0] ?? null)
            : rows
        } finally {
          await db.exec('reset role')
        }
      })
    }
    res.end(JSON.stringify(data))
  } catch (e) {
    res.writeHead(400)
    res.end(
      JSON.stringify({
        message: e instanceof Error ? e.message : 'Fixture failed',
      }),
    )
  }
}).listen(54329, '127.0.0.1')
