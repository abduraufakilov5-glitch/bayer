'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Order, OrderStatus, Product, Submission } from '@/lib/types'

const labels: Record<OrderStatus, string> = { draft: 'Draft', waiting: 'Waiting', received: 'Received', ordered: 'Ordered', completed: 'Completed' }

function badge(status: OrderStatus) {
  if (status === 'received') return 'bg-amber-100 text-amber-800'
  if (status === 'ordered') return 'bg-blue-100 text-blue-800'
  if (status === 'completed') return 'bg-emerald-100 text-emerald-800'
  return 'bg-neutral-100 text-neutral-700'
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
  const [draft, setDraft] = useState({ name: '', price: '', supplier_url: '' })

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const [{ data: orderData }, { data: productData }, { data: submissionData }] = await Promise.all([
      supabase.from('orders').select('*').eq('id', id).single(),
      supabase.from('products').select('*').eq('order_id', id).order('sort_order'),
      supabase.from('order_submissions').select('id, order_id, total_quantity, confirmed_at, order_submission_items(*)').eq('order_id', id).maybeSingle(),
    ])
    setOrder(orderData as Order | null)
    setProducts((productData ?? []) as Product[])
    const row = submissionData as (Submission & { order_submission_items: Submission['items'] }) | null
    setSubmission(row ? { ...row, items: row.order_submission_items ?? [] } : null)

    const nextUrls: Record<string, string> = {}
    for (const product of (productData ?? []) as Product[]) {
      const { data } = await supabase.storage.from('product-images').createSignedUrl(product.image_path, 3600)
      if (data?.signedUrl) nextUrls[product.id] = data.signedUrl
    }
    setImageUrls(nextUrls)
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  const publicLink = useMemo(() => order ? window.location.origin + '/o/' + order.public_token : '', [order])

  async function generateLink() {
    if (!order) return
    setBusy(true); setError('')
    const supabase = createClient()
    const { error: updateError } = await supabase.from('orders').update({ status: 'waiting' }).eq('id', order.id)
    if (updateError) { setError(updateError.message); setBusy(false); return }
    await load()
    setBusy(false)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { setError('Не удалось скопировать ссылку.') }
  }

  async function setStatus(status: OrderStatus) {
    if (!order) return
    setBusy(true); setError('')
    const supabase = createClient()
    const { error: updateError } = await supabase.from('orders').update({ status }).eq('id', order.id)
    if (updateError) setError(updateError.message)
    else await load()
    setBusy(false)
  }

  function startEditing(product: Product) {
    setEditing(product.id)
    setDraft({ name: product.name, price: product.price == null ? '' : String(product.price), supplier_url: product.supplier_url ?? '' })
    setError('')
  }

  async function saveProduct(product: Product) {
    if (!draft.name.trim()) { setError('Название товара не может быть пустым.'); return }
    setBusy(true); setError('')
    const supabase = createClient()
    const { error: updateError } = await supabase.from('products').update({
      name: draft.name.trim(),
      price: draft.price.trim() ? Number(draft.price) : null,
      supplier_url: draft.supplier_url.trim() || null,
    }).eq('id', product.id)
    if (updateError) setError(updateError.message)
    else { setEditing(null); await load() }
    setBusy(false)
  }

  async function deleteProduct(product: Product) {
    if (!confirm('Удалить «' + product.name + '»?')) return
    const supabase = createClient()
    const { error: deleteError } = await supabase.from('products').delete().eq('id', product.id)
    if (deleteError) { setError(deleteError.message); return }
    await supabase.storage.from('product-images').remove([product.image_path])
    await load()
  }

  if (loading) return <div className="rounded-3xl bg-white p-8 text-sm text-neutral-500">Загрузка…</div>
  if (!order) return <div className="rounded-3xl bg-white p-8">Заказ не найден.</div>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/dashboard" className="text-sm text-neutral-500">← Все заказы</Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-2xl font-semibold">#{String(order.order_number).padStart(5, '0')}</span>
            <span className={"rounded-full px-2.5 py-1 text-xs font-medium " + badge(order.status)}>{labels[order.status]}</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{order.title}</h1>
        </div>
        <div className="flex gap-2">
          {order.status === 'received' && <button disabled={busy} onClick={() => setStatus('ordered')} className="rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white disabled:opacity-50">Заказано</button>}
          {order.status === 'ordered' && <button disabled={busy} onClick={() => setStatus('completed')} className="rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white disabled:opacity-50">Завершено</button>}
        </div>
      </div>

      {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {order.status === 'draft' ? (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <h2 className="font-semibold">Ссылка для клиента</h2>
          <p className="mt-1 text-sm text-neutral-500">После генерации клиент сможет открыть заказ без регистрации.</p>
          <button onClick={generateLink} disabled={busy} className="mt-4 rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Готовим…' : 'Сгенерировать ссылку'}</button>
        </section>
      ) : (
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Ссылка клиента</h2>
              <p className="mt-1 break-all text-xs text-neutral-500">{publicLink}</p>
            </div>
            <button onClick={copyLink} className="shrink-0 rounded-2xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm font-medium">{copied ? 'Скопировано' : 'Копировать'}</button>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Товары</h2>
          <span className="text-sm text-neutral-500">{products.length}</span>
        </div>
        {products.map((product) => (
          <div key={product.id} className="flex gap-4 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-neutral-100">
              {imageUrls[product.id] && <img src={imageUrls[product.id]} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              {editing === product.id ? (
                <div className="space-y-2">
                  <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className="h-10 w-full rounded-xl border border-neutral-200 px-3 text-sm outline-none focus:border-black" />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} inputMode="decimal" placeholder="Цена" className="h-10 rounded-xl border border-neutral-200 px-3 text-sm outline-none focus:border-black" />
                    <input value={draft.supplier_url} onChange={(e) => setDraft((d) => ({ ...d, supplier_url: e.target.value }))} placeholder="Ссылка поставщика" className="h-10 rounded-xl border border-neutral-200 px-3 text-sm outline-none focus:border-black" />
                  </div>
                  <div className="flex gap-2">
                    <button disabled={busy} onClick={() => saveProduct(product)} className="rounded-xl bg-black px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Сохранить</button>
                    <button disabled={busy} onClick={() => setEditing(null)} className="rounded-xl bg-neutral-100 px-3 py-2 text-xs font-medium">Отмена</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{product.name}</div>
                      {product.price != null && <div className="mt-1 text-sm text-neutral-500">Цена: {product.price}</div>}
                      {product.supplier_url && <a href={product.supplier_url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-blue-600">Поставщик ↗</a>}
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <button onClick={() => startEditing(product)} className="text-neutral-700">Изменить</button>
                      <button onClick={() => deleteProduct(product)} className="text-red-600">Удалить</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </section>

      {submission && (
        <section className="rounded-3xl bg-black p-5 text-white shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-white/60">Подтверждённый заказ</div>
              <div className="mt-1 text-xl font-semibold">{submission.total_quantity} шт.</div>
            </div>
            <div className="text-right text-xs text-white/60">{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(submission.confirmed_at))}</div>
          </div>
          <div className="mt-5 divide-y divide-white/10">
            {submission.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span>{item.product_name}</span><span className="font-semibold">× {item.quantity}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
