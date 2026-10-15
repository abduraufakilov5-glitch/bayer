import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { createHandler } from '../supabase/functions/buyer-public-order/handler.ts'

const token = '11111111-1111-4111-8111-111111111111'
const productId = '22222222-2222-4222-8222-222222222222'
const owner = '33333333-3333-4333-8333-333333333333'
const payload = { token, items: [{ product_id: productId, quantity: 2 }] }
function setup(
  options: {
    status?: string
    rpcError?: string
    imagePath?: string
    imageMissing?: boolean
  } = {},
) {
  const calls: string[] = []
  const client = createClient('https://fixture.example', 'fixture-only', {
    global: {
      fetch: async (input, init) => {
        const url = String(input)
        calls.push(url)
        if (url.includes('/rpc/buyer_limit_public')) return Response.json(true)
        if (url.includes('/buyer_submissions')) return Response.json(null)
        if (url.includes('/rpc/')) {
          assert.deepEqual(JSON.parse(init?.body as string), {
            p_token: token,
            p_items: payload.items,
            p_note: '',
            p_revision: 1,
            p_request_id: null,
          })
          return Response.json(
            options.rpcError
              ? { message: options.rpcError }
              : [
                  {
                    order_number: 1,
                    total_quantity: 2,
                    confirmed_at: '2026-09-20',
                  },
                ],
            { status: options.rpcError ? 400 : 200 },
          )
        }
        if (url.includes('/buyer_orders'))
          return Response.json({
            id: token,
            owner_id: owner,
            title: 'Платки',
            order_number: 1,
            status: options.status ?? 'waiting',
            revision: 1,
          })
        if (url.includes('/buyer_products'))
          return Response.json([
            {
              id: productId,
              name: 'Шёлк',
              price: 56.4,
              image_path: options.imagePath ?? owner + '/photo.jpg',
            },
          ])
        if (url.includes('/storage/') && options.imageMissing)
          return Response.json([
            { path: owner + '/photo.jpg', error: 'Missing image' },
          ])
        if (url.includes('/storage/'))
          return Response.json([
            { path: owner + '/photo.jpg', signedURL: '/signed/photo.jpg' },
          ])
        throw new Error('Unexpected request: ' + url)
      },
    },
  })
  return { handler: createHandler(client), calls }
}
const post = (body: unknown) =>
  new Request('https://fixture.example/functions/v1/buyer-public-order', {
    method: 'POST',
    body: JSON.stringify(body),
  })

test('public API rejects invalid/duplicate/oversized requests before touching the database', async () => {
  const { handler, calls } = setup()
  for (const body of [
    null,
    {},
    { ...payload, token: 'bad' },
    { ...payload, items: [] },
    { ...payload, items: [...payload.items, ...payload.items] },
    { ...payload, items: [{ product_id: productId, quantity: 100 }] },
  ])
    assert.equal((await handler(post(body))).status, 400)
  assert.equal(
    (
      await handler(
        new Request('https://fixture.example', {
          method: 'POST',
          body: 'x'.repeat(524289),
        }),
      )
    ).status,
    413,
  )
  assert.equal(calls.length, 0)
})
test('public API returns only final prices and signed images, never owner/cost data', async () => {
  const { handler, calls } = setup()
  const response = await handler(
    new Request('https://fixture.example?token=' + token),
  )
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.deepEqual(Object.keys(data.order).sort(), [
    'order_number',
    'revision',
    'status',
    'title',
  ])
  assert.deepEqual(Object.keys(data.products[0]).sort(), [
    'full_image_url',
    'id',
    'image_url',
    'name',
    'price',
  ])
  assert.ok(calls[1].includes('public_token=eq.' + token))
  assert.ok(calls[3].includes('order_id=eq.' + token))
  assert.equal(response.headers.get('cache-control'), 'no-store')
})
test('public API does not sign another buyer image and omits products for completed orders', async () => {
  const invalid = setup({ imagePath: 'other/photo.jpg' })
  assert.equal(
    (
      await invalid.handler(
        new Request('https://fixture.example?token=' + token),
      )
    ).status,
    503,
  )
  assert.equal(invalid.calls.length, 4)
  const completed = setup({ status: 'completed' })
  assert.deepEqual(
    (
      await (
        await completed.handler(
          new Request('https://fixture.example?token=' + token),
        )
      ).json()
    ).products,
    [],
  )
  assert.equal(completed.calls.length, 3)
})
test('public API returns receipts, meaningful conflicts and hides database errors', async () => {
  assert.equal((await setup().handler(post(payload))).status, 200)
  assert.equal(
    (
      await setup({ rpcError: 'Order already submitted' }).handler(
        post(payload),
      )
    ).status,
    409,
  )
  const response = await setup({
    rpcError: 'private database details',
  }).handler(post(payload))
  assert.equal(response.status, 503)
  assert.ok(!(await response.text()).includes('private database'))
})

test('a missing image does not hide the rest of a public order', async () => {
  const response = await setup({ imageMissing: true }).handler(
    new Request('https://fixture.example?token=' + token),
  )
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.products[0].image_url, '')
  assert.equal(data.products[0].price, 56.4)
})
