// Loopback-only wallet fixture backed by real embedded PostgreSQL migrations.
import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
const db = new PGlite()
const owner = '33333333-3333-4333-8333-333333333333'
await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;
 create table storage.buckets(id text primary key,name text,public boolean);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 grant usage on schema public,storage to anon,authenticated,service_role;
`)
for (const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) {
 await db.exec((await readFile('supabase/migrations/'+file,'utf8')).replace('create extension if not exists pgcrypto;',''))
}
await db.query('insert into auth.users values($1)',[owner])
await db.exec('set role authenticated')
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner])
const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dushanbe',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
await db.query("insert into wallet_rates(owner_id,usd,cny,rub,date,fetched_at,source) values($1,9.25,1.3933,.1159,$2,now(),'https://alif.tj/api/rates')",[owner,today])
const tables=new Set(['wallet_accounts','wallet_entries','wallet_debts','wallet_order_settings','wallet_rates'])
const rpcs=new Set(['wallet_snapshot','wallet_record_loan','wallet_realize_plan','wallet_replace_entry','wallet_cancel_debt'])
export async function walletFixture(req,res,url) {
 const table=url.pathname.split('/').at(-1),rpc=url.pathname.includes('/rpc/')
 if(!(rpc?rpcs:tables).has(table))return false
 try {
  let body={}
  if(req.method!=='GET'&&req.method!=='HEAD')body=await new Promise(resolve=>{let text='';req.on('data',c=>text+=c);req.on('end',()=>resolve(JSON.parse(text||'{}')))})
  let result
  if(rpc){
   const keys=Object.keys(body);if(keys.some(k=>!/^p_[a-z_]+$/.test(k)))throw new Error('Invalid args')
   result=(await db.query(`select ${table}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) as value`,keys.map(k=>typeof body[k]==='object'&&body[k]!==null?JSON.stringify(body[k]):body[k]))).rows[0].value
  } else if(req.method==='POST'){
   const keys=Object.keys(body);if(keys.some(k=>!/^[a-z_]+$/.test(k)))throw new Error('Invalid fields')
   const conflict=table==='wallet_rates'?'owner_id':table==='wallet_order_settings'?'order_id':'id'
   const upsert=req.headers.prefer?.includes('resolution=merge-duplicates')?` on conflict(${conflict}) do update set ${keys.filter(k=>k!==conflict).map(k=>`${k}=excluded.${k}`).join(',')}`:''
   const rows=(await db.query(`insert into ${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})${upsert} returning *`,Object.values(body))).rows
   result=req.headers.accept?.includes('vnd.pgrst.object')?rows[0]:rows
  } else if(req.method==='PATCH'){
   const keys=Object.keys(body);if(keys.some(k=>!/^[a-z_]+$/.test(k)))throw new Error('Invalid fields')
   const id=url.searchParams.get('id')?.replace(/^eq\./,'')
   result=(await db.query(`update ${table} set ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')} where id=$${keys.length+1} returning *`,[...Object.values(body),id])).rows
  } else {
   const rows=(await db.query(`select * from ${table}`)).rows
   result=req.headers.accept?.includes('vnd.pgrst.object')?rows[0]??null:rows
  }
  res.end(JSON.stringify(result));return true
 }catch(error){res.statusCode=400;res.end(JSON.stringify({message:error.message,code:error.code}));return true}
}
