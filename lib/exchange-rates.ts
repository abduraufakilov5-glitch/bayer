export type ExchangeRates = {
  usd: number
  cny: number
  rub: number
  date: string
  fetched_at: string
  source: string
}
export const NBT_SOURCE = 'https://nbt.tj/ru/kurs/kurs.php'
export function dushanbeDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dushanbe',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
export function parseNbtHtml(html: string): ExchangeRates {
  const date = html.match(/установил на\s*<strong>\s*(\d{2})\.(\d{2})\.(\d{4})/)
  if (!date) throw new Error('Дата НБТ не найдена')
  const values = new Map<string, number>()
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (c) => c[1].replace(/<[^>]*>/g, '').trim(),
    )
    if (cells.length !== 5) continue
    const nominal = Number(cells[2]),
      value = Number(cells[4].replace(',', '.')) / nominal
    if (Number.isFinite(value) && value > 0)
      values.set(cells[1], Math.round(value * 1e8) / 1e8)
  }
  const usd = values.get('840'),
    cny = values.get('156'),
    rub = values.get('810') ?? values.get('643')
  if (!usd || !cny || !rub) throw new Error('Курсы НБТ не найдены')
  return {
    usd,
    cny,
    rub,
    date: `${date[3]}-${date[2]}-${date[1]}`,
    fetched_at: new Date().toISOString(),
    source: NBT_SOURCE,
  }
}

export function parseRate(value: string) {
  return /^\d+(?:[.,]\d{1,6})?$/.test(value.trim())
    ? Number(value.trim().replace(',', '.'))
    : NaN
}
