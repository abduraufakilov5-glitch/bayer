'use client'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { dushanbeDate } from '@/lib/exchange-rates'
import { formatSomoni, roundMoney } from '@/lib/pricing'
import { downloadCsv } from '@/lib/orders'
import {
  balances,
  debtRemaining,
  incoming,
  kindLabels,
  projectOrders,
  rateFor,
  report,
  type Account,
  type Debt,
  type Entry,
} from '@/lib/wallet'
import { Icon } from './icons'
import { useWalletOwner, useWalletStore } from './wallet-store'
import { RateSettings, useRates } from './exchange-rates'
import { MoneySheet } from './money-sheet'
import {
  AccountForm,
  DebtForm,
  EntryForm,
  checkMoney,
  type EntryPreset,
} from './money-forms'
type Section = 'home' | 'history' | 'debts' | 'plans' | 'reports' | 'accounts'
type Sheet =
  | { type: 'entry'; preset: EntryPreset; entry?: Entry }
  | { type: 'account'; account?: Account }
  | { type: 'debt' }
  | { type: 'debt-detail'; debt: Debt }
  | { type: 'order'; id: string }
  | { type: 'settings' }
const sectionNames: Record<Section, string> = {
  home: 'Кошелёк',
  history: 'История',
  debts: 'Долги',
  plans: 'Планы',
  reports: 'Отчёты',
  accounts: 'Счета',
}
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
function prettyDate(value: string) {
  if (value === dushanbeDate()) return 'Сегодня'
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(value + 'T12:00:00Z'))
}
export function FinanceWorkspace({ work = false }: { work?: boolean }) {
  const ownerId = useWalletOwner()
  const { data, loading, error: loadError, reload } = useWalletStore(),
    { rates } = useRates(),
    params = useSearchParams()
  const [section, setSection] = useState<Section>(work ? 'plans' : 'home'),
    [sheet, setSheet] = useState<Sheet | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('')
  const [query, setQuery] = useState(''),
    deferredQuery = useDeferredValue(query),
    [category, setCategory] = useState(''),
    [accountFilter, setAccountFilter] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [showVoided, setShowVoided] = useState(false),
    [limit, setLimit] = useState(20)
  const [period, setPeriod] = useState<'week' | 'month'>('month'),
    [offset, setOffset] = useState(0),
    [direction, setDirection] = useState('receivable'),
    [weight, setWeight] = useState('')
  const mutation = useRef(false),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scopedData = useMemo(
    () => ({
      ...data,
      entries: data.entries.filter((e) => (work ? !!e.order_id : !e.order_id)),
    }),
    [data, work],
  )
  const accountBalances = useMemo(() => balances(data), [data])
  const cash = useMemo(() => {
    let amount = 0,
      unknown = false
    for (const a of data.accounts) {
      const r = rateFor(a.currency, rates)
      if (r == null) unknown = true
      else amount += (accountBalances.get(a.id) ?? 0) * r
    }
    return { amount: roundMoney(amount), unknown }
  }, [data.accounts, accountBalances, rates])
  const orderProjects = useMemo(
    () => (work ? projectOrders(data) : []),
    [data, work],
  )
  const totalDebts = useMemo(
    () => ({
      receivable: data.debts
        .filter((d) => d.direction === 'receivable')
        .reduce((s, d) => s + debtRemaining(d, data.entries), 0),
      payable: data.debts
        .filter((d) => d.direction === 'payable')
        .reduce((s, d) => s + debtRemaining(d, data.entries), 0),
    }),
    [data],
  )
  const month = useMemo(() => report(scopedData, 'month'), [scopedData]),
    current = useMemo(
      () => report(scopedData, period, offset),
      [scopedData, period, offset],
    ),
    previous = useMemo(
      () => report(scopedData, period, offset - 1),
      [scopedData, period, offset],
    )
  const history = useMemo(
    () =>
      scopedData.entries.filter(
        (e) =>
          (showVoided || !e.voided_at) &&
          !e.planned &&
          (!category || e.category === category) &&
          (!accountFilter ||
            e.account_id === accountFilter ||
            e.to_account_id === accountFilter) &&
          (!from || e.entry_date >= from) &&
          (!to || e.entry_date <= to) &&
          (!deferredQuery ||
            (e.note + ' ' + e.category + ' ' + (kindLabels[e.kind] ?? ''))
              .toLowerCase()
              .includes(deferredQuery.toLowerCase())),
      ),
    [scopedData, deferredQuery, category, accountFilter, from, to, showVoided],
  )
  const plans = useMemo(
    () => scopedData.entries.filter((e) => e.planned && !e.voided_at),
    [scopedData],
  )
  const debts = useMemo(
    () =>
      data.debts.filter((d) => !d.cancelled_at && d.direction === direction),
    [data.debts, direction],
  )
  const activeOrder =
    sheet?.type === 'order'
      ? orderProjects.find((o) => o.id === sheet.id)
      : null
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    [],
  )
  const orderFilter = params.get('order')
  function navigate(next: Section) {
    setSheet(null)
    setSection(next)
    setError('')
    setLimit(20)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  function toast(text: string) {
    setMessage(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setMessage(''), 2600)
  }
  async function saved() {
    await reload()
    setSheet(null)
    toast('Сохранено')
  }
  async function action(fn: () => Promise<void>, text = 'Готово') {
    if (mutation.current) return
    mutation.current = true
    setBusy(true)
    setError('')
    try {
      await fn()
      await reload()
      setSheet(null)
      toast(text)
    } catch (c) {
      setError(c instanceof Error ? c.message : 'Не удалось сохранить')
    } finally {
      mutation.current = false
      setBusy(false)
    }
  }
  function add(preset: EntryPreset = {}) {
    if (!data.accounts.length) {
      setSheet({ type: 'account' })
      toast('Сначала добавьте счёт')
      return
    }
    setSheet({
      type: 'entry',
      preset: {
        ...preset,
        order: preset.order ?? (work ? (orderFilter ?? '') : ''),
      },
    })
  }
  function exportEntries() {
    downloadCsv('Операции-' + dushanbeDate() + '.csv', [
      [
        'Дата',
        'Тип',
        'Сумма',
        'Валюта',
        'Категория',
        'Описание',
        'Счёт',
        'Отменена',
      ],
      ...history.map((e) => [
        e.entry_date,
        kindLabels[e.kind],
        e.amount,
        data.accounts.find((a) => a.id === e.account_id)?.currency ?? '',
        e.category,
        e.note,
        data.accounts.find((a) => a.id === e.account_id)?.name ?? '',
        e.voided_at ? 'Да' : 'Нет',
      ]),
    ])
  }
  function row(e: Entry, planned = false) {
    const a = data.accounts.find((a) => a.id === e.account_id),
      icon = planned
        ? 'clock'
        : e.kind === 'transfer'
          ? 'transfer'
          : incoming.has(e.kind)
            ? 'down'
            : 'up'
    return (
      <div
        key={e.id}
        className={'activity-item' + (e.voided_at ? ' voided' : '')}
      >
        <button
          className="activity-main"
          onClick={() =>
            ['loan_in', 'loan_out'].includes(e.kind)
              ? navigate('debts')
              : setSheet({ type: 'entry', preset: {}, entry: e })
          }
          disabled={!!e.voided_at}
        >
          <span
            className={
              'activity-icon ' + (incoming.has(e.kind) ? 'positive' : '')
            }
          >
            <Icon name={icon} />
          </span>
          <span className="activity-copy">
            <strong>{e.note || e.category || kindLabels[e.kind]}</strong>
            <small>
              {planned ? 'Запланировано · ' : ''}
              {prettyDate(e.entry_date)} · {a?.name}
              {e.voided_at ? ' · Отменено' : ''}
            </small>
          </span>
          <span
            className={
              'activity-value ' + (incoming.has(e.kind) ? 'positive' : '')
            }
          >
            {incoming.has(e.kind) ? '+' : '−'}
            {number.format(e.amount)}
            <small>{a?.currency === 'TJS' ? 'смн' : a?.currency}</small>
          </span>
        </button>
        {planned && (
          <button
            className="plan-complete"
            aria-label={'Выполнить план ' + (e.note || e.category)}
            disabled={busy}
            onClick={() =>
              void action(async () =>
                checkMoney(
                  await createClient().rpc('wallet_realize_plan', {
                    p_id: e.id,
                    p_date: dushanbeDate(),
                  }),
                ),
              )
            }
          >
            <Icon name="check" size={17} />
          </button>
        )}
      </div>
    )
  }
  const heading = work
    ? section === 'plans'
      ? 'Финансы работы'
      : section === 'history'
        ? 'Рабочие операции'
        : 'Отчёты по работе'
    : sectionNames[section]
  return (
    <div className="finance-space">
      <header className="money-page-heading">
        <div>
          {!work && section !== 'home' ? (
            <button className="money-back" onClick={() => navigate('home')}>
              <Icon name="back" size={16} />
              Кошелёк
            </button>
          ) : (
            <p className="money-eyebrow">
              {work ? 'Только заказы и клиенты' : 'Ваше личное пространство'}
            </p>
          )}
          <h1>{!work && section === 'home' ? 'Мои деньги' : heading}</h1>
        </div>
        <button
          className="icon-button settings-button"
          aria-label="Настройки и курсы"
          onClick={() => setSheet({ type: 'settings' })}
        >
          <Icon name="tune" />
        </button>
      </header>
      {loadError && (
        <div className="notice" role="alert">
          {loadError} <button onClick={() => void reload()}>Повторить</button>
        </div>
      )}
      {error && !sheet && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {loading ? (
        <div
          className="money-loading"
          role="status"
          aria-label="Загрузка финансов"
        >
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : (
        <>
          {work && (
            <div className="money-segment work-finance-tabs">
              {[
                ['plans', 'Заказы'],
                ['history', 'Операции'],
                ['reports', 'Отчёты'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  aria-pressed={section === key}
                  onClick={() => navigate(key as Section)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {!work && section === 'home' && (
            <div key={section} className="money-view">
              <section className="balance-hero" aria-label="Текущий баланс">
                <div className="hero-top">
                  <span>Доступно сейчас</span>
                  <span className="hero-live">
                    <i />
                    На всех счетах
                  </span>
                </div>
                <div className="balance-number">
                  {cash.unknown ? '—' : number.format(cash.amount)}{' '}
                  <span>смн</span>
                </div>
                <div className="hero-month">
                  <span>В этом месяце</span>
                  <strong>{month.expenses > 0 ? '−' : ''}{number.format(month.expenses)} смн</strong>
                </div>
              </section>
              <div className="money-actions">
                <button
                  className="expense-action"
                  onClick={() => add({ kind: 'expense' })}
                >
                  <span>
                    <Icon name="up" size={23} />
                  </span>
                  Расход
                </button>
                <button onClick={() => add({ kind: 'income' })}>
                  <span>
                    <Icon name="down" size={23} />
                  </span>
                  Доход
                </button>
                <button onClick={() => add({ kind: 'transfer' })}>
                  <span>
                    <Icon name="transfer" size={23} />
                  </span>
                  Перевод
                </button>
              </div>
              <div className="wallet-shortcuts">
                {[
                  { key: 'debts', label: 'Долги', icon: 'people' as const },
                  { key: 'plans', label: 'Планы', icon: 'clock' as const },
                  { key: 'reports', label: 'Отчёты', icon: 'chart' as const },
                  { key: 'accounts', label: 'Счета', icon: 'wallet' as const },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => navigate(item.key as Section)}
                  >
                    <span>
                      <Icon name={item.icon} size={22} />
                    </span>
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                className="debt-highlight"
                onClick={() => navigate('debts')}
              >
                <span className="debt-highlight-icon">
                  <Icon name="people" size={23} />
                </span>
                <span>
                  <small>Мне должны</small>
                  <strong>{formatSomoni(totalDebts.receivable)}</strong>
                </span>
                <span className="debt-count">
                  {
                    data.debts.filter(
                      (d) =>
                        d.direction === 'receivable' &&
                        debtRemaining(d, data.entries) > 0,
                    ).length
                  }{' '}
                  чел.
                </span>
                <Icon name="arrow" size={17} />
              </button>
              <section className="money-card">
                <div className="money-section-heading">
                  <h2>Последние операции</h2>
                  <button onClick={() => navigate('history')}>
                    Все
                    <Icon name="arrow" size={14} />
                  </button>
                </div>
                {history.length ? (
                  history.slice(0, 5).map((e) => row(e))
                ) : (
                  <div className="money-empty">
                    <span className="empty-symbol">
                      <Icon name="clock" size={27} />
                    </span>
                    <h3>Пока чистая история</h3>
                    <p>Запишите первый расход — он появится здесь.</p>
                    <button onClick={() => add({ kind: 'expense' })}>
                      Добавить расход
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}
          {section === 'history' && (
            <div className="money-view">
              <div className="money-toolbar">
                <div className="search-field">
                  <Icon name="search" size={18} />
                  <input
                    aria-label="Поиск операций"
                    placeholder="Найти операцию…"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value)
                      setLimit(20)
                    }}
                  />
                </div>
                <button
                  className="icon-button"
                  aria-label="Добавить операцию"
                  onClick={() => add()}
                >
                  <Icon name="plus" />
                </button>
              </div>
              <details className="money-filters">
                <summary>
                  <Icon name="tune" size={16} />
                  Фильтры и экспорт
                </summary>
                <div className="money-form">
                  <div className="form-pair">
                    <label className="field">
                      Категория
                      <select
                        value={category}
                        onChange={(e) => {
                          setCategory(e.target.value)
                          setLimit(20)
                        }}
                      >
                        <option value="">Все категории</option>
                        {[
                          ...new Set(scopedData.entries.map((e) => e.category)),
                        ].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Счёт
                      <select
                        value={accountFilter}
                        onChange={(e) => setAccountFilter(e.target.value)}
                      >
                        <option value="">Все счета</option>
                        {data.accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="form-pair">
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
                    Показать отменённые
                  </label>
                  <button className="btn btn-secondary" onClick={exportEntries}>
                    Скачать CSV
                  </button>
                </div>
              </details>
              <section className="money-card activity-list">
                {history.length ? (
                  history.slice(0, limit).map((e) => row(e))
                ) : (
                  <div className="money-empty">
                    <Icon name="search" size={26} />
                    <h3>Операций не найдено</h3>
                    <p>Попробуйте другие фильтры.</p>
                  </div>
                )}
              </section>
              {history.length > limit && (
                <button
                  className="load-more"
                  onClick={() => setLimit((n) => n + 20)}
                >
                  Показать ещё
                </button>
              )}
            </div>
          )}
          {!work && section === 'debts' && (
            <div className="money-view">
              <div className="debt-total">
                <p>{direction === 'receivable' ? 'Мне должны' : 'Я должен'}</p>
                <strong>
                  {formatSomoni(
                    direction === 'receivable'
                      ? totalDebts.receivable
                      : totalDebts.payable,
                  )}
                </strong>
              </div>
              <div className="money-toolbar">
                <div className="money-segment">
                  <button
                    aria-pressed={direction === 'receivable'}
                    onClick={() => setDirection('receivable')}
                  >
                    Мне должны
                  </button>
                  <button
                    aria-pressed={direction === 'payable'}
                    onClick={() => setDirection('payable')}
                  >
                    Я должен
                  </button>
                </div>
                <button
                  className="icon-button"
                  aria-label="Добавить долг"
                  onClick={() => setSheet({ type: 'debt' })}
                >
                  <Icon name="plus" />
                </button>
              </div>
              <section className="money-card">
                {debts.map((d) => (
                  <button
                    key={d.id}
                    className="person-row"
                    onClick={() => setSheet({ type: 'debt-detail', debt: d })}
                  >
                    <span className="person-avatar">
                      {d.person.slice(0, 1).toLocaleUpperCase('ru')}
                    </span>
                    <span className="activity-copy">
                      <strong>{d.person}</strong>
                      <small>
                        {debtRemaining(d, data.entries) === 0
                          ? 'Возвращён'
                          : d.due_date
                            ? 'До ' + prettyDate(d.due_date)
                            : 'Без срока'}
                      </small>
                    </span>
                    <strong>
                      {formatSomoni(debtRemaining(d, data.entries))}
                    </strong>
                    <Icon name="arrow" size={16} />
                  </button>
                ))}
                {!debts.length && (
                  <div className="money-empty">
                    <Icon name="people" size={27} />
                    <h3>Здесь пока нет долгов</h3>
                    <button onClick={() => setSheet({ type: 'debt' })}>
                      Добавить долг
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}
          {section === 'plans' && (
            <div className="money-view">
              {work && (
                <>
                  <div className="work-money-summary">
                    <div className="expected">
                      <span>Ожидается от клиентов</span>
                      <strong>
                        {formatSomoni(
                          orderProjects.reduce((s, o) => s + o.expected, 0),
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Ещё на товар и карго</span>
                      <strong>
                        {formatSomoni(
                          orderProjects.reduce(
                            (s, o) => s + o.purchaseLeft + o.cargoLeft,
                            0,
                          ),
                        )}
                      </strong>
                    </div>
                  </div>
                  <div className="money-toolbar">
                    <h2 className="small-heading">Заказы</h2>
                    <button
                      className="text-button"
                      onClick={() => add({ kind: 'income' })}
                    >
                      Записать оплату
                    </button>
                  </div>
                  <div className="work-finance-orders">
                    {orderProjects
                      .filter(
                        (o) =>
                          ['received', 'ordered', 'completed'].includes(
                            o.status,
                          ) || o.cancelled,
                      )
                      .map((o) => (
                        <button
                          key={o.id}
                          className={
                            'work-finance-order' +
                            (o.cancelled ? ' voided' : '')
                          }
                          onClick={() => {
                            setWeight('')
                            setSheet({ type: 'order', id: o.id })
                          }}
                        >
                          <div>
                            <span className="order-id">№ {o.order_number}</span>
                            <span className="status-badge">
                              {o.cancelled
                                ? 'Отменён'
                                : o.status === 'completed'
                                  ? 'Завершён'
                                  : 'В работе'}
                            </span>
                          </div>
                          <h3>{o.title}</h3>
                          <div>
                            <span>
                              Получено<strong>{formatSomoni(o.paid)}</strong>
                            </span>
                            <span className="expected">
                              Ожидается
                              <strong>{formatSomoni(o.expected)}</strong>
                            </span>
                          </div>
                        </button>
                      ))}
                  </div>
                </>
              )}
              <div className="money-toolbar">
                <h2 className="small-heading">
                  {work ? 'Дополнительные планы' : 'Будущие расходы'}
                </h2>
                <button
                  className="icon-button"
                  aria-label="Добавить план"
                  onClick={() => {
                    add({ kind: 'expense', planned: true })
                  }}
                >
                  <Icon name="plus" />
                </button>
              </div>
              <section className="money-card">
                {plans.length ? (
                  plans.map((e) => row(e, true))
                ) : (
                  <div className="money-empty">
                    <Icon name="clock" size={27} />
                    <h3>Всё под контролем</h3>
                    <p>Добавьте операцию и включите «Запланировать».</p>
                  </div>
                )}
              </section>
            </div>
          )}
          {section === 'reports' && (
            <div className="money-view">
              <div className="money-segment">
                <button
                  aria-pressed={period === 'week'}
                  onClick={() => {
                    setPeriod('week')
                    setOffset(0)
                  }}
                >
                  Неделя
                </button>
                <button
                  aria-pressed={period === 'month'}
                  onClick={() => {
                    setPeriod('month')
                    setOffset(0)
                  }}
                >
                  Месяц
                </button>
              </div>
              <div className="report-period">
                <button
                  className="icon-button"
                  aria-label="Предыдущий период"
                  onClick={() => setOffset((n) => n - 1)}
                >
                  <Icon name="back" size={18} />
                </button>
                <span>
                  {prettyDate(current.start)} —{' '}
                  {prettyDate(
                    new Date(new Date(current.end).getTime() - 86400000)
                      .toISOString()
                      .slice(0, 10),
                  )}
                </span>
                <button
                  className="icon-button"
                  aria-label="Следующий период"
                  disabled={offset === 0}
                  onClick={() => setOffset((n) => n + 1)}
                >
                  <Icon name="arrow" size={18} />
                </button>
              </div>
              <div className="report-total">
                <span>Потрачено</span>
                <strong>{formatSomoni(current.expenses)}</strong>
                <small>
                  {current.expenses === previous.expenses
                    ? 'Как в прошлом периоде'
                    : (current.expenses > previous.expenses
                        ? 'На ' +
                          formatSomoni(current.expenses - previous.expenses) +
                          ' больше'
                        : 'На ' +
                          formatSomoni(previous.expenses - current.expenses) +
                          ' меньше') + ' прошлого периода'}
                </small>
              </div>
              <div className="report-pair">
                <div>
                  <span>Поступления</span>
                  <strong className="positive">
                    +{formatSomoni(current.income + current.customer)}
                  </strong>
                </div>
                <div>
                  <span>Разница</span>
                  <strong>{formatSomoni(current.net)}</strong>
                </div>
              </div>
              <section className="money-card category-report">
                <h2>По категориям</h2>
                {Object.entries(current.byCategory)
                  .sort((a, b) => b[1] - a[1])
                  .map(([c, v], i) => (
                    <div className="category-report-row" key={c}>
                      <div>
                        <span>
                          <i
                            style={{
                              background: [
                                '#6d77ed',
                                '#edaa6a',
                                '#6da88f',
                                '#c887b7',
                              ][i % 4],
                            }}
                          />
                          {c}
                        </span>
                        <strong>{formatSomoni(v)}</strong>
                      </div>
                      <div className="report-bar">
                        <span
                          style={{
                            width:
                              Math.max(
                                0,
                                Math.min(
                                  100,
                                  (v / Math.max(1, current.expenses)) * 100,
                                ),
                              ) + '%',
                            background: [
                              '#6d77ed',
                              '#edaa6a',
                              '#6da88f',
                              '#c887b7',
                            ][i % 4],
                          }}
                        />
                      </div>
                    </div>
                  ))}
                {!Object.keys(current.byCategory).length && (
                  <p className="form-hint">Расходов за этот период пока нет.</p>
                )}
              </section>
              <p className="form-hint">
                {work
                  ? 'Расходы и оплаты по заказам.'
                  : 'Только личные доходы и расходы.'}{' '}
                Переводы и возвраты долгов в отчёт не входят.
              </p>
              <button
                className="load-more"
                onClick={() =>
                  downloadCsv('Отчёт-' + current.start + '.csv', [
                    ['Период', current.start, current.end],
                    ['Поступления', current.income + current.customer],
                    ['Расходы', current.expenses],
                    ['Разница', current.net],
                    ...Object.entries(current.byCategory),
                  ])
                }
              >
                Скачать отчёт
              </button>
            </div>
          )}
          {!work && section === 'accounts' && (
            <div className="money-view">
              <div className="money-toolbar">
                <p className="form-hint">Где хранятся ваши деньги</p>
                <button
                  className="icon-button"
                  aria-label="Добавить счёт"
                  onClick={() => setSheet({ type: 'account' })}
                >
                  <Icon name="plus" />
                </button>
              </div>
              {data.accounts.map((a) => (
                <button
                  key={a.id}
                  className="account-tile"
                  onClick={() => setSheet({ type: 'account', account: a })}
                >
                  <span className="account-symbol">
                    <Icon name="wallet" size={24} />
                  </span>
                  <span className="activity-copy">
                    <strong>{a.name}</strong>
                    <small>{a.currency}</small>
                  </span>
                  <strong>
                    {number.format(accountBalances.get(a.id) ?? 0)}
                    <small>{a.currency === 'TJS' ? 'смн' : a.currency}</small>
                  </strong>
                  <Icon name="arrow" size={16} />
                </button>
              ))}
              {!data.accounts.length && (
                <div className="money-empty">
                  <h3>Добавьте первый счёт</h3>
                  <p>Наличные или карта — всё в одном месте.</p>
                  <button onClick={() => setSheet({ type: 'account' })}>
                    Добавить счёт
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <div
        className={'money-toast' + (message ? ' visible' : '')}
        role="status"
        aria-live="polite"
      >
        <Icon name="check" size={16} />
        {message}
      </div>
      {sheet && (
        <MoneySheet
          title={
            sheet.type === 'entry'
              ? sheet.entry
                ? 'Операция'
                : kindLabels[sheet.preset.kind ?? 'expense']
              : sheet.type === 'account'
                ? 'Счёт'
                : sheet.type === 'debt'
                  ? 'Новый долг'
                  : sheet.type === 'debt-detail'
                    ? sheet.debt.person
                    : sheet.type === 'order'
                      ? 'Деньги по заказу'
                      : 'Настройки'
          }
          onClose={() => {
            setSheet(null)
            setError('')
          }}
          busy={busy}
        >
          {error && (
            <p role="alert" className="notice">
              {error}
            </p>
          )}
          {sheet.type === 'entry' && (
            <>
              <EntryForm
                data={data}
                preset={sheet.preset}
                original={sheet.entry}
                work={work}
                onSaved={saved}
                onBusy={setBusy}
              />
              {sheet.entry && !sheet.entry.voided_at && (
                <button
                  className="danger sheet-delete"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        'Отменить запись? Она останется в истории, баланс пересчитается.',
                      )
                    )
                      void action(
                        async () =>
                          checkMoney(
                            await createClient()
                              .from('wallet_entries')
                              .update({ voided_at: new Date().toISOString() })
                              .eq('id', sheet.entry!.id)
                              .is('voided_at', null),
                          ),
                        'Запись отменена',
                      )
                  }}
                >
                  Отменить запись
                </button>
              )}
            </>
          )}
          {sheet.type === 'account' && (
            <AccountForm
              original={sheet.account}
              onSaved={saved}
              onBusy={setBusy}
            />
          )}
          {sheet.type === 'debt' && (
            <DebtForm data={data} onSaved={saved} onBusy={setBusy} />
          )}
          {sheet.type === 'debt-detail' && (
            <div className="debt-detail">
              <div className="person-avatar large">
                {sheet.debt.person.slice(0, 1)}
              </div>
              <p>
                {sheet.debt.direction === 'receivable'
                  ? 'Мне должны'
                  : 'Я должен'}
              </p>
              <strong>
                {formatSomoni(debtRemaining(sheet.debt, data.entries))}
              </strong>
              {sheet.debt.note && (
                <p className="form-hint">{sheet.debt.note}</p>
              )}
              {debtRemaining(sheet.debt, data.entries) > 0 && (
                <button
                  className="money-submit"
                  onClick={() =>
                    setSheet({
                      type: 'entry',
                      preset: {
                        kind:
                          sheet.debt.direction === 'receivable'
                            ? 'debt_receive'
                            : 'debt_pay',
                        debt: sheet.debt.id,
                        amount: String(debtRemaining(sheet.debt, data.entries)),
                        category: 'Долги',
                      },
                    })
                  }
                >
                  Записать возврат
                </button>
              )}
              <div className="debt-repayments">
                {data.entries
                  .filter((e) => e.debt_id === sheet.debt.id && !e.voided_at)
                  .map((e) => row(e))}
              </div>
              <button
                className="danger sheet-delete"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      'Отменить долг и все связанные движения? Баланс пересчитается, история сохранится.',
                    )
                  )
                    void action(
                      async () =>
                        checkMoney(
                          await createClient().rpc('wallet_cancel_debt', {
                            p_id: sheet.debt.id,
                          }),
                        ),
                      'Долг отменён',
                    )
                }}
              >
                Отменить ошибочный долг
              </button>
            </div>
          )}
          {sheet.type === 'settings' && (
            <div className="money-form">
              <RateSettings />
              <p className="form-hint">
                Счета отражают реальные деньги. Работа и личные расходы имеют
                отдельные историю и отчёты. Если используете один счёт для обоих
                разделов, его остаток общий.
              </p>
            </div>
          )}
          {sheet.type === 'order' && activeOrder && (
            <div className="money-form">
              <Link
                className="order-sheet-title"
                href={'/orders/' + activeOrder.id}
              >
                № {activeOrder.order_number} · {activeOrder.title}
                <Icon name="arrow" size={18} />
              </Link>
              <div className="order-money-grid">
                {[
                  ['Получено', activeOrder.paid],
                  ['Ожидается', activeOrder.expected],
                  ['Ещё на закупку', activeOrder.purchaseLeft],
                  ['Ещё на карго', activeOrder.cargoLeft],
                  ['Ожидаемая прибыль', activeOrder.profit],
                  [
                    'Фактический результат',
                    activeOrder.paid - activeOrder.spent,
                  ],
                ].map(([l, v]) => (
                  <div key={l}>
                    <span>{l}</span>
                    <strong>{v == null ? '—' : formatSomoni(Number(v))}</strong>
                  </div>
                ))}
              </div>
              {activeOrder.incomplete && (
                <p className="notice">Для полного прогноза не хватает цен.</p>
              )}
              {activeOrder.refundDue > 0 && (
                <p className="notice">
                  Вернуть клиенту: {formatSomoni(activeOrder.refundDue)}
                </p>
              )}
              <div className="order-payment-actions">
                <button
                  onClick={() => add({ kind: 'income', order: activeOrder.id })}
                >
                  Получить оплату
                </button>
                <button
                  onClick={() =>
                    add({
                      kind: 'expense',
                      category: 'Закупка',
                      order: activeOrder.id,
                    })
                  }
                >
                  Оплатить товар
                </button>
                <button
                  onClick={() =>
                    add({
                      kind: 'expense',
                      category: 'Карго',
                      order: activeOrder.id,
                    })
                  }
                >
                  Оплатить карго
                </button>
                <button
                  onClick={() =>
                    add({ kind: 'order_refund', order: activeOrder.id })
                  }
                >
                  Возврат клиенту
                </button>
              </div>
              <details className="money-filters">
                <summary>Уточнить карго и вес</summary>
                <label className="field">
                  Общий фактический вес, г
                  <input
                    inputMode="numeric"
                    placeholder={String(activeOrder.weight ?? '0')}
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                  />
                </label>
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    void action(async () => {
                      const grams = Number(weight)
                      if (!Number.isInteger(grams) || grams <= 0 || !rates?.usd)
                        throw new Error(
                          'Укажите вес и дождитесь курса Visa Алиф.',
                        )
                      checkMoney(
                        await createClient()
                          .from('wallet_order_settings')
                          .upsert({
                            order_id: activeOrder.id,
                            owner_id: ownerId,
                            actual_weight_grams: grams,
                            cargo_rate_tjs: 3.5 * rates.usd,
                          }),
                      )
                    })
                  }
                >
                  Пересчитать план карго
                </button>
                <p className="form-hint">
                  Цена клиента остаётся зафиксированной.
                </p>
              </details>
              <button
                className="danger sheet-delete"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      activeOrder.cancelled
                        ? 'Вернуть в прогноз?'
                        : 'Отменить заказ в финансах? Фактические оплаты сохранятся.',
                    )
                  )
                    void action(async () =>
                      checkMoney(
                        await createClient()
                          .from('wallet_order_settings')
                          .upsert({
                            order_id: activeOrder.id,
                            owner_id: ownerId,
                            cancelled: !activeOrder.cancelled,
                          }),
                      ),
                    )
                }}
              >
                {activeOrder.cancelled
                  ? 'Вернуть в прогноз'
                  : 'Отменить в финансах'}
              </button>
            </div>
          )}
        </MoneySheet>
      )}
    </div>
  )
}
