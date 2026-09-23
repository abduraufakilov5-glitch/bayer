import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { createTelegramNotifier } from '../supabase/functions/buyer-public-order/telegram.ts'
import { createHandler } from '../supabase/functions/buyer-public-order/handler.ts'

const receipt = {submission_id:'receipt',order_id:'order',order_number:42,total_quantity:3,confirmed_at:'2026-09-22T10:00:00Z'}
const config = {botToken:'test-only',chatId:'buyer-chat',ownerId:'owner'}
function setup(owner = 'owner', claimed = true) {
  const updates: Record<string, unknown>[] = []
  const client = createClient('https://fixture.example','fixture-only',{global:{fetch:async (input, init) => {
    const url = String(input)
    if (url.includes('/buyer_orders')) return Response.json({owner_id:owner})
    if (url.includes('/rpc/')) return Response.json([receipt])
    const body = JSON.parse(String(init?.body)); updates.push(body)
    if (url.includes('select=id')) return Response.json(claimed ? {id:'receipt'} : null)
    return new Response(null, {status:204})
  }}})
  return {client,updates}
}
test('Telegram only sends to configured owner and atomically claims unsent receipt', async () => {
  for (const [owner, claimed] of [['other',true], ['owner',false]] as const) {
    const {client} = setup(owner, claimed)
    await createTelegramNotifier(client,config,async () => {throw new Error('must not send')})(receipt)
  }
  const {client,updates} = setup()
  let sent = 0
  await createTelegramNotifier(client,config,async (input,init) => {
    sent++; assert.equal(String(input),'https://api.telegram.org/bottest-only/sendMessage')
    assert.equal(JSON.parse(String(init?.body)).chat_id,'buyer-chat')
    assert.match(JSON.parse(String(init?.body)).text, /00042/)
    return Response.json({ok:true})
  })(receipt)
  assert.equal(sent,1)
  assert.equal(updates.length,2)
  assert.ok(updates[1].telegram_notified_at)
})
test('Telegram failure releases lease and never fails a confirmed order', async () => {
  const {client,updates} = setup()
  await createTelegramNotifier(client,config,async () => Response.json({ok:false},{status:500}))(receipt)
  assert.equal(updates[1].telegram_claimed_at,null)
  const handler = createHandler(client,async () => {throw new Error('notification outage')})
  const response = await handler(new Request('https://fixture.example',{method:'POST',body:JSON.stringify({token:'11111111-1111-4111-8111-111111111111',items:[{product_id:'22222222-2222-4222-8222-222222222222',quantity:3}]})}))
  assert.equal(response.status,200)
})
