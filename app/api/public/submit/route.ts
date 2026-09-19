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

    return NextResponse.json({ submission_id: data[0].submission_id, total_quantity: data[0].total_quantity })
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  }
}
