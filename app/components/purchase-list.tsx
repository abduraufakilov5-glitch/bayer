'use client'
import { useRef, useState } from 'react'
import Image from 'next/image'
import type { Purchase, Submission } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'
import { formatSomoni } from '@/lib/pricing'
import {
  safeSupplierUrl,
  parseOptionalPrice,
  parseExchangeRate,
} from '@/lib/validation'
export function PurchaseList({
  orderId,
  submission,
  purchases,
  images,
  onSaved,
  disabled = false,
}: {
  orderId: string
  submission: Submission
  purchases: Purchase[]
  images: Record<string, string>
  onSaved: () => void
  disabled?: boolean
}) {
  const completed = submission.items.filter((i) => {
    const p = purchases.find((p) => p.product_id === i.product_id)
    return p && p.purchased_quantity + p.cancelled_quantity >= i.quantity
  }).length
  const [notice, setNotice] = useState('')
  const text = [
    `Заказ: ${submission.total_quantity} шт.`,
    submission.note,
    ...submission.items.map((i) => {
      const p = purchases.find((p) => p.product_id === i.product_id)
      return `${i.product_name} × ${i.quantity} · куплено ${p?.purchased_quantity ?? 0}${i.note ? ' · ' + i.note : ''}${safeSupplierUrl(i.supplier_url) ? '\n' + i.supplier_url : ''}`
    }),
  ]
    .filter(Boolean)
    .join('\n')
  async function share() {
    try {
      if (navigator.share)
        await navigator.share({ text, title: 'Список закупки' })
      else {
        await navigator.clipboard.writeText(text)
        setNotice('Скопировано')
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError'))
        setNotice('Не удалось поделиться. Попробуйте копирование.')
    }
  }
  return (
    <section className="editor-stack">
      <div>
        <h2 className="text-2xl font-semibold">Закупка</h2>
        <p className="subtitle">
          {completed} из {submission.items.length} позиций обработано
        </p>
        <progress
          max={submission.items.length}
          value={completed}
          className="w-full"
        />
        {submission.note && (
          <p className="panel panel-padding break-words">{submission.note}</p>
        )}
        <div className="order-actions mt-3">
          <button
            className="btn btn-secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text)
                setNotice('Скопировано')
              } catch {
                setNotice('Копирование недоступно')
              }
            }}
          >
            Копировать список
          </button>
          <button className="btn btn-secondary" onClick={() => void share()}>
            Поделиться списком
          </button>
        </div>
        {notice && <p role="status">{notice}</p>}
      </div>
      {submission.items.map((i) => (
        <PurchaseRow
          key={
            i.id +
            ':' +
            (purchases.find((p) => p.product_id === i.product_id)?.version ?? 0)
          }
          item={i}
          purchase={purchases.find((p) => p.product_id === i.product_id)}
          image={images[i.product_id ?? '']}
          orderId={orderId}
          onSaved={onSaved}
          disabled={disabled}
        />
      ))}
    </section>
  )
}
function PurchaseRow({
  item: i,
  purchase: p,
  image,
  orderId,
  onSaved,
  disabled,
}: {
  item: Submission['items'][number]
  purchase?: Purchase
  image?: string
  orderId: string
  onSaved: () => void
  disabled: boolean
}) {
  const [qty, setQty] = useState(String(p?.purchased_quantity ?? 0)),
    [cancel, setCancel] = useState(String(p?.cancelled_quantity ?? 0)),
    [cny, setCny] = useState(
      p?.actual_price_cny == null ? '' : String(p.actual_price_cny),
    ),
    [rate, setRate] = useState(
      p?.actual_exchange_rate == null ? '' : String(p.actual_exchange_rate),
    ),
    [cargo, setCargo] = useState(
      p?.actual_cargo == null ? '' : String(p.actual_cargo),
    ),
    [extra, setExtra] = useState(String(p?.extra_cost ?? 0)),
    [problem, setProblem] = useState(p?.problem ?? ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const lock = useRef(false)
  async function save(quantity = Number(qty)) {
    if (lock.current || disabled) return
    const numbers = [
        parseOptionalPrice(cny),
        parseExchangeRate(rate),
        parseOptionalPrice(cargo),
      ],
      extraNumber = parseOptionalPrice(extra)
    if (
      !Number.isInteger(quantity) ||
      !Number.isInteger(Number(cancel)) ||
      quantity < 0 ||
      Number(cancel) < 0 ||
      quantity + Number(cancel) > i.quantity ||
      numbers.some(Number.isNaN) ||
      extraNumber == null ||
      Number.isNaN(extraNumber)
    ) {
      setError(
        'Проверьте количество и расходы. Неизвестные расходы оставьте пустыми.',
      )
      return
    }
    lock.current = true
    setBusy(true)
    try {
      const { error } = await createClient().rpc('buyer_save_purchase', {
        p_order: orderId,
        p_product: i.product_id,
        p_version: p?.version ?? 0,
        p_quantity: quantity,
        p_cancelled: Number(cancel),
        p_cny: numbers[0],
        p_rate: numbers[1],
        p_cargo: numbers[2],
        p_extra: extraNumber,
        p_problem: problem,
      })
      if (error) throw error
      setError('')
      onSaved()
    } catch {
      setError(
        'Не сохранено. Обновите данные перед повтором: другая вкладка могла изменить закупку.',
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <article className="panel panel-padding">
      <div className="flex gap-4">
        {image && (
          <Image
            unoptimized
            width={88}
            height={110}
            src={image}
            alt={i.product_name}
            className="w-22 h-28 rounded-xl object-contain"
          />
        )}
        <div className="min-w-0">
          <h3 className="font-semibold break-words">
            {i.product_name} × {i.quantity}
          </h3>
          {i.note && <p className="mt-2 break-words">{i.note}</p>}
          <p className="subtitle text-xs mt-2">
            Закупка: {i.price_cny == null ? 'неизвестно' : `¥${i.price_cny}`} ·
            карго: {formatSomoni(i.cargo_cost)} · работа:{' '}
            {formatSomoni(i.work_price_somoni)}
            <br />
            Клиенту:{' '}
            {formatSomoni(i.price == null ? null : i.price * i.quantity)}
          </p>
          {safeSupplierUrl(i.supplier_url) && (
            <a
              className="text-button inline-block"
              href={safeSupplierUrl(i.supplier_url)!}
              target="_blank"
              rel="noreferrer"
            >
              Открыть поставщика ↗
            </a>
          )}
          {p?.problem && <p className="notice mt-2 break-words">{p.problem}</p>}
          <p className="subtitle">
            Куплено {p?.purchased_quantity ?? 0} / {i.quantity}
            {(p?.cancelled_quantity ?? 0) > 0
              ? ` · отменено ${p?.cancelled_quantity}`
              : ''}
          </p>
        </div>
      </div>
      <fieldset disabled={busy || disabled} className="mt-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            Куплено, шт.
            <input
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </label>
          <label className="field">
            Отменено, шт.
            <input
              inputMode="numeric"
              value={cancel}
              onChange={(e) => setCancel(e.target.value)}
            />
          </label>
        </div>
        <details className="mt-3">
          <summary>Фактические расходы и проблема</summary>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <label className="field">
              Цена за шт., ¥
              <input
                inputMode="decimal"
                value={cny}
                onChange={(e) => setCny(e.target.value)}
              />
            </label>
            <label className="field">
              Реальный курс ¥
              <input
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </label>
            <label className="field">
              Карго всего, смн
              <input
                inputMode="decimal"
                value={cargo}
                onChange={(e) => setCargo(e.target.value)}
              />
            </label>
            <label className="field">
              Доп. расходы, смн
              <input
                inputMode="decimal"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
              />
            </label>
          </div>
          <label className="field mt-3">
            Проблема / отсутствие
            <textarea
              maxLength={300}
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
            />
          </label>
        </details>
        <div className="order-actions mt-3">
          <button className="btn btn-primary" onClick={() => void save()}>
            Сохранить закупку
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setQty(String(i.quantity - Number(cancel)))
              void save(i.quantity - Number(cancel))
            }}
          >
            Куплено всё
          </button>
        </div>
      </fieldset>
      {error && (
        <p className="notice mt-3" role="alert">
          {error}
        </p>
      )}
    </article>
  )
}
