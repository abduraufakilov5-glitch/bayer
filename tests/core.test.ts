import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateCargo, calculateClientPrice, roundMoney } from '../lib/pricing.ts'
import { filterOrders, toCsv } from '../lib/orders.ts'
import { parseDecimal, restoreCart, safeSupplierUrl, validPricing } from '../lib/validation.ts'
import type { Order } from '../lib/types.ts'

test('pricing includes purchase, cargo and buyer work without floating point tails', () => {
  assert.equal(calculateCargo(120, 9.224), 3.87)
  assert.equal(calculateClientPrice(35, 5, 120, 1.45, 9.224), 59.62)
  assert.equal(roundMoney(1.005), 1.01)
  assert.equal(roundMoney(69.665), 69.67)
  assert.equal(roundMoney(-69.665), -69.67)
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


test('order finances use selected quantities, separate cargo and preserve receipt costs', async () => {
  const {calculateOrderFinances} = await import('../lib/pricing.ts')
  const products = [
    {id:'a',price_cny:35,cargo_cost:2.4,weight_grams:80},
    {id:'b',price_cny:10,cargo_cost:6,weight_grams:200},
    {id:'unselected',price_cny:999,cargo_cost:100},
  ] as import('../lib/types').Product[]
  const items = [
    {product_id:'a',price:56.4,quantity:2,cost_price:51.4},
    {product_id:'b',price:23,quantity:3,cost_price:20},
  ] as import('../lib/types').SubmissionItem[]
  assert.deepEqual(calculateOrderFinances(items,products), {purchase:140,cargo:22.8,revenue:181.8,costs:162.8,earnings:19})
  products[0].price_cny = 100
  assert.equal(calculateOrderFinances(items,products).purchase,140)
  assert.deepEqual(calculateOrderFinances([{product_id:null,price:10,quantity:2,cost_price:null}] as import('../lib/types').SubmissionItem[], []), {purchase:null,cargo:null,revenue:20,costs:null,earnings:null})
  assert.equal(calculateOrderFinances([{product_id:null,price:10,quantity:2,cost_price:12}] as import('../lib/types').SubmissionItem[], []).earnings,-4)
  assert.deepEqual(calculateOrderFinances([{product_id:'free',price:0,quantity:2,cost_price:0}] as import('../lib/types').SubmissionItem[], [{id:'free',price_cny:0,cargo_cost:0}] as import('../lib/types').Product[]), {purchase:0,cargo:0,revenue:0,costs:0,earnings:0})
})
