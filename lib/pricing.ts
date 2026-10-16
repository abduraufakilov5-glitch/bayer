import type { Product, SubmissionItem } from './types'

export const CNY_TO_TJS = 1.4
export const CARGO_PER_KG_TJS = 30
export const DEFAULT_WEIGHT_GRAMS = 80

export function calculateCargo(weightGrams: number = DEFAULT_WEIGHT_GRAMS) {
  return roundMoney((weightGrams / 1000) * CARGO_PER_KG_TJS)
}

export function calculateClientPrice(priceCny: number, workPriceSomoni: number = 0, weightGrams: number = DEFAULT_WEIGHT_GRAMS) {
  return roundMoney(priceCny * CNY_TO_TJS + calculateCargo(weightGrams) + workPriceSomoni)
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
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
    const shipping = product?.cargo_cost ?? (product?.weight_grams != null ? calculateCargo(product.weight_grams) : null)
    const buying = item.cost_price != null && shipping != null
      ? roundMoney(item.cost_price - shipping)
      : product?.price_cny != null ? roundMoney(product.price_cny * CNY_TO_TJS) : null
    const cost = item.cost_price ?? (buying != null && shipping != null ? roundMoney(buying + shipping) : null)
    purchase = purchase == null || buying == null ? null : roundMoney(purchase + buying * item.quantity)
    cargo = cargo == null || shipping == null ? null : roundMoney(cargo + shipping * item.quantity)
    revenue = revenue == null || item.price == null ? null : roundMoney(revenue + item.price * item.quantity)
    costs = costs == null || cost == null ? null : roundMoney(costs + cost * item.quantity)
  }
  return {purchase, cargo, revenue, costs, earnings: revenue != null && costs != null ? roundMoney(revenue - costs) : null}
}
