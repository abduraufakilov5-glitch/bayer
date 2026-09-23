import type { SupabaseClient } from '@supabase/supabase-js'

type Config = { botToken: string; chatId: string; ownerId: string }
export type Receipt = { submission_id: string; order_id: string; order_number: number; total_quantity: number; confirmed_at: string }

// Best-effort delivery: the order is already committed. A failed notification
// must never turn a successful confirmation into an error for the customer.
export function createTelegramNotifier(client: SupabaseClient, config: Config, send: typeof fetch = fetch) {
  return async (receipt: Receipt) => {
    if (!config.botToken || !config.chatId || !config.ownerId) return
    const {data: order, error} = await client.from('buyer_orders').select('owner_id').eq('id', receipt.order_id).single()
    if (error || order?.owner_id !== config.ownerId) return
    const claimedAt = new Date().toISOString()
    const expired = new Date(Date.now() - 60000).toISOString()
    const {data: claim, error: claimError} = await client.from('buyer_submissions').update({telegram_claimed_at: claimedAt}).eq('id', receipt.submission_id).is('telegram_notified_at', null).or(`telegram_claimed_at.is.null,telegram_claimed_at.lt.${expired}`).select('id').maybeSingle()
    if (claimError || !claim) return
    try {
      const response = await send(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, signal: AbortSignal.timeout(5000),
        body: JSON.stringify({chat_id: config.chatId, text: `Новый подтверждённый заказ #${String(receipt.order_number).padStart(5, '0')}\nВсего: ${receipt.total_quantity} шт.\nПодтверждён: ${receipt.confirmed_at}`}),
      })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error('Telegram rejected notification')
      const {error: updateError} = await client.from('buyer_submissions').update({telegram_notified_at: new Date().toISOString(), telegram_claimed_at: null}).eq('id', receipt.submission_id).eq('telegram_claimed_at', claimedAt)
      if (updateError) console.warn('Telegram sent, receipt marker could not be saved')
    } catch {
      await client.from('buyer_submissions').update({telegram_claimed_at: null}).eq('id', receipt.submission_id).eq('telegram_claimed_at', claimedAt)
      console.warn('Telegram notification failed; order remains confirmed')
    }
  }
}
