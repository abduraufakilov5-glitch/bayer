'use client'
import Link from 'next/link'
import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Order, Product, Submission, Purchase } from '@/lib/types'
import { statusLabels } from '@/lib/orders'
import { daysRemaining } from '@/lib/retention'
import { formatSomoni } from '@/lib/pricing'
import { signProductImages, type ImageCache } from '@/lib/product-images'
import { OrderEditor } from '@/app/components/order-editor'
import { PurchaseList } from '@/app/components/purchase-list'
import { parseDecimal } from '@/lib/validation'
export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>(),
    [order, setOrder] = useState<Order | null>(null),
    [products, setProducts] = useState<Product[]>([]),
    [submissions, setSubmissions] = useState<Submission[]>([]),
    [purchases, setPurchases] = useState<Purchase[]>([]),
    [images, setImages] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [cash, setCash] = useState(''),
    [kind, setKind] = useState('payment')
  const cache = useRef<ImageCache>(new Map()),
    fetching = useRef(false),
    cashId = useRef(crypto.randomUUID()),
    pendingCash = useRef<{ kind: string; amount: number } | null>(null),
    actionLock = useRef(false)
  const load = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    try {
      const c = createClient(),
        [o, p, s, b] = await Promise.all([
          c.from('buyer_orders').select('*').eq('id', id).single(),
          c
            .from('buyer_products')
            .select('*')
            .eq('order_id', id)
            .order('sort_order'),
          c
            .from('buyer_submissions')
            .select('*,buyer_submission_items(*)')
            .eq('order_id', id)
            .order('revision', { ascending: false }),
          c.from('buyer_purchases').select('*').eq('order_id', id),
        ])
      if (o.error || p.error || s.error || b.error) throw new Error('load')
      setOrder(o.data)
      setProducts(p.data ?? [])
      setSubmissions(
        (s.data ?? []).map((r) => ({ ...r, items: r.buyer_submission_items })),
      )
      setPurchases(b.data ?? [])
      setImages(await signProductImages(c, p.data ?? [], cache.current))
      setError('')
    } catch {
      setError(
        'Не удалось загрузить заказ. Проверьте соединение или войдите повторно.',
      )
    } finally {
      fetching.current = false
    }
  }, [id])
  // Fetching initial remote state is an external synchronization.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 15000)
    window.addEventListener('focus', load)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', load)
    }
  }, [load])
  async function action(name: string) {
    if (actionLock.current) return
    if (
      name === 'reopen' &&
      !confirm(
        'Открыть новую версию для повторного согласования? Старое подтверждение сохранится, закупки не будут скопированы.',
      )
    )
      return
    actionLock.current = true
    setBusy(true)
    try {
      const c = createClient()
      const r = ['ordered', 'completed'].includes(name)
        ? await c.from('buyer_orders').update({ status: name }).eq('id', id)
        : await c.rpc('buyer_order_action', { p_id: id, p_action: name })
      if (r.error) throw r.error
      await load()
    } catch {
      setError(
        'Действие не выполнено. Для статуса «Заказано» обработайте каждую позицию.',
      )
    } finally {
      actionLock.current = false
      setBusy(false)
    }
  }
  async function share() {
    if (!order) return
    const url = location.origin + '/o/' + order.public_token
    try {
      if (navigator.share) await navigator.share({ title: order.title, url })
      else {
        await navigator.clipboard.writeText(url)
        setNotice('Ссылка скопирована')
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError'))
        setError('Не удалось поделиться ссылкой.')
    }
  }
  async function recordCash() {
    if (actionLock.current) return
    const amount = parseDecimal(cash)
    if (!(amount > 0)) {
      setError('Укажите сумму больше нуля.')
      return
    }
    if (
      pendingCash.current &&
      (pendingCash.current.kind !== kind ||
        pendingCash.current.amount !== amount)
    ) {
      setError(
        'Сначала повторите прежний платёж с той же суммой. После успешной записи можно добавить корректировку.',
      )
      return
    }
    pendingCash.current = { kind, amount }
    actionLock.current = true
    setBusy(true)
    try {
      const { error } = await createClient().rpc('buyer_record_cash', {
        p_id: cashId.current,
        p_order: id,
        p_kind: kind,
        p_amount: amount,
      })
      if (error) throw error
      cashId.current = crypto.randomUUID()
      pendingCash.current = null
      setCash('')
      setNotice('Движение денег записано')
    } catch {
      setError(
        'Не удалось записать платёж. Повторите с той же суммой — двойной записи не будет.',
      )
    } finally {
      actionLock.current = false
      setBusy(false)
    }
  }
  if (!order)
    return (
      <div>
        <p role="status">{error || 'Загрузка…'}</p>
        <button className="btn btn-secondary" onClick={() => void load()}>
          Повторить
        </button>
      </div>
    )
  const receipt = submissions.find((s) => s.revision === order.revision),
    days = daysRemaining(order.created_at)
  return (
    <div className="detail-page editor-stack">
      <Link className="back-link" href="/dashboard">
        ← Все заказы
      </Link>
      <div>
        <p className="eyebrow">
          № {String(order.order_number).padStart(5, '0')} · версия{' '}
          {order.revision} · {statusLabels[order.status]}
        </p>
        <h1 className="page-title mt-3 break-words">{order.title}</h1>
        <p className={days <= 3 ? 'notice mt-3' : 'subtitle mt-3'}>
          Удаление через {days} дн.
          {days <= 1 && order.status !== 'completed'
            ? ' Заказ не завершён — сохраните нужные итоги сегодня.'
            : ''}
        </p>
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="order-actions">
        {order.status === 'draft' ? null : (
          <>
            <button
              disabled={order.link_revoked}
              className="btn btn-primary"
              onClick={() => void share()}
            >
              Поделиться
            </button>
            {order.status !== 'completed' && (
              <button
                disabled={busy}
                className="btn btn-secondary"
                onClick={() => void action('reopen')}
              >
                Повторное согласование
              </button>
            )}
          </>
        )}
        {order.status === 'waiting' && (
          <>
            <button
              className="btn btn-secondary"
              disabled={busy || order.link_revoked}
              onClick={() => void action('revoke')}
            >
              Отозвать ссылку
            </button>
            <button
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => void action('rotate')}
            >
              Новая ссылка
            </button>
          </>
        )}
        {order.status === 'received' && (
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void action('ordered')}
          >
            Заказано
          </button>
        )}
        {order.status === 'ordered' && (
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void action('completed')}
          >
            Завершено
          </button>
        )}
      </div>
      {order.status === 'draft' ? (
        <OrderEditor
          key={order.id + ':' + order.revision}
          order={order}
          products={products}
          onPublished={setOrder}
        />
      ) : (
        <>
          <p className="subtitle">
            Заказ опубликован: состав и цены зафиксированы.
          </p>
          {receipt ? (
            <PurchaseList
              orderId={id}
              submission={receipt}
              purchases={purchases}
              images={images}
              onSaved={() => void load()}
              disabled={order.status === 'completed'}
            />
          ) : (
            <div className="editor-stack">
              {products.map((p) => (
                <article className="panel panel-padding flex gap-4" key={p.id}>
                  {images[p.id] && (
                    <Image
                      unoptimized
                      width={88}
                      height={110}
                      src={images[p.id]}
                      alt={p.name}
                      className="w-22 h-28 object-contain rounded-xl"
                    />
                  )}
                  <div className="min-w-0">
                    <h2 className="font-semibold break-words">{p.name}</h2>
                    <p>{formatSomoni(p.price)}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
      <details className="panel panel-padding">
        <summary>Оплаты, возвраты и корректировки</summary>
        <p className="subtitle text-sm mt-3">
          Подтверждение клиента не является оплатой. Расходы на товары и карго
          записывайте в закупке; здесь — только дополнительные движения денег.
        </p>
        <select
          aria-label="Тип движения"
          className="mt-3"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="payment">Получена оплата</option>
          <option value="refund">Возврат клиенту</option>
          <option value="expense">Дополнительный расход</option>
          <option value="expense_refund">Возврат расхода</option>
        </select>
        <label className="field mt-3">
          Сумма, смн
          <input
            inputMode="decimal"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
          />
        </label>
        <button
          className="btn btn-primary mt-3"
          disabled={busy}
          onClick={() => void recordCash()}
        >
          Записать движение
        </button>
      </details>
      {submissions.length > 0 && (
        <details className="panel panel-padding">
          <summary>История подтверждений · {submissions.length}</summary>
          {submissions.map((s) => (
            <div className="mt-4" key={s.id}>
              <strong>
                Версия {s.revision} ·{' '}
                {new Date(s.confirmed_at).toLocaleString('ru-RU')}
              </strong>
              {s.note && <p className="break-words">{s.note}</p>}
              {s.items.map((i) => (
                <p className="break-words text-sm mt-2" key={i.id}>
                  {i.product_name} × {i.quantity} · {formatSomoni(i.price)}
                  {i.note ? ' · ' + i.note : ''}
                </p>
              ))}
            </div>
          ))}
        </details>
      )}
    </div>
  )
}
