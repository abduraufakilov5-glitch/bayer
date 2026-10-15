import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { runMaintenance } from '../lib/server/maintenance'
import { GET } from '../app/api/maintenance/route'
test('cron rejects missing or incorrect bearer authentication before any service access', async () => {
  const previous = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'test-cron-secret'
  try {
    for (const auth of ['', 'Bearer wrong', 'Bearer ' + 'x'.repeat(16)])
      assert.equal(
        (
          await GET(
            new Request('http://localhost/api/maintenance', {
              headers: { authorization: auth },
            }),
          )
        ).status,
        401,
      )
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = previous
  }
})
test('maintenance fences concurrent runs, batches deletion, retries failed Storage and logs counts only', async () => {
  const calls: { path: string; body: unknown }[] = []
  let gcReads = 0
  const client = createClient('https://fixture.example', 'fixture-service', {
    global: {
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname,
          body = init?.body ? JSON.parse(String(init.body)) : null
        calls.push({ path, body })
        if (path.endsWith('buyer_claim_job')) return Response.json(true)
        if (path.endsWith('buyer_cleanup_batch')) return Response.json(1)
        if (path.endsWith('buyer_gc_paths'))
          return Response.json(
            gcReads++ === 0 ? [{ path: 'owner/orphan.jpg' }] : [],
          )
        if (path.includes('/storage/'))
          return Response.json(
            { message: 'Storage unavailable' },
            { status: 503 },
          )
        return new Response(null, { status: 204 })
      },
    },
  })
  const result = await runMaintenance(client)
  assert.deepEqual(result, {
    orders_deleted: 1,
    images_deleted: 0,
    failures: 1,
  })
  const ack = calls.find((c) => c.path.endsWith('buyer_gc_ack'))!
  assert.equal((ack.body as { p_success: boolean }).p_success, false)
  const log = calls.find((c) => c.path.endsWith('buyer_job_runs'))!
  assert.deepEqual(log.body, result)
  assert.ok(calls.at(-1)!.path.endsWith('buyer_job_lease'))
  const skipped = createClient('https://fixture.example', 'fixture-only', {
    global: { fetch: async () => Response.json(false) },
  })
  const resultSkipped = await runMaintenance(skipped)
  assert.ok('skipped' in resultSkipped && resultSkipped.skipped)
})

test('maintenance drains more than one image batch for a large order', async () => {
  let pages = 0,
    deletes = 0
  const client = createClient('https://fixture.example', 'fixture-service', {
    global: {
      fetch: async (input) => {
        const path = new URL(String(input)).pathname
        if (path.endsWith('buyer_claim_job')) return Response.json(true)
        if (path.endsWith('buyer_cleanup_batch')) return Response.json(0)
        if (path.endsWith('buyer_gc_paths'))
          return Response.json(
            pages++ < 3
              ? Array.from({ length: 100 }, (_, i) => ({
                  path: `owner/${pages}-${i}.jpg`,
                }))
              : [],
          )
        if (path.includes('/storage/')) {
          deletes++
          return Response.json([])
        }
        return new Response(null, { status: 204 })
      },
    },
  })
  const result = await runMaintenance(client)
  assert.equal(deletes, 3)
  assert.equal(result.images_deleted, 300)
  assert.equal(result.failures, 0)
})
