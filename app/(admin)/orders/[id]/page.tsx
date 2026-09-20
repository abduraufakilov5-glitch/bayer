'use client'

import Link from 'next/link'
import Image from 'next/image'
import { parseDecimal, validPricing, safeSupplierUrl } from '@/lib/validation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Order, OrderStatus, Product, Submission } from '@/lib/types'
import { calculateCargo, calculateClientPrice, DEFAULT_WEIGHT_GRAMS, formatSomoni } from '@/lib/pricing'

import { downloadCsv, statusLabels as labels } from '@/lib/orders'

function badge(status: OrderStatus) {
  if (status === 'received') return 'bg-amber-100 text-amber-800'
  if (status === 'ordered') return 'bg-blue-100 text-blue-800'
  if (status === 'completed') return 'bg-emerald-100 text-emerald-800'
  return 'bg-neutral-100 text-neutral-700'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const [order, setOrder] = useState<Order | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState({ name: '', price_cny: '', work_price_somoni: '', weight_grams: '', supplier_url: '' })

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data: orderData, error: orderError }, { data: productData, error: productError }, { data: submissionData, error: submissionError }] = await Promise.all([
      supabase.from('buyer_orders').select('*').eq('id', id).single(),
      supabase.from('buyer_products').select('*').eq('order_id', id).order('sort_order'),
      supabase.from('buyer_submissions').select('id, order_id, total_quantity, confirmed_at, buyer_submission_items(*)').eq('order_id', id).maybeSingle(),
    ])
    if (orderError || productError || submissionError) { setError('Не удалось загрузить заказ. Попробуйте ещё раз.'); setLoading(false); return }
    setOrder(orderData as Order | null)
    setProducts((productData ?? []) as Product[])
    const row = submissionData as (Submission & { buyer_submission_items: Submission['items'] }) | null
    setSubmission(row ? { ...row, items: row.buyer_submission_items ?? [] } : null)

    const nextUrls: Record<string, string> = {}
    await Promise.all(((productData ?? []) as Product[]).map(async (product) => {
      const { data } = await supabase.storage.from('buyer-product-images').createSignedUrl(product.image_path, 3600)
      if (data?.signedUrl) nextUrls[product.id] = data.signedUrl
    }))
    setImageUrls(nextUrls)
    setLoading(false)
  }, [id])

  // Fetch external data on mount; state is populated from the asynchronous response.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const publicLink = useMemo(() => order ? window.location.origin + '/o/' + order.public_token : '', [order])
  const productsTotal = useMemo(() => products.reduce((sum, product) => sum + (product.price ?? 0), 0), [products])
  const submissionTotal = useMemo(() => submission?.items.reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0) ?? 0, [submission])

  async function generateLink() {
    if (!order || busy) return
    setBusy(true); setError('')
    const supabase = createClient()
    if (!products.length || products.some(p => p.price == null)) { setError('Добавьте товары и укажите цены перед публикацией.'); setBusy(false); return }
    const { error: updateError } = await supabase.from('buyer_orders').update({ status: 'waiting' }).eq('id', order.id).eq('status', 'draft').select('id').single()
    if (updateError) { setError(updateError.message); setBusy(false); return }
    await load(); setBusy(false)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicLink)
      setCopied(true); setTimeout(() => setCopied(false), 1800)
    } catch { setError('Не удалось скопировать ссылку.') }
  }

  async function setStatus(status: OrderStatus) {
    if (!order || busy) return
    setBusy(true); setError('')
    const supabase = createClient()
    const { error: updateError } = await supabase.from('buyer_orders').update({ status }).eq('id', order.id).eq('status', order.status).select('id').single()
    if (updateError) setError(updateError.message); else await load()
    setBusy(false)
  }

  function startEditing(product: Product) {
    setEditing(product.id); setError('')
    setDraft({
      name: product.name,
      price_cny: product.price_cny == null ? '' : String(product.price_cny),
      work_price_somoni: product.work_price_somoni == null ? '0' : String(product.work_price_somoni),
      weight_grams: product.weight_grams == null ? String(DEFAULT_WEIGHT_GRAMS) : String(product.weight_grams),
      supplier_url: product.supplier_url ?? '',
    })
  }

  async function saveProduct(product: Product) {
    if (order?.status !== 'draft' || busy) return
    const cny = parseDecimal(draft.price_cny)
    const work = parseDecimal(draft.work_price_somoni)
    const weight = Number(draft.weight_grams)
    if (!validPricing(draft.name, cny, work, weight) || (!!draft.supplier_url.trim() && !safeSupplierUrl(draft.supplier_url))) {
      setError('Проверьте название, цену в юанях, работу и вес.'); return
    }
    setBusy(true); setError('')
    const cargo = calculateCargo(weight)
    const clientPrice = calculateClientPrice(cny, work, weight)
    const supabase = createClient()
    const { error: updateError } = await supabase.from('buyer_products').update({
      name: draft.name.trim(),
      price: clientPrice,
      price_cny: cny,
      cargo_cost: cargo,
      work_price_somoni: work,
      weight_grams: weight,
      supplier_url: safeSupplierUrl(draft.supplier_url),
    }).eq('id', product.id)
    if (updateError) setError(updateError.message)
    else { setEditing(null); await load() }
    setBusy(false)
  }

  async function deleteProduct(product: Product) {
    if (order?.status !== 'draft' || busy) return
    if (!confirm('Удалить «' + product.name + '» из этого заказа?')) return
    const supabase = createClient()
    const { error: deleteError } = await supabase.from('buyer_products').delete().eq('id', product.id)
    if (deleteError) { setError(deleteError.message); return }
    // Фото не удаляем: оно принадлежит каталогу и может использоваться в других заказах.
    await load()
  }

  if (loading) return <div className="rounded-[28px] bg-white p-8 text-sm text-neutral-500 shadow-sm ring-1 ring-black/5">Загрузка…</div>
  if (!order) return <div className="rounded-[28px] bg-white p-8 shadow-sm ring-1 ring-black/5"> {error || 'Заказ не найден.'} <button onClick={() => { setError(''); setLoading(true); void load() }} className="underline">Повторить</button></div>

  return (
    <div className="space-y-5 pb-20 sm:pb-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/dashboard" className="text-sm text-neutral-500">← Все заказы</Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-2xl font-semibold tracking-tight">#{String(order.order_number).padStart(5, '0')}</span>
            <span className={"rounded-full px-2.5 py-1 text-xs font-medium " + badge(order.status)}>{labels[order.status]}</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{order.title}</h1>
        </div>
        <div className="flex gap-2">
          {order.status === 'received' && <button disabled={busy} onClick={() => setStatus('ordered')} className="rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white shadow-lg shadow-black/10 disabled:opacity-50">Заказано</button>}
          {order.status === 'ordered' && <button disabled={busy} onClick={() => setStatus('completed')} className="rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white shadow-lg shadow-black/10 disabled:opacity-50">Завершено</button>}
        </div>
      </div>

      {error && <div role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {order.status === 'draft' ? (
        <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.05)] ring-1 ring-black/5">
          <div className="flex items-center justify-between gap-4">
            <div><p className="text-sm font-medium">Ссылка для клиента</p><p className="mt-1 text-sm text-neutral-500">После генерации клиент сможет открыть заказ без регистрации.</p></div>
            <button onClick={generateLink} disabled={busy || products.length === 0} className="shrink-0 rounded-2xl bg-black px-4 py-3 text-sm font-semibold text-white">{busy ? 'Готовим…' : 'Создать'}</button>
          </div>
        </section>
      ) : (
        <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.05)] ring-1 ring-black/5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><p className="text-sm font-medium">Ссылка клиента</p><p className="mt-1 break-all text-xs text-neutral-500">{publicLink}</p></div>
            <button onClick={copyLink} className="shrink-0 rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium">{copied ? 'Скопировано ✓' : 'Копировать'}</button>
          </div>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[24px] bg-black p-4 text-white shadow-lg shadow-black/10"><div className="text-xs text-white/55">Товаров</div><div className="mt-1 text-2xl font-semibold">{products.length}</div></div>
        <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-black/5"><div className="text-xs text-neutral-500">Итого за 1 шт. каждого</div><div className="mt-1 text-2xl font-semibold">{formatSomoni(productsTotal)}</div></div>
        <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-black/5"><div className="text-xs text-neutral-500">Клиент заказал</div><div className="mt-1 text-2xl font-semibold">{submission ? formatSomoni(submissionTotal) : '—'}</div></div>
      </section>

      {order.status !== 'draft' && <p className="text-sm text-neutral-500">Заказ опубликован: состав и цены зафиксированы.</p>}
      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Товары</h2><Link href="/catalog" className="text-sm font-medium text-neutral-500">Каталог →</Link></div>
        {products.map((product) => {
          const finalPrice = product.price ?? calculateClientPrice(product.price_cny ?? 0, product.work_price_somoni ?? 0, product.weight_grams ?? DEFAULT_WEIGHT_GRAMS)
          return (
            <article key={product.id} className="rounded-[28px] bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.05)] ring-1 ring-black/5">
              <div className="flex gap-4">
                <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-neutral-100 sm:h-28 sm:w-28">
                  {imageUrls[product.id] && <Image unoptimized width={400} height={400} src={imageUrls[product.id]} alt="Фото товара" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  {editing === product.id ? (
                    <div className="space-y-2">
                      <input aria-label="Название товара" maxLength={200} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className="h-10 w-full rounded-xl border border-neutral-200 px-3 text-sm" />
                      <div className="grid gap-2 sm:grid-cols-3">
                        <input value={draft.price_cny} onChange={(e) => setDraft((d) => ({ ...d, price_cny: e.target.value }))} inputMode="decimal" aria-label="Цена в юанях" placeholder="¥" className="h-10 rounded-xl border border-neutral-200 px-3 text-sm" />
                        <input value={draft.work_price_somoni} onChange={(e) => setDraft((d) => ({ ...d, work_price_somoni: e.target.value }))} inputMode="decimal" aria-label="Работа, смн" placeholder="Работа, смн" className="h-10 rounded-xl border border-neutral-200 px-3 text-sm" />
                        <input value={draft.weight_grams} onChange={(e) => setDraft((d) => ({ ...d, weight_grams: e.target.value }))} inputMode="numeric" aria-label="Вес, г" placeholder="Вес, г" className="h-10 rounded-xl border border-neutral-200 px-3 text-sm" />
                      </div>
                      <input value={draft.supplier_url} onChange={(e) => setDraft((d) => ({ ...d, supplier_url: e.target.value }))} placeholder="Ссылка поставщика" className="h-10 w-full rounded-xl border border-neutral-200 px-3 text-sm" />
                      <div className="rounded-xl bg-neutral-950 px-3 py-2 text-xs text-white/75">Цена клиенту: <strong className="text-white">{formatSomoni(calculateClientPrice(parseDecimal(draft.price_cny) || 0, parseDecimal(draft.work_price_somoni) || 0, Number(draft.weight_grams) || DEFAULT_WEIGHT_GRAMS))}</strong></div>
                      <div className="flex gap-2">
                        <button disabled={busy} onClick={() => saveProduct(product)} className="rounded-xl bg-black px-3 py-2 text-xs font-medium text-white">Сохранить</button>
                        <button disabled={busy} onClick={() => setEditing(null)} className="rounded-xl bg-neutral-100 px-3 py-2 text-xs font-medium">Отмена</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{product.name}</div>
                          <div className="mt-1 text-lg font-semibold">{formatSomoni(finalPrice)}</div>
                        </div>
                        {order.status === 'draft' && <div className="flex shrink-0 items-center gap-3 text-xs">
                          <button onClick={() => startEditing(product)} className="text-neutral-700">Изменить</button>
                          <button onClick={() => deleteProduct(product)} className="text-red-600">Удалить</button>
                        </div>}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">
                        <span>¥{product.price_cny ?? '—'} → {formatSomoni((product.price_cny ?? 0) * 1.4)}</span>
                        <span>Карго {formatSomoni(product.cargo_cost ?? calculateCargo(product.weight_grams ?? DEFAULT_WEIGHT_GRAMS))}</span>
                        <span>Работа {formatSomoni(product.work_price_somoni ?? 0)}</span>
                        <span>{product.weight_grams ?? DEFAULT_WEIGHT_GRAMS} г</span>
                      </div>
                      {safeSupplierUrl(product.supplier_url) && <a href={safeSupplierUrl(product.supplier_url)!} target="_blank" rel="noreferrer" className="mt-2 block truncate text-xs text-blue-600">Поставщик ↗</a>}
                    </>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </section>

      {submission && <button onClick={() => downloadCsv(`bayer-order-${order.order_number}.csv`, [['Товар', 'Количество', 'Цена, смн', 'Сумма, смн'], ...submission.items.map(item => [item.product_name, item.quantity, item.price, item.price == null ? null : Math.round(item.price * item.quantity * 100) / 100]), ['Итого', submission.total_quantity, null, Math.round(submissionTotal * 100) / 100]])} className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm font-medium">Скачать состав заказа CSV</button>}
      {submission && (
        <section className="rounded-[28px] bg-black p-5 text-white shadow-lg shadow-black/10">
          <div className="flex items-start justify-between gap-4">
            <div><div className="text-sm text-white/55">Подтверждённый заказ</div><div className="mt-1 text-xl font-semibold">{submission.total_quantity} шт.</div></div>
            <div className="text-right"><div className="text-lg font-semibold">{formatSomoni(submissionTotal)}</div><div className="mt-1 text-xs text-white/55">{formatDate(submission.confirmed_at)}</div></div>
          </div>
          <div className="mt-5 divide-y divide-white/10">
            {submission.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 py-3 text-sm"><span>{item.product_name}</span><span className="text-right font-semibold">× {item.quantity}<span className="ml-2 font-normal text-white/55">{formatSomoni((item.price ?? 0) * item.quantity)}</span></span></div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
