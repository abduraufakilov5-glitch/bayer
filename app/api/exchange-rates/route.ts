import { createClient } from '@/lib/supabase/server'
import { dushanbeDate, NBT_SOURCE, parseNbtHtml } from '@/lib/exchange-rates'
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return Response.json({ error: 'Войдите в аккаунт' }, { status: 401 })
  const { data: stored } = await supabase
    .from('wallet_rates')
    .select('*')
    .eq('owner_id', user.id)
    .maybeSingle()
  const cached = stored
    ? {
        ...stored,
        usd: Number(stored.usd),
        cny: Number(stored.cny),
        rub: Number(stored.rub),
        date: String(stored.date).slice(0, 10),
      }
    : null
  if (cached && dushanbeDate(new Date(cached.fetched_at)) === dushanbeDate())
    return Response.json({ rates: cached, stale: cached.date < dushanbeDate() })
  try {
    // Request today's rates explicitly: the default NBT page can already show tomorrow.
    const response = await fetch(
      `${NBT_SOURCE}?date=${dushanbeDate().split('-').reverse().join('.')}`,
      { cache: 'no-store', signal: AbortSignal.timeout(12000) },
    )
    if (!response.ok) throw new Error('НБТ недоступен')
    const rates = parseNbtHtml(await response.text())
    if (rates.date > dushanbeDate()) throw new Error('НБТ вернул будущую дату')
    const { error } = await supabase
      .from('wallet_rates')
      .upsert({ ...rates, owner_id: user.id })
    if (error) throw error
    return Response.json({ rates, stale: rates.date < dushanbeDate() })
  } catch {
    return Response.json(
      {
        rates: cached ?? null,
        stale: true,
        error:
          'Не удалось обновить НБТ. Используйте последний сохранённый или ручной курс.',
      },
      { status: cached ? 200 : 503 },
    )
  }
}
