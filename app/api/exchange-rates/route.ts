import { createClient } from '@/lib/supabase/server'
import {
  dushanbeDate,
  ALIF_VISA_SOURCE,
  isFreshVisaRates,
  parseAlifVisaRates,
} from '@/lib/exchange-rates'
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
  const cached =
    stored?.source === ALIF_VISA_SOURCE
      ? {
          ...stored,
          usd: Number(stored.usd),
          cny: Number(stored.cny),
          rub: Number(stored.rub),
          date: String(stored.date).slice(0, 10),
        }
      : null
  if (cached && isFreshVisaRates(cached))
    return Response.json({
      rates: cached,
      stale: cached.date < dushanbeDate(),
    })
  try {
    const response = await fetch(ALIF_VISA_SOURCE, {
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    })
    if (!response.ok) throw new Error('Алиф недоступен')
    const rates = parseAlifVisaRates(await response.json())
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
          'Не удалось обновить курс Visa Алиф. Используйте последний сохранённый курс Visa с указанной датой или введите курс вручную.',
      },
      { status: cached ? 200 : 503 },
    )
  }
}
