'use client'

import Link from 'next/link'
import Image from 'next/image'
import { parseDecimal, validPricing, safeSupplierUrl } from '@/lib/validation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Order, OrderStatus, Product, Submission } from '@/lib/types'
import { calculateCargo, calculateClientPrice, DEFAULT_WEIGHT_GRAMS, formatSomoni } from '@/lib/pricing'

import { PricingFields, type PricingDraft } from '@/app/components/pricing-fields'
import { Icon } from '@/app/components/icons'
import { signProductImages, type ImageCache } from '@/lib/product-images'
import { statusLabels as labels } from '@/lib/orders'

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
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
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [draft, setDraft] = useState<PricingDraft & {name:string;supplier_url:string}>({name:'',priceCny:'',workPrice:'0',weightGrams:String(DEFAULT_WEIGHT_GRAMS),supplier_url:''})
  const imageCache = useRef<ImageCache>(new Map())
  const productCache = useRef<{id:string;rows:Product[]} | null>(null)
  const fetching = useRef(false)

  const load = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    try {
      const supabase = createClient()
      const [orderResult, submissionResult] = await Promise.all([
        supabase.from('buyer_orders').select('*').eq('id', id).single(),
        supabase.from('buyer_submissions').select('id, order_id, total_quantity, confirmed_at, buyer_submission_items(*)').eq('order_id', id).maybeSingle(),
      ])
      if (orderResult.error || submissionResult.error) throw new Error('load failed')
      const nextOrder = orderResult.data as Order
      let rows: Product[]
      if (nextOrder.status !== 'draft' && productCache.current?.id === id) rows = productCache.current.rows
      else {
        const result = await supabase.from('buyer_products').select('*').eq('order_id', id).order('sort_order')
        if (result.error) throw result.error
        rows = (result.data ?? []) as Product[]
        // Only immutable published rows can safely be reused on refresh.
        productCache.current = nextOrder.status === 'draft' ? null : {id,rows}
      }
      const urls = await signProductImages(supabase,rows,imageCache.current)
      setOrder(nextOrder);setProducts(rows);setImageUrls(urls);setError('')
      const row = submissionResult.data as (Submission & {buyer_submission_items:Submission['items']}) | null
      setSubmission(row ? {...row,items:row.buyer_submission_items ?? []} : null)
    } catch {setError('Не удалось загрузить заказ. Проверьте подключение и повторите.')}
    finally {setLoading(false);fetching.current=false}
  }, [id])

  // Fetch external data on mount; state is populated from the asynchronous response.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    const refresh = () => { if (document.visibilityState === 'visible') void load() }
    const timer = setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [load])

  const publicLink = useMemo(() => order ? window.location.origin + '/o/' + order.public_token : '', [order])
  const productsTotal = useMemo(() => products.reduce((sum, product) => sum + (product.price ?? 0), 0), [products])
  const submissionTotal = useMemo(() => submission?.items.reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0) ?? 0, [submission])

  async function generateLink() {
    if (!order || order.deleted_at || busy) return
    setBusy(true); setError('')
    const supabase = createClient()
    if (!products.length) { setError('Добавьте товары перед публикацией.'); setBusy(false); return }
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

  async function shareOrder() {
    if (!order) return
    if (!navigator.share) {await copyLink();return}
    try {await navigator.share({title:order.title,text:'Выберите товары и количество в вашей подборке',url:publicLink})}
    catch (cause) {if (!(cause instanceof Error && cause.name === 'AbortError')) setError('Не удалось поделиться. Используйте «Копировать».')}
  }

  async function setStatus(status: OrderStatus) {
    if (!order || order.deleted_at || busy) return
    setBusy(true); setError('')
    const supabase = createClient()
    const { error: updateError } = await supabase.from('buyer_orders').update({ status }).eq('id', order.id).eq('status', order.status).select('id').single()
    if (updateError) setError(updateError.message); else await load()
    setBusy(false)
  }

  function startTitleEdit() {
    if (!order || order.deleted_at) return
    setTitleDraft(order.title)
    setEditingTitle(true)
    setError('')
  }

  async function saveTitle() {
    const title = titleDraft.trim()
    if (!order || order.deleted_at || busy) return
    if (!title || title.length > 140) { setError('Название должно содержать от 1 до 140 символов.'); return }
    setBusy(true); setError('')
    const supabase = createClient()
    const { error: updateError } = await supabase.from('buyer_orders').update({title}).eq('id',order.id).is('deleted_at',null)
    if (updateError) setError(updateError.message)
    else { setEditingTitle(false); await load() }
    setBusy(false)
  }

  async function deleteOrder() {
    if (!order || order.deleted_at || busy) return
    if (!confirm('Переместить заказ № ' + String(order.order_number).padStart(5,'0') + ' в корзину? Ссылка клиента перестанет открываться.')) return
    setBusy(true); setError('')
    const supabase = createClient()
    const { error: updateError } = await supabase.from('buyer_orders').update({deleted_at:new Date().toISOString()}).eq('id',order.id).is('deleted_at',null)
    if (updateError) { setError(updateError.message); setBusy(false); return }
    router.push('/dashboard')
    router.refresh()
  }

  function startEditing(product: Product) {
    setEditing(product.id); setError('')
    setDraft({
      name: product.name,
      priceCny: product.price_cny == null ? '' : String(product.price_cny),
      workPrice: String(product.work_price_somoni ?? 0),
      weightGrams: String(product.weight_grams ?? DEFAULT_WEIGHT_GRAMS),
      supplier_url: product.supplier_url ?? '',
    })
  }

  async function saveProduct(product: Product) {
    if (order?.status !== 'draft' || busy) return
    const cny = draft.priceCny.trim() ? parseDecimal(draft.priceCny) : null
    const work = parseDecimal(draft.workPrice), weight = Number(draft.weightGrams)
    const price = cny == null ? product.price : calculateClientPrice(cny,work,weight)
    if (!validPricing(draft.name,cny ?? 0,work,weight) || (!!draft.supplier_url.trim() && !safeSupplierUrl(draft.supplier_url))) {
      setError('Проверьте название, цену и ссылку поставщика.'); return
    }
    setBusy(true); setError('')
    const supabase = createClient()
    const { error: updateError } = await supabase.from('buyer_products').update({
      name: draft.name.trim(),
      price,
      price_cny: cny,
      cargo_cost: calculateCargo(weight),
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

  if (loading) return <div className="editor space-y-5" role="status" aria-label="Загрузка заказа"><div className="skeleton"/><div className="skeleton"/></div>
  if (!order) return <div className="empty-state"><h1 className="text-xl font-semibold">{error || 'Заказ не найден'}</h1><button className="btn btn-secondary mt-5" onClick={() => {setLoading(true);void load()}}>Повторить</button></div>

  return <div className="detail-page space-y-6">
    <Link href="/dashboard" className="back-link"><Icon name="back" size={14}/>Все заказы</Link>
    <div className="flex flex-wrap items-start justify-between gap-5"><div className="min-w-0 flex-1"><div className="flex items-center gap-3 mb-3"><span className="order-id">Заказ № {String(order.order_number).padStart(5,'0')}</span><span className={'status-badge status-'+order.status}>{labels[order.status]}</span></div>{editingTitle ? <div className="inline-editor"><input autoFocus aria-label="Название заказа" maxLength={140} value={titleDraft} onChange={event => setTitleDraft(event.target.value)} onKeyDown={event => {if (event.key === 'Enter') void saveTitle(); if (event.key === 'Escape') setEditingTitle(false)}}/><button disabled={busy} onClick={() => void saveTitle()} className="btn btn-primary">Сохранить</button><button disabled={busy} onClick={() => setEditingTitle(false)} className="btn btn-secondary">Отмена</button></div> : <h1 className="page-title" style={{fontSize:'clamp(28px,4vw,38px)',overflowWrap:'anywhere'}}>{order.title}</h1>}</div><div className="order-actions">{order.status === 'received' && <button disabled={busy} onClick={() => setStatus('ordered')} className="btn btn-primary"><Icon name="check" size={17}/>Заказано</button>}{order.status === 'ordered' && <button disabled={busy} onClick={() => setStatus('completed')} className="btn btn-primary"><Icon name="check" size={17}/>Завершено</button>}<button disabled={busy || editingTitle} onClick={startTitleEdit} className="btn btn-secondary"><Icon name="edit" size={16}/>Название</button><button disabled={busy} onClick={() => void deleteOrder()} className="btn btn-secondary danger"><Icon name="trash" size={16}/>Удалить</button></div></div>
    {error && <p role="alert" className="notice">{error}</p>}
    <section className="panel panel-padding">
      <div className="flex items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><Icon name="link" size={21}/></span><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">{order.status === 'draft' ? 'Поделитесь подборкой' : 'Ссылка для клиента'}</h2><p className="mt-1 text-xs leading-5 text-neutral-500">{order.status === 'draft' ? 'Клиент откроет её без регистрации и выберет количество.' : 'Одна ссылка. Все товары этого заказа.'}</p></div></div>
      {order.status === 'draft' ? <button onClick={generateLink} disabled={busy || !products.length} className="btn btn-primary mt-5 w-full sm:w-auto">{busy ? 'Готовим ссылку…' : 'Создать ссылку'}<Icon name="arrow" size={16}/></button> : <><input aria-label="Публичная ссылка" readOnly value={publicLink} onFocus={e => e.target.select()} className="mt-5 h-11 w-full rounded-xl bg-neutral-50 px-3 text-xs text-neutral-500"/><div className="mt-3 flex flex-wrap gap-2"><button onClick={shareOrder} className="btn btn-primary"><Icon name="share" size={17}/>Поделиться</button><button onClick={copyLink} className="btn btn-secondary"><Icon name={copied ? 'check' : 'copy'} size={16}/>{copied ? 'Скопировано ✓' : 'Копировать'}</button></div></>}
    </section>
    <section className="summary-strip"><div className="summary-item"><span>Товаров</span><strong>{products.length}</strong></div><div className="summary-item"><span>За 1 шт. каждого</span><strong style={{fontSize:22}}>{products.every(p => p.price != null) ? formatSomoni(productsTotal) : '—'}</strong></div><div className="summary-item"><span>Клиент выбрал</span><strong style={{fontSize:22}}>{submission ? `${submission.total_quantity} шт.` : '—'}</strong></div></section>
    {submission && <section className="panel panel-padding"><div className="flex items-start justify-between gap-3"><div><span className="status-badge status-completed">Получен</span><h2 className="mt-3 text-xl font-semibold tracking-tight">Выбор клиента</h2><p className="mt-2 text-xs text-neutral-500">{formatDate(submission.confirmed_at)}</p></div><span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50 text-green-600"><Icon name="check"/></span></div><div className="mt-5 divide-y divide-neutral-100">{submission.items.map(item => <div key={item.id} className="flex items-center justify-between gap-4 py-4 text-sm"><div><div>{item.product_name}</div>{item.price != null && <div className="mt-1 text-xs text-neutral-500">{formatSomoni(item.price)} за шт.</div>}</div><span className="shrink-0 font-semibold">× {item.quantity}</span></div>)}</div><div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-5"><span className="text-sm text-neutral-500">Всего {submission.total_quantity} шт.</span>{submission.items.every(item => item.price != null) && <strong className="text-2xl font-semibold tracking-tight">{formatSomoni(submissionTotal)}</strong>}</div></section>}
    <div className="flex items-center justify-between"><h2 className="text-xl font-semibold tracking-tight">Товары подборки</h2><span className="order-id">{products.length} позиций</span></div>
    {order.status !== 'draft' && <p className="text-xs text-neutral-500">Заказ опубликован: состав и цены зафиксированы.</p>}
    <div className="space-y-4">{products.map(product => <article key={product.id} className="panel product-editor"><div className="product-editor-body">
      {imageUrls[product.id] ? <Image unoptimized width={400} height={400} src={imageUrls[product.id]} alt={product.name} className="product-preview"/> : <div className="product-preview flex items-center justify-center text-neutral-300"><Icon name="photo" size={32}/></div>}
      <div className="min-w-0">{editing === product.id ? <div><label className="field">Название товара<input aria-label="Название товара" maxLength={200} value={draft.name} onChange={e => setDraft(d => ({...d,name:e.target.value}))}/></label><PricingFields value={draft} onChange={patch => setDraft(d => ({...d,...patch}))}/>{draft.priceCny.trim() === '' && product.price != null && <p className="mt-2 text-xs text-neutral-500">Сохранится прежняя цена {formatSomoni(product.price)}. Укажите закупку, чтобы пересчитать.</p>}<label className="field mt-4">Ссылка поставщика<input aria-label="Ссылка поставщика" value={draft.supplier_url} onChange={e => setDraft(d => ({...d,supplier_url:e.target.value}))}/></label><div className="mt-4 flex gap-2"><button disabled={busy} onClick={() => saveProduct(product)} className="btn btn-primary">Сохранить</button><button disabled={busy} onClick={() => setEditing(null)} className="btn btn-secondary">Отмена</button></div></div> : <><h3 className="text-lg font-semibold tracking-tight break-words">{product.name}</h3><p className="mt-2 text-xl font-semibold tracking-tight">{product.price == null ? 'Без цены' : formatSomoni(product.price)}</p>{product.price_cny != null && <p className="mt-3 text-xs leading-5 text-neutral-500">Закупка ¥{product.price_cny}<br/>Доставка {formatSomoni(product.cargo_cost ?? calculateCargo(product.weight_grams ?? DEFAULT_WEIGHT_GRAMS))} · работа {formatSomoni(product.work_price_somoni ?? 0)}<br/>{product.weight_grams ?? DEFAULT_WEIGHT_GRAMS} г</p>}{safeSupplierUrl(product.supplier_url) && <a href={safeSupplierUrl(product.supplier_url)!} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-blue-600">Открыть поставщика ↗</a>}{order.status === 'draft' && <div className="mt-3 flex gap-2"><button onClick={() => startEditing(product)} className="text-button">Изменить</button><button disabled={busy} onClick={() => deleteProduct(product)} className="text-button danger">Удалить</button></div>}</>}</div>
    </div></article>)}</div>
  </div>
}
