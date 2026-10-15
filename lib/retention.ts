export const ORDER_LIFETIME_MS = 25 * 24 * 60 * 60 * 1000
export function expiresAt(created: string) {
  return new Date(created).getTime() + ORDER_LIFETIME_MS
}
export function daysRemaining(created: string, now = Date.now()) {
  return Math.max(0, Math.ceil((expiresAt(created) - now) / 86400000))
}
