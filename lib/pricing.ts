export const CNY_TO_TJS = 1.4
export const CARGO_PER_KG_TJS = 30
export const DEFAULT_WEIGHT_GRAMS = 80
export const CARGO_RATES = { auto: 30, air: 60 } as const
export type CargoMethod = keyof typeof CARGO_RATES
export function calculateCargo(
  weightGrams = DEFAULT_WEIGHT_GRAMS,
  rate = CARGO_PER_KG_TJS,
) {
  return roundMoney((weightGrams / 1000) * rate)
}
export function calculateClientPrice(
  priceCny: number | null,
  work = 0,
  weight = DEFAULT_WEIGHT_GRAMS,
  rate = CARGO_PER_KG_TJS,
  exchange = CNY_TO_TJS,
): number | null {
  return priceCny == null
    ? null
    : roundMoney(priceCny * exchange + calculateCargo(weight, rate) + work)
}
export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
export function formatSomoni(value: number | null) {
  return value == null
    ? 'Неизвестно'
    : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(
        value,
      ) + ' смн'
}
