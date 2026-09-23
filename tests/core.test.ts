import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateCargo, calculateClientPrice, roundMoney } from '../lib/pricing.ts'
import { filterOrders, toCsv } from '../lib/orders.ts'
import { parseDecimal, restoreCart, safeSupplierUrl, validPricing } from '../lib/validation.ts'
import type { Order } from '../lib/types.ts'

test('pricing includes purchase, cargo and buyer work without floating point tails', () => {
  assert.equal(calculateCargo(80), 2.4)
  assert.equal(calculateClientPrice(35, 5, 80), 56.4)
  assert.equal(roundMoney(1.005), 1.01)
})
test('pricing requires explicit prices, accepts Russian decimals and rejects invalid weights/URLs', () => {
  assert.equal(parseDecimal(' 12,50 '), 12.5)
  for (const input of ['', ' ', 'NaN', 'Infinity', '-1', '1e2', '1.123', '0x10']) assert.ok(Number.isNaN(parseDecimal(input)))
  assert.ok(validPricing('Платок', 0, 0, 80))
  for (const weight of [0, -1, 80.5, 5001, Infinity]) assert.equal(validPricing('Платок', 10, 5, weight), false)
  assert.equal(safeSupplierUrl('javascript:alert(1)'), null)
  assert.equal(safeSupplierUrl('https://example.com/p'), 'https://example.com/p')
})
test('cart restoration ignores removed products, corrupted storage and invalid quantities', () => {
  const raw = JSON.stringify({ version: 1, quantities: { a: 2, b: 100, c: 1.2, d: -1, removed: 5 } })
  assert.deepEqual(restoreCart(raw, ['a', 'b', 'c', 'd']), { a: 2 })
  for (const raw of ['invalid', 'null', '{"version":2}', '{}']) assert.deepEqual(restoreCart(raw, ['a']), {})
})
test('order search combines status and case insensitive title/number without mutating input', () => {
  const orders = [
    { id: 'a', title: 'Осень', order_number: 12, status: 'waiting', created_at: '2026-01-01' },
    { id: 'b', title: 'Зима', order_number: 13, status: 'received', created_at: '2026-02-01' },
  ] as Order[]
  assert.equal(filterOrders(orders, 'ОСЕНЬ', 'waiting', 'newest')[0].id, 'a')
  assert.equal(filterOrders(orders, '#00013', 'all', 'newest')[0].id, 'b')
  assert.equal(filterOrders(orders, 'Зима', 'waiting', 'newest').length, 0)
  assert.equal(filterOrders(orders, '', 'all', 'newest')[0].id, 'b')
  assert.equal(orders[0].id, 'a')
})
test('CSV quotes delimiters/newlines and neutralizes spreadsheet formulas', () => {
  const csv = toCsv([['=HYPERLINK("bad")', '  +cmd', 'a;b\nc', 5, null]])
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'))
  assert.ok(csv.includes('"\'  +cmd"'))
  assert.ok(csv.includes('"a;b\nc";"5";""'))
})

test('optional price preserves absent and zero values and rejects invalid inputs', async () => {
  const {parseOptionalPrice} = await import('../lib/validation')
  assert.equal(parseOptionalPrice(''), null)
  assert.equal(parseOptionalPrice('  '), null)
  assert.equal(parseOptionalPrice('0'), 0)
  assert.equal(parseOptionalPrice('12,50'), 12.5)
  for (const value of ['-1', 'Infinity', '1.001', '1000001']) assert.ok(Number.isNaN(parseOptionalPrice(value)))
})
