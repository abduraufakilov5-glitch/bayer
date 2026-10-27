import type { Product, SubmissionItem } from './types'

export const CNY_TO_TJS = 1.45
export const CARGO_PER_KG_USD = 3.5
// Explicit dated manual default; automatic quotes come from Visa Alif.
export const USD_TO_TJS = 9.224
export const CARGO_PER_KG_TJS = CARGO_PER_KG_USD * USD_TO_TJS
export const DEFAULT_WEIGHT_GRAMS = 120

export function calculateCargo(weightGrams: number = DEFAULT_WEIGHT_GRAMS, usdRate: number = USD_TO_TJS) {
  return roundMoney((weightGrams / 1000) * CARGO_PER_KG_USD * usdRate)
}

export function calculateClientPrice(priceCny: number, workPriceSomoni: number = 0, weightGrams: number = DEFAULT_WEIGHT_GRAMS, cnyRate: number = CNY_TO_TJS, usdRate: number = USD_TO_TJS) {
  return roundMoney(priceCny * cnyRate + calculateCargo(weightGrams, usdRate) + workPriceSomoni)
}

export function roundMoney(value: number) {
  // Scale the tolerance with the value: 69.665 is slightly below its decimal
  // representation in binary. Round half cents consistently in either direction.
  const scaled = Math.abs(value * 100)
  return Math.sign(value) * Math.round(scaled + Number.EPSILON * scaled * 2) / 100
}

export function formatSomoni(value: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value) + ' смн'
}

// Receipt costs include cargo. Split it out once, and never treat missing costs as zero.
export function calculateOrderFinances(items: SubmissionItem[], products: Product[]) {
  const byId = new Map(products.map(product => [product.id, product]))
  let purchase: number | null = 0, cargo: number | null = 0
  let revenue: number | null = 0, costs: number | null = 0
  for (const item of items) {
    const product = item.product_id ? byId.get(item.product_id) : undefined
    const shipping = product?.cargo_cost ?? (product?.weight_grams != null ? roundMoney(product.weight_grams / 1000 * (product.usd_rate ? CARGO_PER_KG_USD * product.usd_rate : 30)) : null)
    const buying = item.cost_price != null && shipping != null
      ? roundMoney(item.cost_price - shipping)
      : product?.price_cny != null ? roundMoney(product.purchase_cost_tjs ?? product.price_cny * 1.4) : null
    const cost = item.cost_price ?? (buying != null && shipping != null ? roundMoney(buying + shipping) : null)
    purchase = purchase == null || buying == null ? null : roundMoney(purchase + buying * item.quantity)
    cargo = cargo == null || shipping == null ? null : roundMoney(cargo + shipping * item.quantity)
    revenue = revenue == null || item.price == null ? null : roundMoney(revenue + item.price * item.quantity)
    costs = costs == null || cost == null ? null : roundMoney(costs + cost * item.quantity)
  }
  return {purchase, cargo, revenue, costs, earnings: revenue != null && costs != null ? roundMoney(revenue - costs) : null}
}
