export type ExchangeRates = {
  usd: number
  cny: number
  rub: number
  date: string
  fetched_at: string
  source: string
}
export const ALIF_VISA_SOURCE = 'https://alif.tj/api/rates'
export const RATE_CACHE_MS = 60 * 60 * 1000
export function dushanbeDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dushanbe',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

// Bank sells foreign currency when the customer spends somoni on a foreign purchase.
// Never substitute cash, wallet, NBT or Visa buy quotes for the Visa sell quote.
export function parseAlifVisaRates(
  payload: unknown,
  now = new Date(),
): ExchangeRates {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('localRates' in payload) ||
    !Array.isArray(payload.localRates)
  ) {
    throw new Error('Неверный ответ Алиф')
  }
  const values: Record<string, number> = {},
    dates: string[] = []
  for (const currency of ['USD', 'CNY', 'RUB']) {
    const rows = payload.localRates.filter(
      (row) => row && typeof row === 'object' && row.name === currency,
    )
    if (rows.length !== 1)
      throw new Error('Не найден однозначный курс Visa Алиф: ' + currency)
    const row = rows[0],
      raw = row.visaSellValue
    const value =
      (typeof raw === 'string' && /^\d+(?:\.\d{1,6})?$/.test(raw)) ||
      typeof raw === 'number'
        ? Number(raw)
        : NaN
    const timestamp = row.updatedAt ?? row.createdAt
    const date = typeof timestamp === 'string' ? timestamp.slice(0, 10) : ''
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      value > 1000000 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date ||
      date > dushanbeDate(now)
    ) {
      throw new Error('Некорректный курс или дата Visa Алиф: ' + currency)
    }
    values[currency] = value
    dates.push(date)
  }
  return {
    usd: values.USD,
    cny: values.CNY,
    rub: values.RUB,
    date: dates.sort()[0],
    fetched_at: now.toISOString(),
    source: ALIF_VISA_SOURCE,
  }
}
export function isFreshVisaRates(
  rates: ExchangeRates | null,
  now = new Date(),
) {
  if (
    !rates ||
    rates.source !== ALIF_VISA_SOURCE ||
    rates.date > dushanbeDate(now)
  )
    return false
  const fetched = new Date(rates.fetched_at).getTime(),
    age = now.getTime() - fetched
  return (
    Number.isFinite(fetched) &&
    age >= 0 &&
    age < RATE_CACHE_MS &&
    dushanbeDate(new Date(fetched)) === dushanbeDate(now)
  )
}
export function parseRate(value: string) {
  return /^\d+(?:[.,]\d{1,6})?$/.test(value.trim())
    ? Number(value.trim().replace(',', '.'))
    : NaN
}
