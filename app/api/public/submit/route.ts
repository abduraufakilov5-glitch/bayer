import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const token = typeof body.token === 'string' ? body.token : ''
    const items = Array.isArray(body.items) ? body.items : null
    if (!token || !items) return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })

    const normalized = items.map((item) => ({
      product_id: String(item.product_id),
      quantity: Number(item.quantity),
    }))

    if (normalized.some((item) => !Number.isInteger(item.quantity) || item.quantity < 0 || item.quantity > 99)) {
      return NextResponse.json({ error: 'Некорректное количество' }, { status: 400 })
    }
    if (!normalized.some((item) => item.quantity > 0)) return NextResponse.json({ error: 'Выберите хотя бы один товар' }, { status: 400 })

    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('submit_public_order', { p_token: token, p_items: normalized })
    if (error || !data?.[0]) return NextResponse.json({ error: error?.message || 'Заказ уже отправлен или недоступен' }, { status: 400 })

    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID
    if (botToken && chatId) {
      try {
        const submissionId = data[0].submission_id
        const { data: submission } = await supabase.from('order_submissions').select('id, order_id, total_quantity').eq('id', submissionId).single()
        const { data: order } = await supabase.from('orders').select('order_number, title').eq('id', submission?.order_id).single()
        const { data: submissionItems } = await supabase.from('order_submission_items').select('product_name, quantity').eq('submission_id', submissionId).order('created_at')
        const lines = (submissionItems ?? []).map((item) => '• ' + item.product_name + ' × ' + item.quantity).join('\n')
        const message = '🛒 Новый подтверждённый заказ\n#' + String(order?.order_number ?? '').padStart(5, '0') + ' — ' + (order?.title ?? '') + '\n\n' + lines + '\n\nВсего: ' + (submission?.total_quantity ?? data[0].total_quantity) + ' шт.'
        const telegramResponse = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: message }),
        })
        if (telegramResponse.ok) {
          await supabase.from('order_submissions').update({ telegram_notified_at: new Date().toISOString() }).eq('id', submissionId)
        }
      } catch {
        // The order is already saved; Telegram is best-effort.
      }
    }

    return NextResponse.json({ submission_id: data[0].submission_id, total_quantity: data[0].total_quantity })
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  }
}
