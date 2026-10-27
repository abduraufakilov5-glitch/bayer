import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  balances,
  debtRemaining,
  EMPTY_WALLET,
  parseQuickExpense,
  periodBounds,
  projectOrders,
  report,
  walletSummary,
  type WalletData,
  type Entry,
} from '../lib/wallet'
import {
  dushanbeDate,
  parseAlifVisaRates,
  isFreshVisaRates,
  ALIF_VISA_SOURCE,
  parseRate,
} from '../lib/exchange-rates'
function entry(p: Partial<Entry>): Entry {
  return {
    id: 'e',
    account_id: 'cash',
    to_account_id: null,
    kind: 'expense',
    amount: 10,
    rate: 1,
    to_amount: null,
    category: 'Продукты',
    note: '',
    entry_date: '2026-10-27',
    planned: false,
    order_id: null,
    debt_id: null,
    voided_at: null,
    ...p,
  }
}
function wallet(): WalletData {
  return {
    ...EMPTY_WALLET,
    accounts: [
      { id: 'cash', name: 'Наличные', currency: 'TJS', opening_balance: 1000 },
      { id: 'bank', name: 'Карта', currency: 'TJS', opening_balance: 0 },
    ],
    entries: [],
  }
}
test('actual balance ignores forecasts, handles transfers, refunds and voided history', () => {
  const d = wallet()
  d.entries = [
    entry({
      kind: 'transfer',
      amount: 100,
      to_account_id: 'bank',
      to_amount: 100,
    }),
    entry({ amount: 50 }),
    entry({ kind: 'expense_refund', amount: 20 }),
    entry({ kind: 'income', amount: 200, planned: true }),
    entry({ amount: 999, voided_at: '2026-10-27' }),
  ]
  assert.equal(balances(d).get('cash'), 870)
  assert.equal(balances(d).get('bank'), 100)
  assert.equal(walletSummary(d, null).cash, 970)
  const r = report(d, 'month', 0, new Date('2026-10-27T00:00Z'))
  assert.equal(r.expenses, 30)
  assert.equal(r.income, 0)
})
test('orders remain expected after completion until cash arrives; plans replace automatic reserves', () => {
  const d = wallet()
  d.orders = [
    {
      id: 'o',
      title: 'Заказ',
      order_number: 1,
      status: 'completed',
      deleted_at: null,
      revenue: 600,
      costs: 400,
      cargo: 100,
      weight: 1200,
    },
  ]
  d.entries = [
    entry({ kind: 'order_payment', amount: 200, order_id: 'o' }),
    entry({ amount: 100, category: 'Закупка', order_id: 'o' }),
    entry({ amount: 80, category: 'Карго', planned: true, order_id: 'o' }),
  ]
  const s = walletSummary(d, null)
  assert.equal(s.cash, 1100)
  assert.equal(s.expected, 400)
  assert.equal(s.planned, 280)
  assert.equal(s.forecast, 1220)
  assert.equal(projectOrders(d)[0].profit, 200)
  d.orders[0].deleted_at = '2026-10-27'
  assert.equal(projectOrders(d)[0].expected, 400) // Trash does not forgive an obligation.
  d.settings = [
    {
      order_id: 'o',
      cancelled: true,
      actual_weight_grams: null,
      cargo_rate_tjs: null,
    },
  ]
  // Cancelled orders do not generate automatic receivables, but paid money needs a refund.
  assert.equal(projectOrders(d)[0].expected, 0)
  assert.equal(walletSummary(d, null).refunds, 200)
  assert.equal(walletSummary(d, null).planned, 0)
  d.entries.push(entry({ kind: 'order_refund', amount: 200, order_id: 'o' }))
  assert.equal(walletSummary(d, null).refunds, 0)
})
test('loans and partial repayments affect cash but not ordinary income and expense reports', () => {
  const d = wallet()
  const debt = {
    id: 'd',
    person: 'Али',
    direction: 'receivable' as const,
    amount_tjs: 300,
    due_date: null,
    note: '',
  }
  d.debts = [debt]
  d.entries = [
    entry({ kind: 'loan_out', amount: 300, debt_id: 'd' }),
    entry({ kind: 'debt_receive', amount: 75, debt_id: 'd' }),
  ]
  assert.equal(debtRemaining(debt, d.entries), 225)
  assert.equal(balances(d).get('cash'), 775)
  const r = report(d, 'week', 0, new Date('2026-10-27'))
  assert.equal(r.income, 0)
  assert.equal(r.expenses, 0)
})
test('Dushanbe dates and Monday/month boundaries cross UTC, month and year correctly', () => {
  assert.equal(dushanbeDate(new Date('2026-10-26T20:00:00Z')), '2026-10-27')
  assert.deepEqual(periodBounds('week', 0, new Date('2026-11-01T20:00:00Z')), {
    start: '2026-11-02',
    end: '2026-11-09',
  })
  assert.deepEqual(periodBounds('month', -1, new Date('2027-01-01')), {
    start: '2026-12-01',
    end: '2027-01-01',
  })
  assert.deepEqual(parseQuickExpense('такси 30,50'), {
    note: 'такси',
    amount: '30.50',
    category: 'Транспорт',
  })
  assert.equal(parseQuickExpense('такси -30'), null)
  assert.equal(parseRate('1,3832'), 1.3832)
})
test('Alif selects Visa sell quotes and ignores all other channels', () => {
  const now = new Date('2026-10-27T12:00:00Z')
  const payload = {
    localRates: [
      ['USD', '9.2500'],
      ['CNY', '1.3933'],
      ['RUB', '0.1159'],
    ].map(([name, visaSellValue]) => ({
      name,
      visaSellValue,
      visaBuyValue: '999',
      sellValue: '888',
      nbtValue: '777',
      walletSellValue: '666',
      createdAt: '2026-10-27 12:17:36',
      updatedAt: null,
    })),
  }
  const r = parseAlifVisaRates(payload, now)
  assert.equal(r.usd, 9.25)
  assert.equal(r.cny, 1.3933)
  assert.equal(r.rub, 0.1159)
  assert.equal(r.source, ALIF_VISA_SOURCE)
  assert.ok(isFreshVisaRates(r, now))
  assert.equal(
    isFreshVisaRates({ ...r, source: 'https://nbt.tj/ru/kurs/kurs.php' }, now),
    false,
  )
  assert.equal(isFreshVisaRates(r, new Date('2026-10-27T13:00:00Z')), false)
  assert.equal(
    isFreshVisaRates(
      { ...r, fetched_at: '2026-10-27T18:59:00Z' },
      new Date('2026-10-27T19:01:00Z'),
    ),
    false,
  )
  assert.throws(() =>
    parseAlifVisaRates({ localRates: payload.localRates.slice(1) }, now),
  )
  assert.throws(() =>
    parseAlifVisaRates(
      { localRates: [...payload.localRates, payload.localRates[0]] },
      now,
    ),
  )
  for (const value of [null, '', 0, 'NaN', '-1', 'Infinity']) {
    assert.throws(() =>
      parseAlifVisaRates(
        {
          localRates: payload.localRates.map((row, i) =>
            i === 0 ? { ...row, visaSellValue: value } : row,
          ),
        },
        now,
      ),
    )
  }
  assert.throws(() =>
    parseAlifVisaRates(
      {
        localRates: payload.localRates.map((row) => ({
          ...row,
          updatedAt: '2026-10-28 00:00:00',
        })),
      },
      now,
    ),
  )
  assert.throws(() =>
    parseAlifVisaRates(
      {
        localRates: payload.localRates.map((row) => ({
          ...row,
          createdAt: '2026-02-30',
        })),
      },
      now,
    ),
  )
})
