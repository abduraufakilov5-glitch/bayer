import type { SupabaseClient } from '@supabase/supabase-js'
import { createTelegramNotifier } from '../../supabase/functions/buyer-public-order/telegram'
export async function runMaintenance(
  client: SupabaseClient,
  notify?: ReturnType<typeof createTelegramNotifier>,
) {
  const token = crypto.randomUUID(),
    started = Date.now(),
    result = { orders_deleted: 0, images_deleted: 0, failures: 0 }
  const lease = await client.rpc('buyer_claim_job', { p_token: token })
  if (lease.error) throw lease.error
  if (!lease.data) return { ...result, skipped: true }
  try {
    for (let batch = 0; batch < 20 && Date.now() - started < 35000; batch++) {
      const r = await client.rpc('buyer_cleanup_batch', { p_token: token })
      if (r.error) throw r.error
      result.orders_deleted += r.data
      if (r.data < 50) break
    }
    const paths = await client.rpc('buyer_gc_paths', { p_token: token })
    if (paths.error) throw paths.error
    // Batches of 20 keep HTTP and memory bounded; failures stay queued with exponential backoff.
    for (
      let i = 0;
      i < (paths.data?.length ?? 0) && Date.now() - started < 45000;
      i += 20
    ) {
      const batch = (paths.data as { path: string }[])
        .slice(i, i + 20)
        .map((p) => p.path)
      const removed = await client.storage
        .from('buyer-product-images')
        .remove(batch)
      const ack = await client.rpc('buyer_gc_ack', {
        p_token: token,
        p_paths: batch,
        p_success: !removed.error,
      })
      if (ack.error) throw ack.error
      if (removed.error) result.failures += batch.length
      else result.images_deleted += batch.length
    }
    if (notify && Date.now() - started < 45000) {
      const pending = await client
        .from('buyer_submissions')
        .select(
          'id,order_id,total_quantity,confirmed_at,buyer_orders!inner(order_number)',
        )
        .is('telegram_notified_at', null)
        .order('confirmed_at')
        .limit(10)
      if (pending.error) result.failures++
      for (const row of pending.data ?? []) {
        if (Date.now() - started > 45000) break
        const o = row.buyer_orders as unknown as { order_number: number }
        await notify({
          submission_id: row.id,
          order_id: row.order_id,
          order_number: o.order_number,
          total_quantity: row.total_quantity,
          confirmed_at: row.confirmed_at,
        })
      }
    }
    const log = await client.from('buyer_job_runs').insert(result)
    if (log.error) throw log.error
    return result
  } finally {
    await client
      .from('buyer_job_lease')
      .delete()
      .eq('name', 'maintenance')
      .eq('token', token)
  }
}
