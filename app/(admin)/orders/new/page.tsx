'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { parseDecimal, validPricing, safeSupplierUrl, MAX_ORDER_PRODUCTS } from '@/lib/validation'
import { createClient } from '@/lib/supabase/client'
import { calculateCargo, calculateClientPrice, DEFAULT_WEIGHT_GRAMS, formatSomoni } from '@/lib/pricing'
import { PricingFields, type PricingDraft } from '@/app/components/pricing-fields'
import { Icon } from '@/app/components/icons'
import type { CatalogProduct } from '@/lib/types'
import { signProductImages, type ImageCache } from '@/lib/product-images'

type DraftProduct = PricingDraft & { id: string; name: string; supplierUrl: string; file: File | null; preview: string; catalogProductId: string | null; imagePath: string | null }

export default function NewOrderPage() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [products, setProducts] = useState<DraftProduct[]>([])
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [defaults, setDefaults] = useState({workPrice:'0', weightGrams:String(DEFAULT_WEIGHT_GRAMS)})
  const [bulkNotice, setBulkNotice] = useState(false)
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [catalogUrls, setCatalogUrls] = useState<Record<string,string>>({})
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(true)
  const imageCache = useRef<ImageCache>(new Map())
  const previousPricing = useRef<DraftProduct[]>([])
  function applyDefaults() {
    if (!validPricing('Товар',0,parseDecimal(defaults.workPrice),Number(defaults.weightGrams))) {setError('Проверьте общие параметры: работа от 0 до 1 000 000, вес от 1 до 5000 г.');return}
    previousPricing.current = products
    setProducts(items => items.map(item => ({...item,...defaults})))
    setBulkNotice(true);setError('')
  }
  const savingRef = useRef(false)
  const previews = useRef(new Set<string>())
  useEffect(() => { const urls = previews.current; return () => urls.forEach(url => URL.revokeObjectURL(url)) }, [])

  function addPhotos(files: FileList | null) {
    if (!files || savingRef.current) return
    const batch = Array.from(files)
    if (batch.length > 30 || products.length + batch.length > MAX_ORDER_PRODUCTS) { setError('До 30 фото за раз и до 300 товаров в заказе.'); return }
    if (batch.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024)) { setError('Выберите JPG, PNG или WebP, не больше 8 МБ на фото.'); return }
    setProducts(current => [...current, ...batch.map(file => {
      const preview = URL.createObjectURL(file); previews.current.add(preview)
      return { id: crypto.randomUUID(), name: file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 200), priceCny: '', ...defaults, supplierUrl: '', file, preview, catalogProductId:null, imagePath:null }
    })])
    setError('')
  }
  function update(id: string, patch: Partial<DraftProduct>) { setProducts(items => items.map(item => item.id === id ? {...item, ...patch} : item)) }

  useEffect(() => {
    async function loadCatalog() {
      const supabase = createClient()
      const {data, error: loadError} = await supabase.from('buyer_catalog_products').select('*').eq('active',true).order('created_at',{ascending:false})
      if (loadError) {setError('Не удалось загрузить каталог. Обновите страницу.');return}
      const rows = (data ?? []) as CatalogProduct[]
      setCatalog(rows)
      try {setCatalogUrls(await signProductImages(supabase,rows,imageCache.current))}
      catch {setError('Каталог загрузился без фотографий. Обновите страницу.')}
    }
    void loadCatalog()
  }, [])

  const filteredCatalog = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase()
    return query ? catalog.filter(item => item.name.toLowerCase().includes(query)) : catalog
  },[catalog,catalogSearch])

  function addFromCatalog(item: CatalogProduct) {
    if (savingRef.current || products.length >= MAX_ORDER_PRODUCTS) return
    if (products.some(product => product.catalogProductId === item.id)) {setError('Этот товар уже добавлен в заказ.');return}
    setProducts(current => [...current,{
      id:crypto.randomUUID(),name:item.name,priceCny:item.price_cny == null ? '' : String(item.price_cny),workPrice:String(item.work_price_somoni),weightGrams:String(item.weight_grams),supplierUrl:item.supplier_url ?? '',file:null,preview:catalogUrls[item.id] ?? '',catalogProductId:item.id,imagePath:item.image_path,
    }])
    setCatalogOpen(false);setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (savingRef.current) return
    if (!title.trim() || !products.length || products.some(p => !p.name.trim() || (!p.file && !p.imagePath) || !validPricing(p.name, p.priceCny.trim() ? parseDecimal(p.priceCny) : 0, parseDecimal(p.workPrice), Number(p.weightGrams)) || (p.supplierUrl.trim() && !safeSupplierUrl(p.supplierUrl)))) { setError('Добавьте фото и названия товаров. Проверьте цену и ссылку поставщика.'); return }
    savingRef.current = true; setSaving(true); setError(''); setProgress(0)
    const supabase = createClient()
    let orderId: string | undefined
    const paths: string[] = []
    const catalogIds: string[] = []
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) { router.replace('/login'); return }
      const {data: order, error: orderError} = await supabase.from('buyer_orders').insert({ owner_id: user.id, title: title.trim() }).select('id').single()
      if (orderError || !order) throw new Error('Не удалось создать заказ.')
      orderId = order.id
      let done = 0
      for (let start = 0; start < products.length; start += 5) {
        const results = await Promise.allSettled(products.slice(start, start + 5).map(async (product, offset) => {
          const priceCny = product.priceCny.trim() ? parseDecimal(product.priceCny) : null
          const work = parseDecimal(product.workPrice)
          const weight = Number(product.weightGrams)
          let path = product.imagePath
          let catalogProductId = product.catalogProductId
          if (product.file) {
            const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[product.file.type]!
            path = `${user.id}/${crypto.randomUUID()}.${ext}`
            const {error: uploadError} = await supabase.storage.from('buyer-product-images').upload(path, product.file, {contentType: product.file.type, upsert: false})
            if (uploadError) throw new Error('Не удалось загрузить фото «' + product.name + '».')
            paths.push(path)
            const {data: catalogRow,error: catalogError} = await supabase.from('buyer_catalog_products').insert({owner_id:user.id,name:product.name.trim(),price_cny:priceCny,work_price_somoni:work,weight_grams:weight,supplier_url:safeSupplierUrl(product.supplierUrl),image_path:path}).select('id').single()
            if (catalogError || !catalogRow) throw new Error('Не удалось добавить «' + product.name + '» в каталог.')
            catalogProductId = catalogRow.id
            catalogIds.push(catalogRow.id)
          }
          if (!path) throw new Error('Не найдено фото товара «' + product.name + '».')
          const {error: productError} = await supabase.from('buyer_products').insert({order_id: orderId, catalog_product_id:catalogProductId, name: product.name.trim(), price: priceCny == null ? null : calculateClientPrice(priceCny,work,weight), price_cny: priceCny, work_price_somoni:work, weight_grams:weight, cargo_cost:calculateCargo(weight), supplier_url: safeSupplierUrl(product.supplierUrl), image_path: path, sort_order: start + offset})
          if (productError) throw new Error('Не удалось сохранить товар «' + product.name + '».')
          setProgress(++done)
        }))
        const failed = results.find(result => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
      }
      router.push('/orders/' + orderId); router.refresh()
    } catch (cause) {
      let cleanupFailed = false
      if (orderId) {
        try {
          const {error: rollbackError} = await supabase.from('buyer_orders').delete().eq('id', orderId)
          cleanupFailed = !!rollbackError
          if (!rollbackError && catalogIds.length) {const {error} = await supabase.from('buyer_catalog_products').delete().in('id',catalogIds);cleanupFailed = !!error}
          if (!cleanupFailed && paths.length) { const {error} = await supabase.storage.from('buyer-product-images').remove(paths); cleanupFailed = !!error }
        } catch { cleanupFailed = true }
      }
      setError((cause instanceof Error ? cause.message : 'Нет подключения к серверу.') + (cleanupFailed ? ' Черновик или фото могли сохраниться. Проверьте список заказов.' : ' Изменения отменены, можно повторить.'))
    } finally { savingRef.current = false; setSaving(false) }
  }

  return <form onSubmit={submit} className="editor">
    <Link href="/dashboard" className="back-link"><Icon name="back" size={14}/>Все заказы</Link>
    <div className="editor-heading"><p className="eyebrow mb-3">Новая подборка</p><h1 className="page-title">Начнём с фотографий.</h1><p className="subtitle mt-3">Вы создаёте подборку. Клиент выбирает количество.</p></div>
    <fieldset disabled={saving} className="editor-stack">
      <section className="panel panel-padding"><label className="field">Название заказа<input aria-label="Название заказа" maxLength={140} required value={title} onChange={e => setTitle(e.target.value)} placeholder="Например: Подборка для Анны"/></label></section>
      <section className="panel panel-padding catalog-picker"><div className="flex items-center justify-between gap-4"><button type="button" className="min-w-0 text-left" onClick={() => setCatalogOpen(value => !value)} aria-expanded={catalogOpen}><span className="eyebrow">Сохранённые товары</span><h2 className="mt-1 text-lg font-semibold">Выбрать из каталога</h2></button><Link href="/catalog" className="text-button">Весь каталог · {catalog.length}</Link></div>{catalogOpen && <div className="mt-5"><div className="search-field"><Icon name="search" size={17}/><input aria-label="Поиск в каталоге" value={catalogSearch} onChange={event => setCatalogSearch(event.target.value)} placeholder="Найти товар"/></div>{filteredCatalog.length ? <div className="catalog-picker-grid mt-4">{filteredCatalog.map(item => <button key={item.id} type="button" className="catalog-pick-card" onClick={() => addFromCatalog(item)}><span className="catalog-pick-photo">{catalogUrls[item.id] ? <Image unoptimized width={240} height={240} src={catalogUrls[item.id]} alt={item.name}/> : <Icon name="photo" size={24}/>}</span><span className="catalog-pick-name">{item.name}</span><span className="catalog-pick-price">{item.price_cny == null ? 'Без цены' : formatSomoni(calculateClientPrice(item.price_cny,item.work_price_somoni,item.weight_grams))}</span></button>)}</div> : <p className="subtitle mt-4 text-sm">{catalogSearch ? 'Ничего не найдено.' : 'Каталог пока пуст. Новые фото сохранятся сюда автоматически.'}</p>}</div>}</section>
      <details className="panel panel-padding bulk-settings"><summary><Icon name="tune" size={18}/>Общие параметры товаров</summary><p className="subtitle mt-3 text-xs">Для новых фото. Уже добавленные товары изменятся только по кнопке.</p><div className="grid grid-cols-2 gap-3 mt-4"><label className="field">Работа, смн<input aria-label="Общая работа, смн" inputMode="decimal" value={defaults.workPrice} onChange={e => setDefaults(d => ({...d,workPrice:e.target.value}))}/></label><label className="field">Вес, г<input aria-label="Общий вес, г" inputMode="numeric" value={defaults.weightGrams} onChange={e => setDefaults(d => ({...d,weightGrams:e.target.value}))}/></label></div><button className="btn btn-secondary mt-4" type="button" disabled={!products.length} onClick={applyDefaults}>Применить ко всем</button>{bulkNotice && <p className="mt-3 text-xs text-blue-700" role="status">Параметры применены. <button type="button" className="underline" onClick={() => {setProducts(items => items.map(item => {const old = previousPricing.current.find(p => p.id === item.id);return old ? {...item,workPrice:old.workPrice,weightGrams:old.weightGrams} : item}));setBulkNotice(false)}}>Отменить</button></p>}</details>
      {products.map((product,index) => <article key={product.id} className="panel product-editor">
        <div className="product-editor-top"><span className="eyebrow">Товар {String(index+1).padStart(2,'0')}{product.catalogProductId ? ' · из каталога' : ''}</span><button type="button" className="text-button danger" onClick={() => {if (product.file) {URL.revokeObjectURL(product.preview);previews.current.delete(product.preview)}setProducts(items => items.filter(p => p.id !== product.id))}}>Удалить</button></div>
        <div className="product-editor-body"><Image unoptimized width={600} height={480} src={product.preview} alt={product.name || 'Фото товара'} className="product-preview"/><div><label className="field">Название товара<input aria-label="Название товара" required maxLength={200} value={product.name} onChange={e => update(product.id,{name:e.target.value})}/></label><PricingFields value={product} onChange={patch => update(product.id,patch)}/><label className="field mt-4">Ссылка поставщика <small>· необязательно</small><input aria-label="Ссылка поставщика" type="url" placeholder="https://" value={product.supplierUrl} onChange={e => update(product.id,{supplierUrl:e.target.value})}/></label></div></div>
      </article>)}
      <label className="upload-zone"><Icon name="photo" size={28}/><span><strong>Добавить фото товаров</strong><small>До 30 фото за раз · JPG, PNG, WebP · до 8 МБ</small></span><input aria-label="Фото товаров" type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={e => {addPhotos(e.target.files);e.target.value=''}}/></label>
      {error && <p role="alert" className="notice">{error}</p>}
      <div className="editor-footer"><span className="subtitle text-sm">{products.length ? `${products.length} товаров в подборке` : 'Добавьте первое фото'}</span><button disabled={saving || !products.length} className="btn btn-primary">{saving ? `Сохраняем ${progress} / ${products.length}…` : 'Создать заказ'}{!saving && <Icon name="arrow" size={16}/>}</button></div>
    </fieldset>
  </form>
}
