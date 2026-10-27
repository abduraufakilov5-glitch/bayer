'use client'
import { useRef, useState, type FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { dushanbeDate, parseRate } from '@/lib/exchange-rates'
import { parseDecimal } from '@/lib/validation'
import { roundMoney } from '@/lib/pricing'
import {
  categories,
  kindLabels,
  rateFor,
  type WalletData,
  type Entry,
  type Account,
  type Currency,
} from '@/lib/wallet'
import { useRates } from './exchange-rates'
import { useWalletOwner } from './wallet-store'
export function checkMoney(result: { error: { message: string } | null }) {
  if (!result.error) return
  const message = result.error.message
  throw new Error(
    message.includes('exceeds remaining')
      ? 'Сумма больше остатка долга.'
      : message.includes('already changed')
        ? 'Запись уже изменена. Обновите историю.'
        : message.includes('Debt unavailable')
          ? 'Этот долг уже отменён.'
          : message.includes('check constraint')
            ? 'Проверьте сумму, дату и счета.'
            : message,
  )
}
export type EntryPreset = {
  kind?: string
  category?: string
  order?: string
  debt?: string
  amount?: string
  planned?: boolean
}
export function EntryForm({
  data,
  preset = {},
  original,
  work,
  onSaved,
  onBusy,
}: {
  data: WalletData
  preset?: EntryPreset
  original?: Entry
  work: boolean
  onSaved: () => Promise<void>
  onBusy: (busy: boolean) => void
}) {
  const ownerId = useWalletOwner()
  const { rates } = useRates(),
    locked = useRef(false),
    requestId = useRef<string | null>(null)
  const [draft, setDraft] = useState(() => ({
    kind:
      original?.kind === 'order_payment'
        ? 'income'
        : (original?.kind ?? preset.kind ?? 'expense'),
    amount: original ? String(original.amount) : (preset.amount ?? ''),
    account: original?.account_id ?? data.accounts[0]?.id ?? '',
    toAccount: original?.to_account_id ?? '',
    toAmount: original?.to_amount == null ? '' : String(original.to_amount),
    rate: original ? String(original.rate) : '',
    category: original?.category ?? preset.category ?? 'Другое',
    note: original?.note ?? '',
    date: original?.entry_date ?? '',
    order: original?.order_id ?? preset.order ?? '',
    debt: original?.debt_id ?? preset.debt ?? '',
    planned: original?.planned ?? preset.planned ?? false,
  }))
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const a = data.accounts.find((a) => a.id === draft.account),
    r =
      a?.currency === 'TJS'
        ? 1
        : draft.rate
          ? parseRate(draft.rate)
          : a
            ? rateFor(a.currency, rates)
            : null
  const patch = (value: Partial<typeof draft>) =>
    setDraft((d) => ({ ...d, ...value }))
  async function save(e: FormEvent) {
    e.preventDefault()
    if (locked.current) return
    setError('')
    const amount = parseDecimal(draft.amount),
      toAmount = parseDecimal(draft.toAmount)
    if (
      !a ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !r ||
      !Number.isFinite(r) ||
      r <= 0
    ) {
      setError('Укажите сумму и счёт. Для валютного счёта нужен курс.')
      return
    }
    if (!draft.planned && (draft.date || dushanbeDate()) > dushanbeDate()) {
      setError('Для будущей даты включите «Запланировать».')
      return
    }
    if (work && !draft.order) {
      setError('Выберите заказ.')
      return
    }
    if (
      draft.kind === 'transfer' &&
      (!draft.toAccount ||
        draft.toAccount === a.id ||
        !Number.isFinite(toAmount) ||
        toAmount <= 0)
    ) {
      setError('Выберите другой счёт и сумму зачисления.')
      return
    }
    locked.current = true
    setBusy(true)
    onBusy(true)
    try {
      const payload = {
        account_id: a.id,
        kind:
          work && draft.kind === 'income' && !draft.planned
            ? 'order_payment'
            : draft.kind,
        amount,
        rate: r,
        to_account_id: draft.kind === 'transfer' ? draft.toAccount : null,
        to_amount: draft.kind === 'transfer' ? toAmount : null,
        category: draft.category,
        note: draft.note.trim(),
        entry_date: draft.date || dushanbeDate(),
        planned: draft.planned,
        order_id: work ? draft.order : null,
        debt_id: ['debt_receive', 'debt_pay'].includes(draft.kind)
          ? draft.debt
          : null,
      }
      const client = createClient()
      if (original)
        checkMoney(
          await client.rpc('wallet_replace_entry', {
            p_original: original.id,
            p_entry: payload,
          }),
        )
      else {
        requestId.current ??= crypto.randomUUID()
        const result = await client
          .from('wallet_entries')
          .insert({ ...payload, id: requestId.current, owner_id: ownerId })
        if (result.error?.code !== '23505') checkMoney(result)
      }
      await onSaved()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Не удалось сохранить. Попробуйте ещё раз.',
      )
    } finally {
      locked.current = false
      setBusy(false)
      onBusy(false)
    }
  }
  const kinds = work
    ? ['income', 'expense', 'order_refund', 'expense_refund']
    : [
        'expense',
        'income',
        'transfer',
        'expense_refund',
        ...(['debt_receive', 'debt_pay'].includes(draft.kind)
          ? [draft.kind]
          : []),
      ]
  return (
    <form onSubmit={save} className="money-form">
      <fieldset disabled={busy}>
        <div className="money-segment">
          {kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={draft.kind === kind}
              onClick={() => patch({ kind, planned: false })}
            >
              {work && kind === 'income' ? 'Оплата клиента' : kindLabels[kind]}
            </button>
          ))}
        </div>
        <label className="amount-field">
          <span>Сумма · {a?.currency && a.currency !== 'TJS' ? a.currency : 'смн'}</span>
          <input
            autoFocus
            name="amount"
            autoComplete="off"
            inputMode="decimal"
            required
            value={draft.amount}
            onChange={(e) => patch({ amount: e.target.value })}
            placeholder="0"
            aria-label="Сумма"
          />
        </label>
        {['expense', 'expense_refund'].includes(draft.kind) && (
          <div className="category-grid" aria-label="Категория">
            {categories
              .filter((c) => work || !['Закупка', 'Карго'].includes(c))
              .map((c) => (
                <button
                  type="button"
                  key={c}
                  aria-pressed={draft.category === c}
                  onClick={() => patch({ category: c })}
                >
                  {c}
                </button>
              ))}
          </div>
        )}
        {work && (
          <label className="field">
            Заказ
            <select
              required
              value={draft.order}
              onChange={(e) => patch({ order: e.target.value })}
            >
              <option value="">Выберите заказ</option>
              {data.orders.map((o) => (
                <option key={o.id} value={o.id}>
                  №{o.order_number} · {o.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          Описание
          <input
            name="note"
            autoComplete="off"
            maxLength={1000}
            placeholder="На что потратил…"
            value={draft.note}
            onChange={(e) => patch({ note: e.target.value })}
          />
        </label>
        <div className="form-pair">
          <label className="field">
            Счёт
            <select
              value={draft.account}
              onChange={(e) => patch({ account: e.target.value, rate: '' })}
            >
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Дата
            <input
              name="date"
              type="date"
              required
              value={draft.date || dushanbeDate()}
              onChange={(e) => patch({ date: e.target.value })}
            />
          </label>
        </div>
        {a && a.currency !== 'TJS' && (
          <label className="field">
            Сомони за 1 {a.currency}
            <input
              inputMode="decimal"
              placeholder={String(r ?? 'Укажите курс…')}
              value={draft.rate}
              onChange={(e) => patch({ rate: e.target.value })}
            />
          </label>
        )}
        {draft.kind === 'transfer' && (
          <div className="form-pair">
            <label className="field">
              На счёт
              <select
                required
                value={draft.toAccount}
                onChange={(e) => patch({ toAccount: e.target.value })}
              >
                <option value="">Выберите</option>
                {data.accounts
                  .filter((x) => x.id !== a?.id)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {x.currency}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              Зачислится
              <input
                required
                inputMode="decimal"
                value={draft.toAmount}
                onChange={(e) => patch({ toAmount: e.target.value })}
              />
            </label>
          </div>
        )}
        {['expense', 'income'].includes(draft.kind) && (
          <label className="plan-switch">
            <span>
              Запланировать<small>Учесть позже, без списания сейчас</small>
            </span>
            <input
              type="checkbox"
              checked={draft.planned}
              onChange={(e) => patch({ planned: e.target.checked })}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        <button className="money-submit" type="submit">
          {busy
            ? 'Сохраняем…'
            : original
              ? 'Сохранить изменения'
              : draft.planned
                ? 'Добавить план'
                : 'Готово'}
        </button>
      </fieldset>
    </form>
  )
}
export function AccountForm({
  original,
  onSaved,
  onBusy,
}: {
  original?: Account
  onSaved: () => Promise<void>
  onBusy: (v: boolean) => void
}) {
  const ownerId = useWalletOwner()
  const [name, setName] = useState(original?.name ?? ''),
    [currency, setCurrency] = useState<Currency>(original?.currency ?? 'TJS'),
    [opening, setOpening] = useState(
      original ? String(original.opening_balance) : '0',
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError('')
    const balance = Number(opening.replace(',', '.'))
    if (
      !name.trim() ||
      !Number.isFinite(balance) ||
      !/^[-+]?\d+(?:[.,]\d{1,2})?$/.test(opening)
    ) {
      setError('Проверьте название и остаток.')
      return
    }
    setBusy(true)
    onBusy(true)
    try {
      const client = createClient(),
        fields = { name: name.trim(), opening_balance: balance }
      checkMoney(
        original
          ? await client
              .from('wallet_accounts')
              .update(fields)
              .eq('id', original.id)
          : await client
              .from('wallet_accounts')
              .insert({ ...fields, currency, owner_id: ownerId }),
      )
      await onSaved()
    } catch (c) {
      setError(c instanceof Error ? c.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
      onBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="money-form">
      <fieldset disabled={busy}>
        <label className="field">
          Название
          <input
            name="name"
            autoComplete="off"
            autoFocus
            required
            maxLength={80}
            placeholder="Например, карта Алиф…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          Валюта
          <select
            disabled={!!original}
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
          >
            {['TJS', 'USD', 'CNY', 'RUB'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Начальный остаток
          <input
            required
            inputMode="decimal"
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
          />
        </label>
        <p className="form-hint">
          Остаток до начала учёта. Он не считается доходом. Валюта созданного
          счёта не меняется.
        </p>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <button className="money-submit">
          {busy ? 'Сохраняем…' : 'Сохранить счёт'}
        </button>
      </fieldset>
    </form>
  )
}
export function DebtForm({
  data,
  onSaved,
  onBusy,
}: {
  data: WalletData
  onSaved: () => Promise<void>
  onBusy: (v: boolean) => void
}) {
  const { rates } = useRates()
  const [d, setD] = useState({
      person: '',
      direction: 'receivable',
      amount: '',
      due: '',
      note: '',
      cash: false,
      account: data.accounts[0]?.id ?? '',
      rate: '',
      cashAmount: '',
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    lock = useRef(false)
  const patch = (v: Partial<typeof d>) => setD((x) => ({ ...x, ...v }))
  async function save(e: FormEvent) {
    e.preventDefault()
    if (lock.current) return
    setError('')
    const amount = parseDecimal(d.amount),
      a = data.accounts.find((a) => a.id === d.account),
      r =
        a?.currency === 'TJS'
          ? 1
          : d.rate
            ? parseRate(d.rate)
            : a
              ? rateFor(a.currency, rates)
              : null,
      cash = a?.currency === 'TJS' ? amount : parseDecimal(d.cashAmount)
    if (!d.person.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError('Укажите человека и сумму.')
      return
    }
    if (
      d.cash &&
      (!r || !a || !Number.isFinite(cash) || roundMoney(cash * r) !== amount)
    ) {
      setError('Сумма в валюте счёта × курс должна равняться долгу.')
      return
    }
    lock.current = true
    setBusy(true)
    onBusy(true)
    try {
      checkMoney(
        await createClient().rpc('wallet_record_loan', {
          p_person: d.person.trim(),
          p_direction: d.direction,
          p_amount: amount,
          p_due: d.due || null,
          p_note: d.note,
          p_account: d.cash ? d.account : null,
          p_cash_amount: d.cash ? cash : null,
          p_rate: d.cash ? r : 1,
        }),
      )
      await onSaved()
    } catch (c) {
      setError(c instanceof Error ? c.message : 'Не удалось сохранить')
    } finally {
      lock.current = false
      setBusy(false)
      onBusy(false)
    }
  }
  return (
    <form onSubmit={save} className="money-form">
      <fieldset disabled={busy}>
        <div className="money-segment">
          {[
            ['receivable', 'Мне должны'],
            ['payable', 'Я должен'],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={d.direction === key}
              onClick={() => patch({ direction: key })}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="field">
          Кто
          <input
            autoFocus
            required
            name="person"
            autoComplete="off"
            maxLength={140}
            placeholder="Имя человека…"
            value={d.person}
            onChange={(e) => patch({ person: e.target.value })}
          />
        </label>
        <label className="amount-field">
          <span>Сумма долга · смн</span>
          <input
            required
            aria-label="Сумма долга"
            inputMode="decimal"
            placeholder="0"
            value={d.amount}
            onChange={(e) => patch({ amount: e.target.value })}
          />
        </label>
        <label className="field">
          Вернуть до
          <input
            type="date"
            value={d.due}
            onChange={(e) => patch({ due: e.target.value })}
          />
        </label>
        <label className="field">
          Комментарий
          <input
            maxLength={1000}
            value={d.note}
            onChange={(e) => patch({ note: e.target.value })}
            placeholder="Необязательно…"
          />
        </label>
        <label className="plan-switch">
          <span>
            Деньги передаю сейчас<small>Включить движение по счёту</small>
          </span>
          <input
            type="checkbox"
            checked={d.cash}
            onChange={(e) => patch({ cash: e.target.checked })}
          />
        </label>
        {d.cash && (
          <>
            <label className="field">
              Счёт
              <select
                value={d.account}
                onChange={(e) => patch({ account: e.target.value })}
              >
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.currency}
                  </option>
                ))}
              </select>
            </label>
            {data.accounts.find((a) => a.id === d.account)?.currency !==
              'TJS' && (
              <div className="form-pair">
                <label className="field">
                  Сумма в валюте
                  <input
                    required
                    inputMode="decimal"
                    value={d.cashAmount}
                    onChange={(e) => patch({ cashAmount: e.target.value })}
                  />
                </label>
                <label className="field">
                  Курс к сомони
                  <input
                    inputMode="decimal"
                    value={d.rate}
                    onChange={(e) => patch({ rate: e.target.value })}
                  />
                </label>
              </div>
            )}
          </>
        )}
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <button className="money-submit">
          {busy ? 'Сохраняем…' : 'Добавить долг'}
        </button>
      </fieldset>
    </form>
  )
}
