import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!botToken || !chatId) return NextResponse.json({ ok: true, skipped: true })

  try {
    const { submissionId } = await request.json()
    if (typeof submissionId !== 'string') return NextResponse.json({ error: 'Bad request' }, { status: 400 })

    const supabase = createAdminClient()
    const { data: submission } = await supabase.from('order_submissions').select('id, order_id, total_quantity, confirmed_at, telegram_notified_at').eq('id', submissionId).single()
    if (!submission) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (submission.telegram_notified_at) return NextResponse.json({ ok: true, alreadySent: true })

    const { data: order } = await supabase.from('orders').select('order_number, title').eq('id', submission.order_id).single()
    const { data: items } = await supabase.from('order_submission_items').select('product_name, quantity').eq('submission_id', submission.id).order('created_at')

    const lines = (items ?? []).map((item) => '• ' + item.product_name + ' × ' + item.quantity).join('\n')
    const text = '🛒 Новый подтверждённый заказ\n#' + String(order?.order_number ?? '').padStart(5, '0') + ' — ' + (order?.title ?? '') + '\n\n' + lines + '\n\nВсего: ' + submission.total_quantity + ' шт.'

    const telegramResponse = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
    if (!telegramResponse.ok) return NextResponse.json({ error: 'Telegram error' }, { status: 502 })

    await supabase.from('order_submissions').update({ telegram_notified_at: new Date().toISOString() }).eq('id', submission.id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Notification failed' }, { status: 500 })
  }
}
