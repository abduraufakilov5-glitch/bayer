import { roundMoney } from './pricing'
import { dushanbeDate, type ExchangeRates } from './exchange-rates'
export type Currency = 'TJS' | 'USD' | 'CNY' | 'RUB'
export type Account = {
  id: string
  name: string
  currency: Currency
  opening_balance: number
}
export type Entry = {
  id: string
  account_id: string
  to_account_id: string | null
  kind: string
  amount: number
  rate: number
  to_amount: number | null
  category: string
  note: string
  entry_date: string
  planned: boolean
  order_id: string | null
  debt_id: string | null
  voided_at: string | null
}
export type Debt = {
  cancelled_at?: string | null
  id: string
  person: string
  direction: 'receivable' | 'payable'
  amount_tjs: number
  due_date: string | null
  note: string
}
export type WalletOrder = {
  id: string
  title: string
  order_number: number
  status: string
  deleted_at: string | null
  revenue: number | null
  costs: number | null
  cargo: number | null
  weight: number | null
}
export type OrderSetting = {
  order_id: string
  cancelled: boolean
  actual_weight_grams: number | null
  cargo_rate_tjs: number | null
}
export type WalletData = {
  accounts: Account[]
  entries: Entry[]
  debts: Debt[]
  orders: WalletOrder[]
  settings: OrderSetting[]
}
export const EMPTY_WALLET: WalletData = {
  accounts: [],
  entries: [],
  debts: [],
  orders: [],
  settings: [],
}
export const kindLabels: Record<string, string> = {
  income: 'Доход',
  expense: 'Расход',
  transfer: 'Перевод',
  loan_in: 'Получил заём',
  loan_out: 'Выдал заём',
  debt_receive: 'Возврат мне',
  debt_pay: 'Возврат мной',
  order_payment: 'Оплата клиента',
  order_refund: 'Возврат клиенту',
  expense_refund: 'Возврат расхода',
}
export const categories = [
  'Продукты',
  'Кафе',
  'Транспорт',
  'Дом',
  'Здоровье',
  'Покупки',
  'Развлечения',
  'Закупка',
  'Карго',
  'Другое',
]
export const incoming = new Set([
  'income',
  'loan_in',
  'debt_receive',
  'order_payment',
  'expense_refund',
])
export function rateFor(currency: Currency, rates: ExchangeRates | null) {
  return currency === 'TJS'
    ? 1
    : (rates?.[currency.toLowerCase() as 'usd' | 'cny' | 'rub'] ?? null)
}
export function amountTjs(e: Entry) {
  return roundMoney(Number(e.amount) * Number(e.rate))
}
export function balances(data: WalletData) {
  const result = new Map(
    data.accounts.map((a) => [a.id, Number(a.opening_balance)]),
  )
  for (const e of data.entries) {
    if (e.planned || e.voided_at) continue
    result.set(
      e.account_id,
      roundMoney(
        (result.get(e.account_id) ?? 0) +
          (incoming.has(e.kind) ? 1 : -1) * Number(e.amount),
      ),
    )
    if (e.kind === 'transfer' && e.to_account_id)
      result.set(
        e.to_account_id,
        roundMoney((result.get(e.to_account_id) ?? 0) + Number(e.to_amount)),
      )
  }
  return result
}
export function debtRemaining(debt: Debt, entries: Entry[]) {
  if (debt.cancelled_at) return 0
  return roundMoney(
    Number(debt.amount_tjs) -
      entries
        .filter(
          (e) =>
            e.debt_id === debt.id &&
            !e.voided_at &&
            !e.planned &&
            ['debt_receive', 'debt_pay'].includes(e.kind),
        )
        .reduce((s, e) => s + amountTjs(e), 0),
  )
}
export function projectOrders(data: WalletData) {
  return data.orders.map((o) => {
    const setting = data.settings.find((s) => s.order_id === o.id)
    const entries = data.entries.filter(
      (e) => e.order_id === o.id && !e.voided_at && !e.planned,
    )
    const paid = entries.reduce(
      (s, e) =>
        s +
        (e.kind === 'order_payment'
          ? amountTjs(e)
          : e.kind === 'order_refund'
            ? -amountTjs(e)
            : 0),
      0,
    )
    const spent = (category?: string) =>
      entries
        .filter(
          (e) =>
            ['expense', 'expense_refund'].includes(e.kind) &&
            (!category || e.category === category),
        )
        .reduce((s, e) => s + (e.kind === 'expense' ? 1 : -1) * amountTjs(e), 0)
    const cargo =
      setting?.actual_weight_grams && setting.cargo_rate_tjs
        ? roundMoney(
            (setting.actual_weight_grams / 1000) * setting.cargo_rate_tjs,
          )
        : o.cargo
    const purchase =
      o.costs != null && o.cargo != null ? roundMoney(o.costs - o.cargo) : null
    const active =
      !setting?.cancelled &&
      ['received', 'ordered', 'completed'].includes(o.status)
    return {
      ...o,
      cancelled: setting?.cancelled ?? false,
      paid,
      spent: spent(),
      cargo,
      purchase,
      expected:
        active && o.revenue != null
          ? Math.max(0, roundMoney(o.revenue - paid))
          : 0,
      purchaseLeft:
        active && purchase != null
          ? Math.max(0, roundMoney(purchase - spent('Закупка')))
          : 0,
      cargoLeft:
        active && cargo != null
          ? Math.max(0, roundMoney(cargo - spent('Карго')))
          : 0,
      profit:
        o.revenue != null && purchase != null && cargo != null
          ? roundMoney(o.revenue - purchase - cargo)
          : null,
      refundDue: setting?.cancelled ? Math.max(0, paid) : 0,
      incomplete:
        active && (o.revenue == null || purchase == null || cargo == null),
    }
  })
}
export function walletSummary(data: WalletData, rates: ExchangeRates | null) {
  const b = balances(data)
  let cash = 0,
    unvalued = false
  for (const a of data.accounts) {
    const r = rateFor(a.currency, rates)
    if (r == null) {
      unvalued = true
      continue
    }
    cash += (b.get(a.id) ?? 0) * r
  }
  const orders = projectOrders(data)
  // A manual order-linked plan replaces the matching automatic category, preventing double reservation.
  const plans = data.entries.filter(
    (e) =>
      e.planned &&
      !e.voided_at &&
      (!e.order_id || !orders.some((o) => o.id === e.order_id && o.cancelled)),
  )
  const auto = orders.reduce(
    (s, o) =>
      s +
      (['Закупка', 'Карго'] as const).reduce(
        (n, c) =>
          n +
          (plans.some(
            (e) =>
              e.order_id === o.id && e.kind === 'expense' && e.category === c,
          )
            ? 0
            : c === 'Закупка'
              ? o.purchaseLeft
              : o.cargoLeft),
        0,
      ),
    0,
  )
  const planned =
    plans
      .filter((e) => e.kind === 'expense')
      .reduce((s, e) => s + amountTjs(e), 0) + auto
  const expected =
    orders.reduce(
      (s, o) =>
        s +
        (plans.some((e) => e.order_id === o.id && e.kind === 'income')
          ? plans
              .filter((e) => e.order_id === o.id && e.kind === 'income')
              .reduce((n, e) => n + amountTjs(e), 0)
          : o.expected),
      0,
    ) +
    plans
      .filter((e) => e.kind === 'income' && !e.order_id)
      .reduce((s, e) => s + amountTjs(e), 0)
  const receivable = data.debts
    .filter((d) => d.direction === 'receivable')
    .reduce((s, d) => s + debtRemaining(d, data.entries), 0)
  const payable = data.debts
    .filter((d) => d.direction === 'payable')
    .reduce((s, d) => s + debtRemaining(d, data.entries), 0)
  const refunds = orders.reduce((s, o) => s + o.refundDue, 0)
  return {
    cash: roundMoney(cash),
    planned: roundMoney(planned),
    expected: roundMoney(expected),
    forecast: roundMoney(cash + expected - planned - refunds),
    free: roundMoney(cash - planned - refunds),
    receivable,
    payable,
    refunds,
    unvalued,
    incomplete: orders.some((o) => o.incomplete),
  }
}
export function periodBounds(
  period: 'week' | 'month',
  offset = 0,
  now = new Date(),
) {
  const today = dushanbeDate(now),
    date = new Date(today + 'T00:00:00Z')
  if (period === 'week') {
    date.setUTCDate(
      date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + offset * 7,
    )
  } else {
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() + offset)
  }
  const start = date.toISOString().slice(0, 10)
  if (period === 'week') date.setUTCDate(date.getUTCDate() + 7)
  else date.setUTCMonth(date.getUTCMonth() + 1)
  return { start, end: date.toISOString().slice(0, 10) }
}
export function report(
  data: WalletData,
  period: 'week' | 'month',
  offset = 0,
  now = new Date(),
) {
  const bounds = periodBounds(period, offset, now),
    byCategory: Record<string, number> = {}
  let income = 0,
    expenses = 0,
    personal = 0,
    business = 0,
    customer = 0
  for (const e of data.entries) {
    if (
      e.planned ||
      e.voided_at ||
      e.entry_date < bounds.start ||
      e.entry_date >= bounds.end
    )
      continue
    const amount = amountTjs(e)
    if (e.kind === 'income') income += amount
    if (e.kind === 'order_payment') customer += amount
    if (e.kind === 'order_refund') customer -= amount
    if (['expense', 'expense_refund'].includes(e.kind)) {
      const signed = e.kind === 'expense' ? amount : -amount
      expenses += signed
      if (e.order_id) business += signed
      else personal += signed
      byCategory[e.category] = (byCategory[e.category] ?? 0) + signed
    }
  }
  return {
    ...bounds,
    income: roundMoney(income),
    expenses: roundMoney(expenses),
    personal: roundMoney(personal),
    business: roundMoney(business),
    customer: roundMoney(customer),
    net: roundMoney(income + customer - expenses),
    byCategory,
  }
}
export function parseQuickExpense(text: string) {
  const m = text.trim().match(/^(.+?)\s+(\d+(?:[.,]\d{1,2})?)$/)
  if (!m || Number(m[2].replace(',', '.')) <= 0) return null
  const note = m[1],
    lower = note.toLowerCase()
  const category = /такси|автобус|бензин/.test(lower)
    ? 'Транспорт'
    : /обед|кофе|ужин/.test(lower)
      ? 'Кафе'
      : /продукт|магазин/.test(lower)
        ? 'Продукты'
        : /карго/.test(lower)
          ? 'Карго'
          : 'Другое'
  return { note, amount: m[2].replace(',', '.'), category }
}
