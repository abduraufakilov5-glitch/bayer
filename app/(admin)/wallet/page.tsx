'use client'
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { dushanbeDate, parseRate } from '@/lib/exchange-rates'
import { formatSomoni, roundMoney } from '@/lib/pricing'
import { parseDecimal } from '@/lib/validation'
import { downloadCsv } from '@/lib/orders'
import {
  balances,
  categories,
  debtRemaining,
  incoming,
  kindLabels,
  parseQuickExpense,
  projectOrders,
  rateFor,
  report,
  type Currency,
  type Entry,
} from '@/lib/wallet'
import { RateSettings, useRates } from '@/app/components/exchange-rates'
import { useWallet, WalletMetrics } from '@/app/components/wallet-overview'
const freshEntry = () => ({
  kind: 'expense',
  amount: '',
  account: '',
  toAccount: '',
  toAmount: '',
  rate: '',
  category: 'Другое',
  note: '',
  date: '',
  planned: false,
  order: '',
  debt: '',
})
export default function WalletPage() {
  const { data, loading, error: loadError, reload } = useWallet(),
    { rates } = useRates()
  const [tab, setTab] = useState('operations'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('')
  const [entry, setEntry] = useState(freshEntry),
    [editId, setEditId] = useState<string | null>(null),
    [quick, setQuick] = useState('')
  const [account, setAccount] = useState({
    name: '',
    currency: 'TJS' as Currency,
    opening: '',
  })
  const [debt, setDebt] = useState({
    person: '',
    direction: 'receivable',
    amount: '',
    due: '',
    note: '',
    cash: false,
    account: '',
    cashAmount: '',
    rate: '',
  })
  const [period, setPeriod] = useState<'week' | 'month'>('week'),
    [offset, setOffset] = useState(0)
  const [query, setQuery] = useState(''),
    [filterCategory, setFilterCategory] = useState(''),
    [filterAccount, setFilterAccount] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [showVoided, setShowVoided] = useState(false)
  const [filterOrder, setFilterOrder] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : (new URLSearchParams(window.location.search).get('order') ?? ''),
  )
  const [weight, setWeight] = useState<Record<string, string>>({})
  const balance = balances(data),
    orders = projectOrders(data),
    currentReport = report(data, period, offset),
    previousReport = report(data, period, offset - 1)
  const selectedAccount = data.accounts.find(
      (a) => a.id === (entry.account || data.accounts[0]?.id),
    ),
    exchange = entry.rate
      ? parseRate(entry.rate)
      : selectedAccount
        ? rateFor(selectedAccount.currency, rates)
        : null
  const history = data.entries.filter(
    (e) =>
      (showVoided || !e.voided_at) &&
      (!filterOrder || e.order_id === filterOrder) &&
      (!filterCategory || e.category === filterCategory) &&
      (!filterAccount ||
        e.account_id === filterAccount ||
        e.to_account_id === filterAccount) &&
      (!from || e.entry_date >= from) &&
      (!to || e.entry_date <= to) &&
      (!query ||
        (e.note + ' ' + e.category + ' ' + (kindLabels[e.kind] ?? ''))
          .toLowerCase()
          .includes(query.toLowerCase())),
  )
  async function run(task: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await task()
      await reload()
      setNotice('Сохранено')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Не удалось сохранить. Проверьте данные и подключение.',
      )
    } finally {
      setBusy(false)
    }
  }
  function checked(result: { error: { message: string } | null }) {
    if (result.error) {
      const message = result.error.message
      const translated = message.includes('Payment exceeds remaining debt')
        ? 'Сумма возврата больше остатка долга.'
        : message.includes('Entry already changed')
          ? 'Эта запись уже исправлена. Обновите историю.'
          : message.includes('Debt unavailable')
            ? 'Долг отменён или недоступен.'
            : message.includes('Account unavailable')
              ? 'Выбранный счёт недоступен.'
              : message.includes('Wrong debt direction')
                ? 'Проверьте направление возврата долга.'
                : message.includes('check constraint')
                  ? 'Проверьте сумму, дату и выбранные счета.'
                  : message
      throw new Error(translated)
    }
  }
  async function owner() {
    const {
      data: { user },
      error,
    } = await createClient().auth.getUser()
    if (error || !user) throw new Error('Войдите в аккаунт заново')
    return user.id
  }
  function prepareEntry() {
    const amount = parseDecimal(entry.amount),
      r = selectedAccount?.currency === 'TJS' ? 1 : exchange,
      toAmount = parseDecimal(entry.toAmount)
    if (
      !selectedAccount ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !r ||
      !Number.isFinite(r) ||
      r <= 0 ||
      r > 1000000
    )
      throw new Error('Укажите счёт, положительную сумму и курс.')
    if (!entry.planned && (entry.date || dushanbeDate()) > dushanbeDate())
      throw new Error('Будущая дата доступна для планов.')
    if (
      entry.kind === 'transfer' &&
      (!entry.toAccount ||
        entry.toAccount === selectedAccount.id ||
        !Number.isFinite(toAmount) ||
        toAmount <= 0)
    )
      throw new Error('Выберите другой счёт и сумму зачисления.')
    if (['debt_receive', 'debt_pay'].includes(entry.kind) && !entry.debt)
      throw new Error('Выберите долг.')
    if (['order_payment', 'order_refund'].includes(entry.kind) && !entry.order)
      throw new Error('Выберите заказ.')
    return {
      account_id: selectedAccount.id,
      to_account_id: entry.kind === 'transfer' ? entry.toAccount : null,
      to_amount: entry.kind === 'transfer' ? toAmount : null,
      kind:
        entry.kind === 'income' && entry.order && !entry.planned
          ? 'order_payment'
          : entry.kind,
      amount,
      rate: r,
      category: entry.category,
      note: entry.note.trim(),
      entry_date: entry.date || dushanbeDate(),
      planned: entry.planned,
      order_id: entry.order || null,
      debt_id: ['debt_receive', 'debt_pay'].includes(entry.kind)
        ? entry.debt
        : null,
    }
  }
  function saveEntry(e: FormEvent) {
    e.preventDefault()
    void run(async () => {
      const payload = prepareEntry(),
        s = createClient()
      if (editId)
        checked(
          await s.rpc('wallet_replace_entry', {
            p_original: editId,
            p_entry: payload,
          }),
        )
      else
        checked(
          await s
            .from('wallet_entries')
            .insert({ ...payload, owner_id: await owner() }),
        )
      setEntry(freshEntry())
      setEditId(null)
      setQuick('')
    })
  }
  function edit(e: Entry) {
    setTab('operations')
    setEditId(e.id)
    setEntry({
      kind: e.kind,
      amount: String(e.amount),
      account: e.account_id,
      toAccount: e.to_account_id ?? '',
      toAmount: e.to_amount == null ? '' : String(e.to_amount),
      rate: String(e.rate),
      category: e.category,
      note: e.note,
      date: e.entry_date,
      planned: e.planned,
      order: e.order_id ?? '',
      debt: e.debt_id ?? '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function voidEntry(e: Entry) {
    if (
      !confirm(
        'Отменить эту запись? Она сохранится в истории, а баланс пересчитается.',
      )
    )
      return
    void run(async () => {
      checked(
        await createClient()
          .from('wallet_entries')
          .update({ voided_at: new Date().toISOString() })
          .eq('id', e.id)
          .is('voided_at', null),
      )
    })
  }
  function accountSave(e: FormEvent) {
    e.preventDefault()
    void run(async () => {
      const opening = Number(account.opening.trim().replace(',', '.'))
      if (
        !Number.isFinite(opening) ||
        !account.name.trim() ||
        !/^[-+]?\d+(?:[.,]\d{1,2})?$/.test(account.opening.trim() || '0')
      )
        throw new Error('Проверьте название и начальный остаток')
      checked(
        await createClient()
          .from('wallet_accounts')
          .insert({
            owner_id: await owner(),
            name: account.name.trim(),
            currency: account.currency,
            opening_balance: opening,
          }),
      )
      setAccount({ name: '', currency: 'TJS', opening: '' })
    })
  }
  function debtSave(e: FormEvent) {
    e.preventDefault()
    void run(async () => {
      const amount = parseDecimal(debt.amount),
        cashAmount = parseDecimal(debt.cashAmount),
        a = data.accounts.find((a) => a.id === debt.account),
        r =
          a?.currency === 'TJS'
            ? 1
            : debt.rate
              ? parseRate(debt.rate)
              : a
                ? rateFor(a.currency, rates)
                : null
      if (!Number.isFinite(amount) || amount <= 0 || !debt.person.trim())
        throw new Error('Укажите человека и сумму долга')
      if (
        debt.cash &&
        (!a ||
          !r ||
          !Number.isFinite(r) ||
          r <= 0 ||
          !Number.isFinite(cashAmount) ||
          cashAmount <= 0 ||
          roundMoney(cashAmount * r) !== amount)
      )
        throw new Error(
          'Сумма движения по счёту × курс должна совпадать с долгом в сомони',
        )
      checked(
        await createClient().rpc('wallet_record_loan', {
          p_person: debt.person.trim(),
          p_direction: debt.direction,
          p_amount: amount,
          p_due: debt.due || null,
          p_note: debt.note,
          p_account: debt.cash ? debt.account : null,
          p_cash_amount: debt.cash ? cashAmount : null,
          p_rate: debt.cash ? r : 1,
        }),
      )
      setDebt({
        person: '',
        direction: 'receivable',
        amount: '',
        due: '',
        note: '',
        cash: false,
        account: '',
        cashAmount: '',
        rate: '',
      })
    })
  }
  function orderAction(id: string, kind: string, category = 'Другое') {
    setTab('operations')
    setEditId(null)
    setEntry({ ...freshEntry(), order: id, kind, category })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function exportHistory() {
    downloadCsv('Мой-баланс-' + dushanbeDate() + '.csv', [
      [
        'Дата',
        'Тип',
        'Сумма',
        'Валюта',
        'Курс к сомони',
        'Категория',
        'Описание',
        'Счёт',
        'Заказ',
        'План',
        'Отменена',
      ],
      ...history.map((e) => [
        e.entry_date,
        kindLabels[e.kind],
        e.amount,
        data.accounts.find((a) => a.id === e.account_id)?.currency ?? '',
        e.rate,
        e.category,
        e.note,
        data.accounts.find((a) => a.id === e.account_id)?.name ?? '',
        data.orders.find((o) => o.id === e.order_id)?.title ?? '',
        e.planned ? 'Да' : 'Нет',
        e.voided_at ? 'Да' : 'Нет',
      ]),
    ])
  }
  return (
    <div className="wallet-page space-y-6">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow mb-3">Мой баланс</p>
          <h1 className="page-title">Деньги под рукой.</h1>
          <p className="subtitle mt-3">
            Личные финансы и заказы — в одном месте.
          </p>
        </div>
        <Link href="/dashboard" className="btn btn-secondary">
          К заказам →
        </Link>
      </div>
      {loading ? (
        <p role="status">Загрузка…</p>
      ) : loadError ? (
        <p role="alert" className="notice">
          {loadError}{' '}
          <button onClick={() => void reload()} className="underline">
            Повторить
          </button>
        </p>
      ) : (
        <WalletMetrics data={data} />
      )}
      <div className="filter-bar">
        {[
          ['operations', 'Операции'],
          ['accounts', 'Счета'],
          ['orders', 'Заказы и планы'],
          ['debts', 'Долги'],
          ['reports', 'Отчёты'],
        ].map(([key, label]) => (
          <button
            key={key}
            className="filter-pill"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="subtitle">
          {notice}
        </p>
      )}
      <fieldset disabled={busy || loading || !!loadError} className="space-y-6">
        {tab === 'operations' && (
          <>
            <form
              className="panel panel-padding space-y-4"
              onSubmit={saveEntry}
            >
              <h2 className="text-xl font-semibold">
                {editId ? 'Исправить запись' : 'Добавить операцию'}
              </h2>
              {!data.accounts.length ? (
                <p className="notice">
                  Сначала добавьте счёт и начальный остаток в разделе «Счета».
                </p>
              ) : null}
              <div className="wallet-row">
                <label className="field flex-1">
                  Быстрый расход
                  <input
                    value={quick}
                    onChange={(e) => setQuick(e.target.value)}
                    placeholder="Например: такси 30"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    const parsed = parseQuickExpense(quick)
                    if (!parsed) {
                      setError('Напишите описание и сумму, например: такси 30')
                      return
                    }
                    setEntry((e) => ({
                      ...e,
                      ...parsed,
                      kind: 'expense',
                      date: '',
                    }))
                  }}
                >
                  Заполнить
                </button>
              </div>
              <div className="wallet-form-grid">
                <label className="field">
                  Тип
                  <select
                    value={entry.kind}
                    onChange={(e) =>
                      setEntry((v) => ({
                        ...v,
                        kind: e.target.value,
                        planned: false,
                        debt: '',
                      }))
                    }
                  >
                    {Object.entries(kindLabels)
                      .filter(([k]) => !['loan_in', 'loan_out'].includes(k))
                      .map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  Счёт
                  <select
                    required
                    value={entry.account || data.accounts[0]?.id || ''}
                    onChange={(e) =>
                      setEntry((v) => ({
                        ...v,
                        account: e.target.value,
                        rate: '',
                      }))
                    }
                  >
                    {data.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.currency}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Сумма, {selectedAccount?.currency ?? 'TJS'}
                  <input
                    required
                    inputMode="decimal"
                    value={entry.amount}
                    onChange={(e) =>
                      setEntry((v) => ({ ...v, amount: e.target.value }))
                    }
                  />
                </label>
                <label className="field">
                  Дата
                  <input
                    required
                    type="date"
                    value={entry.date || dushanbeDate()}
                    onChange={(e) =>
                      setEntry((v) => ({ ...v, date: e.target.value }))
                    }
                  />
                </label>
                {selectedAccount && selectedAccount.currency !== 'TJS' && (
                  <label className="field">
                    Курс: сомони за 1 {selectedAccount?.currency}
                    <input
                      inputMode="decimal"
                      placeholder={String(exchange ?? 'Введите вручную')}
                      value={entry.rate}
                      onChange={(e) =>
                        setEntry((v) => ({ ...v, rate: e.target.value }))
                      }
                    />
                  </label>
                )}
                {entry.kind === 'transfer' && (
                  <>
                    <label className="field">
                      На счёт
                      <select
                        required
                        value={entry.toAccount}
                        onChange={(e) =>
                          setEntry((v) => ({ ...v, toAccount: e.target.value }))
                        }
                      >
                        <option value="">Выберите</option>
                        {data.accounts
                          .filter((a) => a.id !== selectedAccount?.id)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} · {a.currency}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="field">
                      Сумма зачисления
                      <input
                        required
                        inputMode="decimal"
                        value={entry.toAmount}
                        onChange={(e) =>
                          setEntry((v) => ({ ...v, toAmount: e.target.value }))
                        }
                      />
                    </label>
                  </>
                )}
                <label className="field">
                  Категория
                  <select
                    value={entry.category}
                    onChange={(e) =>
                      setEntry((v) => ({ ...v, category: e.target.value }))
                    }
                  >
                    {[
                      ...categories,
                      ...(!categories.includes(entry.category)
                        ? [entry.category]
                        : []),
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Заказ
                  <select
                    value={entry.order}
                    onChange={(e) =>
                      setEntry((v) => ({ ...v, order: e.target.value }))
                    }
                  >
                    <option value="">Личная операция</option>
                    {data.orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        № {o.order_number} · {o.title}
                      </option>
                    ))}
                  </select>
                </label>
                {['debt_receive', 'debt_pay'].includes(entry.kind) && (
                  <label className="field">
                    Долг
                    <select
                      required
                      value={entry.debt}
                      onChange={(e) =>
                        setEntry((v) => ({ ...v, debt: e.target.value }))
                      }
                    >
                      <option value="">Выберите долг</option>
                      {data.debts
                        .filter(
                          (d) =>
                            d.direction ===
                            (entry.kind === 'debt_receive'
                              ? 'receivable'
                              : 'payable'),
                        )
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.person} ·{' '}
                            {formatSomoni(debtRemaining(d, data.entries))}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
              </div>
              <label className="field">
                Описание
                <input
                  maxLength={1000}
                  value={entry.note}
                  onChange={(e) =>
                    setEntry((v) => ({ ...v, note: e.target.value }))
                  }
                />
              </label>
              {['income', 'expense'].includes(entry.kind) && (
                <label className="wallet-check">
                  <input
                    type="checkbox"
                    checked={entry.planned}
                    onChange={(e) =>
                      setEntry((v) => ({ ...v, planned: e.target.checked }))
                    }
                  />
                  Это план, деньги ещё не получены / не потрачены
                </label>
              )}
              <p className="subtitle text-xs">
                Дата подставляется автоматически, часовой пояс — Душанбе. Оплата
                клиента привязывается к заказу. Для возврата расхода выберите
                исходные категорию и заказ.
              </p>
              <div className="wallet-row">
                <button
                  className="btn btn-primary"
                  disabled={!data.accounts.length}
                >
                  {busy ? 'Сохраняем…' : 'Сохранить'}
                </button>
                {editId && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setEntry(freshEntry())
                      setEditId(null)
                    }}
                  >
                    Отменить исправление
                  </button>
                )}
              </div>
            </form>
            <section className="panel panel-padding space-y-4">
              <div className="wallet-row">
                <h2 className="text-xl font-semibold">История</h2>
                <button className="btn btn-secondary" onClick={exportHistory}>
                  Скачать CSV
                </button>
              </div>
              <div className="wallet-form-grid">
                <label className="field">
                  Поиск
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Описание или категория"
                  />
                </label>
                <label className="field">
                  Категория
                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                  >
                    <option value="">Все</option>
                    {[
                      ...new Set([
                        ...categories,
                        ...data.entries.map((e) => e.category),
                      ]),
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Счёт
                  <select
                    value={filterAccount}
                    onChange={(e) => setFilterAccount(e.target.value)}
                  >
                    <option value="">Все</option>
                    {data.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Заказ
                  <select
                    value={filterOrder}
                    onChange={(e) => setFilterOrder(e.target.value)}
                  >
                    <option value="">Все</option>
                    {data.orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  С даты
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
                <label className="field">
                  По дату
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>
              </div>
              <label className="wallet-check">
                <input
                  type="checkbox"
                  checked={showVoided}
                  onChange={(e) => setShowVoided(e.target.checked)}
                />
                Показывать отменённые и исправленные
              </label>
              {!history.length && <p className="subtitle">Записей пока нет.</p>}
              {history.map((e) => (
                <article
                  key={e.id}
                  className={
                    'wallet-entry' +
                    (e.planned ? ' wallet-expected' : '') +
                    (e.voided_at ? ' wallet-voided' : '')
                  }
                >
                  <div className="wallet-row">
                    <div>
                      <strong>
                        {e.planned ? 'План · ' : ''}
                        {kindLabels[e.kind]} · {e.category}
                      </strong>
                      <p className="subtitle text-sm mt-1">
                        {e.note || 'Без описания'}
                      </p>
                      <p className="subtitle text-xs mt-1">
                        {e.entry_date} ·{' '}
                        {data.accounts.find((a) => a.id === e.account_id)?.name}
                        {e.order_id
                          ? ' · ' +
                            data.orders.find((o) => o.id === e.order_id)?.title
                          : ''}
                        {e.voided_at ? ' · Отменена' : ''}
                      </p>
                    </div>
                    <strong className="wallet-amount">
                      {incoming.has(e.kind) ? '+' : '−'}
                      {e.amount}{' '}
                      {
                        data.accounts.find((a) => a.id === e.account_id)
                          ?.currency
                      }
                    </strong>
                  </div>
                  {!e.voided_at &&
                    !['loan_in', 'loan_out'].includes(e.kind) && (
                      <div className="wallet-row mt-3">
                        {e.planned && (
                          <button
                            className="text-button"
                            onClick={() =>
                              void run(async () => {
                                checked(
                                  await createClient().rpc(
                                    'wallet_realize_plan',
                                    { p_id: e.id, p_date: dushanbeDate() },
                                  ),
                                )
                              })
                            }
                          >
                            Отметить выполненным
                          </button>
                        )}
                        <button className="text-button" onClick={() => edit(e)}>
                          Исправить
                        </button>
                        <button
                          className="text-button danger"
                          onClick={() => voidEntry(e)}
                        >
                          Отменить запись
                        </button>
                      </div>
                    )}
                </article>
              ))}
            </section>
          </>
        )}
        {tab === 'accounts' && (
          <>
            <form
              onSubmit={accountSave}
              className="panel panel-padding space-y-4"
            >
              <h2 className="text-xl font-semibold">Добавить счёт</h2>
              <div className="wallet-form-grid">
                <label className="field">
                  Название
                  <input
                    required
                    maxLength={80}
                    placeholder="Наличные, карта…"
                    value={account.name}
                    onChange={(e) =>
                      setAccount((a) => ({ ...a, name: e.target.value }))
                    }
                  />
                </label>
                <label className="field">
                  Валюта
                  <select
                    value={account.currency}
                    onChange={(e) =>
                      setAccount((a) => ({
                        ...a,
                        currency: e.target.value as Currency,
                      }))
                    }
                  >
                    {['TJS', 'USD', 'CNY', 'RUB'].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Начальный остаток
                  <input
                    inputMode="decimal"
                    value={account.opening}
                    onChange={(e) =>
                      setAccount((a) => ({ ...a, opening: e.target.value }))
                    }
                  />
                </label>
              </div>
              <p className="subtitle text-xs">
                Укажите остаток до начала учёта. Старые заказы не зачисляются
                автоматически. Уже полученные суммы учитывайте либо в начальном
                остатке, либо отдельной оплатой, чтобы не посчитать их дважды.
              </p>
              <button className="btn btn-primary">Добавить счёт</button>
            </form>
            <div className="wallet-metrics">
              {data.accounts.map((a) => (
                <article key={a.id} className="panel panel-padding">
                  <p className="subtitle">{a.name}</p>
                  <strong className="text-2xl">
                    {balance.get(a.id) ?? 0} {a.currency}
                  </strong>
                </article>
              ))}
            </div>
            <RateSettings />
          </>
        )}
        {tab === 'orders' && (
          <>
            <p className="subtitle">
              Поступления выделены серым. Запланированные закупки и карго
              автоматически резервируются. Ручной план с той же категорией и
              заказом заменяет автоматический резерв этой категории.
            </p>
            {orders
              .filter(
                (o) =>
                  ['received', 'ordered', 'completed'].includes(o.status) ||
                  o.paid ||
                  o.cancelled,
              )
              .map((o) => (
                <article key={o.id} className="panel panel-padding space-y-4">
                  <div className="wallet-row">
                    <Link
                      className="text-lg font-semibold"
                      href={'/orders/' + o.id}
                    >
                      № {o.order_number} · {o.title} →
                    </Link>
                    <span className="status-badge">
                      {o.cancelled
                        ? 'Отменён в финансах'
                        : o.status === 'completed'
                          ? 'Завершён'
                          : 'В работе'}
                    </span>
                  </div>
                  <div className="wallet-form-grid">
                    <p>
                      Получено: <strong>{formatSomoni(o.paid)}</strong>
                    </p>
                    <p className="wallet-expected">
                      Ещё получить: <strong>{formatSomoni(o.expected)}</strong>
                    </p>
                    <p>
                      Ещё на товар:{' '}
                      <strong>{formatSomoni(o.purchaseLeft)}</strong>
                    </p>
                    <p>
                      Ещё на карго: <strong>{formatSomoni(o.cargoLeft)}</strong>
                    </p>
                    <p>
                      Фактически потрачено:{' '}
                      <strong>{formatSomoni(o.spent)}</strong>
                    </p>
                    <p>
                      Ожидаемая прибыль:{' '}
                      <strong>
                        {o.profit == null ? '—' : formatSomoni(o.profit)}
                      </strong>
                    </p>
                    <p>
                      Фактический результат:{' '}
                      <strong>{formatSomoni(o.paid - o.spent)}</strong>
                    </p>
                  </div>
                  {o.incomplete && (
                    <p className="notice">
                      Для полного прогноза не хватает цен или затрат.
                    </p>
                  )}
                  {o.refundDue > 0 && (
                    <p className="notice">
                      Вернуть клиенту: {formatSomoni(o.refundDue)}
                    </p>
                  )}
                  <div className="wallet-row">
                    <button
                      className="btn btn-primary"
                      onClick={() => orderAction(o.id, 'order_payment')}
                    >
                      Получить оплату
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => orderAction(o.id, 'expense', 'Закупка')}
                    >
                      Оплатить товар
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => orderAction(o.id, 'expense', 'Карго')}
                    >
                      Оплатить карго
                    </button>
                    <button
                      className="text-button"
                      onClick={() => orderAction(o.id, 'order_refund')}
                    >
                      Возврат клиенту
                    </button>
                  </div>
                  <div className="wallet-row">
                    <label className="field flex-1">
                      Фактический общий вес, г
                      <input
                        inputMode="numeric"
                        placeholder={String(o.weight ?? '')}
                        value={weight[o.id] ?? ''}
                        onChange={(e) =>
                          setWeight((v) => ({ ...v, [o.id]: e.target.value }))
                        }
                      />
                    </label>
                    <button
                      className="btn btn-secondary"
                      onClick={() =>
                        void run(async () => {
                          const grams = Number(weight[o.id])
                          if (
                            !Number.isInteger(grams) ||
                            grams <= 0 ||
                            !rates?.usd
                          )
                            throw new Error(
                              'Укажите вес и дождитесь курса доллара НБТ',
                            )
                          checked(
                            await createClient()
                              .from('wallet_order_settings')
                              .upsert({
                                order_id: o.id,
                                owner_id: await owner(),
                                actual_weight_grams: grams,
                                cargo_rate_tjs: 3.5 * rates.usd,
                              }),
                          )
                        })
                      }
                    >
                      Уточнить карго
                    </button>
                  </div>
                  <p className="subtitle text-xs">
                    План карго: {o.cargo == null ? '—' : formatSomoni(o.cargo)}.
                    Уточнение веса меняет только финансовый прогноз. Цена
                    клиента остаётся зафиксированной.
                  </p>
                  <button
                    className="text-button danger"
                    onClick={() => {
                      if (
                        confirm(
                          o.cancelled
                            ? 'Вернуть заказ в финансовый прогноз?'
                            : 'Отменить заказ в финансах? Оплаты сохранятся, возврат нужно записать отдельно.',
                        )
                      )
                        void run(async () => {
                          checked(
                            await createClient()
                              .from('wallet_order_settings')
                              .upsert({
                                order_id: o.id,
                                owner_id: await owner(),
                                cancelled: !o.cancelled,
                              }),
                          )
                        })
                    }}
                  >
                    {o.cancelled ? 'Вернуть в прогноз' : 'Отменить в финансах'}
                  </button>
                </article>
              ))}
            {!orders.some((o) =>
              ['received', 'ordered', 'completed'].includes(o.status),
            ) && (
              <p className="subtitle">
                Планы появятся после подтверждения заказа клиентом. Свои планы
                добавляйте в разделе «Операции».
              </p>
            )}
          </>
        )}
        {tab === 'debts' && (
          <>
            <form onSubmit={debtSave} className="panel panel-padding space-y-4">
              <h2 className="text-xl font-semibold">Записать долг</h2>
              <div className="wallet-form-grid">
                <label className="field">
                  Человек
                  <input
                    required
                    maxLength={140}
                    value={debt.person}
                    onChange={(e) =>
                      setDebt((d) => ({ ...d, person: e.target.value }))
                    }
                  />
                </label>
                <label className="field">
                  Направление
                  <select
                    value={debt.direction}
                    onChange={(e) =>
                      setDebt((d) => ({ ...d, direction: e.target.value }))
                    }
                  >
                    <option value="receivable">Мне должны</option>
                    <option value="payable">Я должен</option>
                  </select>
                </label>
                <label className="field">
                  Сумма долга, смн
                  <input
                    required
                    inputMode="decimal"
                    value={debt.amount}
                    onChange={(e) =>
                      setDebt((d) => ({ ...d, amount: e.target.value }))
                    }
                  />
                </label>
                <label className="field">
                  Срок возврата
                  <input
                    type="date"
                    value={debt.due}
                    onChange={(e) =>
                      setDebt((d) => ({ ...d, due: e.target.value }))
                    }
                  />
                </label>
              </div>
              <label className="field">
                Описание
                <input
                  maxLength={1000}
                  value={debt.note}
                  onChange={(e) =>
                    setDebt((d) => ({ ...d, note: e.target.value }))
                  }
                />
              </label>
              <label className="wallet-check">
                <input
                  type="checkbox"
                  checked={debt.cash}
                  onChange={(e) =>
                    setDebt((d) => ({ ...d, cash: e.target.checked }))
                  }
                />
                Сейчас {debt.direction === 'receivable' ? 'выдаю' : 'получаю'}{' '}
                деньги — учесть движение по счёту
              </label>
              {debt.cash && (
                <div className="wallet-form-grid">
                  <label className="field">
                    Счёт
                    <select
                      required
                      value={debt.account}
                      onChange={(e) =>
                        setDebt((d) => ({ ...d, account: e.target.value }))
                      }
                    >
                      <option value="">Выберите</option>
                      {data.accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} · {a.currency}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Сумма в валюте счёта
                    <input
                      required
                      inputMode="decimal"
                      value={debt.cashAmount}
                      onChange={(e) =>
                        setDebt((d) => ({ ...d, cashAmount: e.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    Курс к сомони
                    <input
                      inputMode="decimal"
                      placeholder="НБТ или 1 для TJS"
                      value={debt.rate}
                      onChange={(e) =>
                        setDebt((d) => ({ ...d, rate: e.target.value }))
                      }
                    />
                  </label>
                </div>
              )}
              <p className="subtitle text-xs">
                Для старого долга оставьте движение по счёту выключенным.
                Возвраты можно записывать частями.
              </p>
              <button className="btn btn-primary">Сохранить долг</button>
            </form>
            {data.debts.map((d) => (
              <article key={d.id} className="panel panel-padding">
                <div className="wallet-row">
                  <div>
                    <h3 className="text-lg font-semibold">
                      {d.person}
                      {d.cancelled_at ? ' · Отменён' : ''}
                    </h3>
                    <p className="subtitle text-sm">
                      {d.direction === 'receivable' ? 'Мне должны' : 'Я должен'}{' '}
                      · {d.note}
                    </p>
                    <p className="subtitle text-xs">
                      Срок: {d.due_date ?? 'не указан'}
                      {d.due_date &&
                      d.due_date < dushanbeDate() &&
                      debtRemaining(d, data.entries) > 0
                        ? ' · Просрочен'
                        : ''}
                    </p>
                  </div>
                  <strong>
                    {formatSomoni(debtRemaining(d, data.entries))}
                  </strong>
                </div>
                {debtRemaining(d, data.entries) > 0 && (
                  <button
                    className="btn btn-secondary mt-4"
                    onClick={() => {
                      setEntry({
                        ...freshEntry(),
                        kind:
                          d.direction === 'receivable'
                            ? 'debt_receive'
                            : 'debt_pay',
                        debt: d.id,
                        category: 'Долги',
                      })
                      setEditId(null)
                      setTab('operations')
                    }}
                  >
                    Записать возврат
                  </button>
                )}
                {!d.cancelled_at && (
                  <button
                    className="text-button danger mt-3"
                    onClick={() => {
                      if (
                        confirm(
                          'Отменить долг вместе со всеми его движениями? Они останутся в истории, баланс пересчитается.',
                        )
                      )
                        void run(async () => {
                          checked(
                            await createClient().rpc('wallet_cancel_debt', {
                              p_id: d.id,
                            }),
                          )
                        })
                    }}
                  >
                    Отменить ошибочный долг
                  </button>
                )}
              </article>
            ))}
          </>
        )}
        {tab === 'reports' && (
          <section className="panel panel-padding space-y-5">
            <div className="wallet-row">
              <h2 className="text-xl font-semibold">Куда уходят деньги</h2>
              <select
                aria-label="Период отчёта"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value as 'week' | 'month')
                  setOffset(0)
                }}
              >
                <option value="week">Неделя</option>
                <option value="month">Месяц</option>
              </select>
            </div>
            <div className="wallet-row">
              <button
                className="btn btn-secondary"
                onClick={() => setOffset((o) => o - 1)}
              >
                ← Раньше
              </button>
              <span>
                {currentReport.start} —{' '}
                {new Date(new Date(currentReport.end).getTime() - 86400000)
                  .toISOString()
                  .slice(0, 10)}
              </span>
              <button
                disabled={offset === 0}
                className="btn btn-secondary"
                onClick={() => setOffset((o) => o + 1)}
              >
                Позже →
              </button>
            </div>
            <div className="wallet-metrics">
              {[
                ['Личные доходы', currentReport.income],
                ['От клиентов, за вычетом возвратов', currentReport.customer],
                ['Личные расходы', currentReport.personal],
                ['Расходы заказов', currentReport.business],
                ['Поступления минус расходы', currentReport.net],
              ].map(([label, value]) => (
                <div key={label} className="wallet-metric">
                  <span>{label}</span>
                  <strong>{formatSomoni(Number(value))}</strong>
                </div>
              ))}
            </div>
            <p className="subtitle">
              Расходы: {formatSomoni(currentReport.expenses)}. Предыдущий
              период: {formatSomoni(previousReport.expenses)}. Разница:{' '}
              {formatSomoni(currentReport.expenses - previousReport.expenses)}.
            </p>
            <p className="subtitle text-xs">
              Заёмные деньги, возвраты долгов, переводы, начальные остатки и
              планы не входят в доходы и расходы. Текущий период ещё не
              завершён.
            </p>
            {Object.entries(currentReport.byCategory)
              .sort((a, b) => b[1] - a[1])
              .map(([category, value]) => (
                <div key={category}>
                  <div className="wallet-row">
                    <span>{category}</span>
                    <strong>{formatSomoni(value)}</strong>
                  </div>
                  <progress
                    className="wallet-progress"
                    aria-label={category}
                    max={Math.max(
                      1,
                      ...Object.values(currentReport.byCategory),
                    )}
                    value={Math.max(0, value)}
                  />
                </div>
              ))}
            {!Object.keys(currentReport.byCategory).length && (
              <p className="subtitle">За этот период расходов нет.</p>
            )}
            <button
              className="btn btn-secondary"
              onClick={() =>
                downloadCsv('Отчёт-' + currentReport.start + '.csv', [
                  ['Период', currentReport.start, currentReport.end],
                  ['Личные доходы', currentReport.income],
                  ['От клиентов', currentReport.customer],
                  ['Личные расходы', currentReport.personal],
                  ['Расходы заказов', currentReport.business],
                  ['Категория', 'Расходы'],
                  ...Object.entries(currentReport.byCategory),
                ])
              }
            >
              Скачать отчёт CSV
            </button>
          </section>
        )}
      </fieldset>
    </div>
  )
}
