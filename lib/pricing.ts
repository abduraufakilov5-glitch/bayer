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
