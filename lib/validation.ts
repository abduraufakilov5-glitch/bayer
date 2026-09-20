export const MAX_ORDER_PRODUCTS = 300
export const MAX_QUANTITY = 99
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseDecimal(value: string): number {
  const normalized = value.trim().replace(',', '.')
  return /^\d+(?:\.\d{1,2})?$/.test(normalized) ? Number(normalized) : NaN
}

export function safeSupplierUrl(value: string | null): string | null {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null
  } catch { return null }
}

export function validPricing(name: string, cny: number, work: number, weight: number) {
  return name.trim().length > 0 && name.trim().length <= 200 &&
    Number.isFinite(cny) && cny >= 0 && cny <= 1_000_000 &&
    Number.isFinite(work) && work >= 0 && work <= 1_000_000 &&
    Number.isInteger(weight) && weight > 0 && weight <= 5000
}

export function restoreCart(raw: string | null, productIds: string[]): Record<string, number> {
  try {
    const stored = JSON.parse(raw ?? '{}')
    if (stored.version !== 1 || !stored.quantities || typeof stored.quantities !== 'object') return {}
    return Object.fromEntries(productIds.flatMap(id => {
      const quantity = stored.quantities[id]
      return Number.isInteger(quantity) && quantity > 0 && quantity <= MAX_QUANTITY ? [[id, quantity]] : []
    }))
  } catch { return {} }
}
