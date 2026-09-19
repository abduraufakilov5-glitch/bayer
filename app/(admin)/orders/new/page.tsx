'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { CatalogProduct } from '@/lib/types'
import { calculateCargo, calculateClientPrice, DEFAULT_WEIGHT_GRAMS, formatSomoni } from '@/lib/pricing'

type DraftProduct = {
  id: string
  catalogProductId: string | null
  name: string
  priceCny: string
  workPrice: string
  weightGrams: string
  supplierUrl: string
  file: File | null
  preview: string
  fromCatalog: boolean
}

const emptyProduct = (): DraftProduct => ({
  id: crypto.randomUUID(),
  catalogProductId: null,
  name: '',
  priceCny: '',
  workPrice: '0',
  weightGrams: String(DEFAULT_WEIGHT_GRAMS),
  supplierUrl: '',
  file: null,
  preview: '',
  fromCatalog: false,
})

function fileNameToProductName(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Новый платок'
}

function calc(product: DraftProduct) {
  const cny = Number(product.priceCny)
  const work = Number(product.workPrice)
  const weight = Number(product.weightGrams)
  if (!Number.isFinite(cny) || cny < 0 || !Number.isFinite(work) || work < 0 || !Number.isFinite(weight) || weight <= 0) return null
  return {
    cargo: calculateCargo(weight),
    client: calculateClientPrice(cny, work, weight),
  }
}

export default function NewOrderPage() {
  const router = useRouter()
  const bulkInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [products, setProducts] = useState<DraftProduct[]>([emptyProduct()])
  const [catalog, setCatalog] = useState<CatalogProduct[]>([])
  const [catalogUrls, setCatalogUrls] = useState<Record<string, string>>({})
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveProgress, setSaveProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadCatalog() {
      const supabase = createClient()
      const { data } = await supabase.from('buyer_catalog_products').select('*').eq('active', true).order('created_at', { ascending: false })
      const rows = (data ?? []) as CatalogProduct[]
      setCatalog(rows)
      const urls: Record<string, string> = {}
      await Promise.all(rows.map(async (product) => {
        const { data: signed } = await supabase.storage.from('buyer-product-images').createSignedUrl(product.image_path, 3600)
        if (signed?.signedUrl) urls[product.id] = signed.signedUrl
      }))
      setCatalogUrls(urls)
    }
    void loadCatalog()
  }, [])

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter((item) => item.name.toLowerCase().includes(q))
  }, [catalog, catalogSearch])

  function update(id: string, patch: Partial<DraftProduct>) {
    setProducts((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  function addFromCatalog(product: CatalogProduct) {
    if (products.some((item) => item.catalogProductId === product.id)) {
      setError('Этот платок уже добавлен в заказ.')
      return
    }
    setProducts((items) => [...items, {
      id: crypto.randomUUID(),
      catalogProductId: product.id,
      name: product.name,
      priceCny: String(product.price_cny),
      workPrice: String(product.work_price_somoni),
      weightGrams: String(product.weight_grams),
      supplierUrl: product.supplier_url ?? '',
      file: null,
      preview: catalogUrls[product.id] ?? '',
      fromCatalog: true,
    }])
    setError('')
    setCatalogOpen(false)
  }

  function onFile(id: string, file: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Фото должно быть изображением.'); return }
    if (file.size > 8 * 1024 * 1024) { setError('Максимальный размер одного фото — 8 МБ.'); return }
    update(id, { file, preview: URL.createObjectURL(file), fromCatalog: false, catalogProductId: null })
    setError('')
  }

  function onBulkFiles(fileList: FileList | null) {
    if (!fileList?.length) return

    const files = Array.from(fileList)
    if (files.length > 30) {
      setError('За один раз можно выбрать максимум 30 фото.')
      if (bulkInputRef.current) bulkInputRef.current.value = ''
      return
    }

    const invalidType = files.find((file) => !file.type.startsWith('image/'))
    if (invalidType) {
      setError('Все выбранные файлы должны быть изображениями.')
      if (bulkInputRef.current) bulkInputRef.current.value = ''
      return
    }

    const tooLarge = files.find((file) => file.size > 8 * 1024 * 1024)
    if (tooLarge) {
      setError('Фото «' + tooLarge.name + '» больше 8 МБ. Каждый файл должен быть не больше 8 МБ.')
      if (bulkInputRef.current) bulkInputRef.current.value = ''
      return
    }

    const batch = files.map((file) => ({
      id: crypto.randomUUID(),
      catalogProductId: null,
      name: fileNameToProductName(file.name),
      priceCny: '',
      workPrice: '0',
      weightGrams: String(DEFAULT_WEIGHT_GRAMS),
      supplierUrl: '',
      file,
      preview: URL.createObjectURL(file),
      fromCatalog: false,
    }))

    setProducts((current) => {
      const isEmptyPlaceholder = current.length === 1 && !current[0].file && !current[0].catalogProductId && !current[0].name.trim()
      return isEmptyPlaceholder ? batch : [...current, ...batch]
    })
    setCatalogOpen(false)
    setError('')
    if (bulkInputRef.current) bulkInputRef.current.value = ''
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const valid = title.trim() && products.length > 0 && products.every((p) => p.name.trim() && (p.file || p.catalogProductId))
    if (!valid) { setError('Укажите название заказа и добавьте фото или сохранённый товар для каждого платка.'); return }
    if (products.some((p) => {
      const cny = Number(p.priceCny), work = Number(p.workPrice), weight = Number(p.weightGrams)
      return !Number.isFinite(cny) || cny < 0 || !Number.isFinite(work) || work < 0 || !Number.isFinite(weight) || weight <= 0
    })) {
      setError('Проверьте цену в юанях, работу и вес.')
      return
    }

    setSaving(true)
    setSaveProgress({ done: 0, total: products.length })
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/login'); setSaving(false); return }

    const { data: order, error: orderError } = await supabase.from('buyer_orders').insert({ owner_id: user.id, title: title.trim() }).select('id').single()
    if (orderError || !order) {
      setError(orderError?.message || 'Не удалось создать заказ.')
      setSaving(false)
      setSaveProgress({ done: 0, total: 0 })
      return
    }

    let completed = 0
    const processProduct = async (product: DraftProduct, index: number) => {
      let imagePath = ''
      let catalogProductId = product.catalogProductId
      const cny = Number(product.priceCny)
      const work = Number(product.workPrice)
      const weight = Number(product.weightGrams)
      const cargo = calculateCargo(weight)
      const clientPrice = calculateClientPrice(cny, work, weight)

      if (product.catalogProductId) {
        const catalogProduct = catalog.find((item) => item.id === product.catalogProductId)
        imagePath = catalogProduct?.image_path ?? ''
        if (!imagePath) throw new Error('Не найдено фото сохранённого товара «' + product.name + '».')
      } else {
        const file = product.file as File
        const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
        imagePath = user.id + '/' + crypto.randomUUID() + '.' + extension

        const { error: uploadError } = await supabase.storage.from('buyer-product-images').upload(imagePath, file, {
          contentType: file.type,
          upsert: false,
        })
        if (uploadError) throw new Error('Не удалось загрузить фото «' + product.name + '». ' + uploadError.message)

        const { data: catalogRow, error: catalogError } = await supabase.from('buyer_catalog_products').insert({
          owner_id: user.id,
          name: product.name.trim(),
          price_cny: cny,
          work_price_somoni: work,
          weight_grams: weight,
          supplier_url: product.supplierUrl.trim() || null,
          image_path: imagePath,
        }).select('id').single()
        if (catalogError || !catalogRow) throw new Error('Фото загрузилось, но не удалось сохранить платок в каталог.')
        catalogProductId = catalogRow.id
      }

      const { error: productError } = await supabase.from('buyer_products').insert({
        order_id: order.id,
        catalog_product_id: catalogProductId,
        name: product.name.trim(),
        price: clientPrice,
        price_cny: cny,
        cargo_cost: cargo,
        work_price_somoni: work,
        weight_grams: weight,
        supplier_url: product.supplierUrl.trim() || null,
        image_path: imagePath,
        sort_order: index,
      })
      if (productError) throw new Error('Не удалось сохранить товар «' + product.name + '». ' + productError.message)

      completed += 1
      setSaveProgress({ done: completed, total: products.length })
    }

    try {
      // Upload several photos in parallel so 20–30 files do not wait on each other.
      const batchSize = 5
      for (let start = 0; start < products.length; start += batchSize) {
        const batch = products.slice(start, start + batchSize)
        await Promise.all(batch.map((product, offset) => processProduct(product, start + offset)))
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить заказ.')
      setSaving(false)
      return
    }

    router.push('/orders/' + order.id)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-neutral-500">Новый заказ</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Соберите закупку</h1>
          <p className="mt-1 text-sm text-neutral-500">Можно выбрать сразу до 30 фото.</p>
        </div>
        <div className="hidden rounded-2xl bg-white/70 px-3 py-2 text-right text-xs text-neutral-500 shadow-sm ring-1 ring-black/5 sm:block">
          <div>¥ → сомони</div><strong className="text-neutral-900">1 ¥ = 1.4 смн</strong>
        </div>
      </div>

      <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.05)] ring-1 ring-black/5">
        <label className="text-sm font-medium">Название заказа</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: Осенняя закупка" required className="mt-2 h-13 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 outline-none transition focus:border-black focus:bg-white" />
      </section>

      <section className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.05)] ring-1 ring-black/5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" onClick={() => setCatalogOpen((value) => !value)} className="flex items-center justify-between text-left">
            <div>
              <p className="text-sm font-medium text-neutral-500">Сохранённые платки</p>
              <h2 className="mt-0.5 text-lg font-semibold">Выбрать из каталога</h2>
            </div>
            <span className="ml-4 rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium">{catalog.length} шт. {catalogOpen ? '⌃' : '⌄'}</span>
          </button>

          <div className="relative">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-black px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-black/10 transition active:scale-[0.99]">
              <span>＋ Массовая загрузка</span>
              <input
                ref={bulkInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => onBulkFiles(event.target.files)}
                className="sr-only"
              />
            </label>
            <p className="mt-1 text-center text-[11px] text-neutral-400">до 30 фото · максимум 8 МБ каждое</p>
          </div>
        </div>

        {catalogOpen && (
          <div className="mt-4">
            {catalog.length > 0 && (
              <input value={catalogSearch} onChange={(e) => setCatalogSearch(e.target.value)} placeholder="Поиск по каталогу…" className="mb-3 h-11 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 text-sm outline-none focus:border-black" />
            )}
            {filteredCatalog.length === 0 ? (
              <div className="rounded-2xl bg-neutral-50 p-5 text-sm text-neutral-500">Каталог пока пуст. Первый новый платок ниже автоматически сохранится.</div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {filteredCatalog.map((item) => (
                  <button key={item.id} type="button" onClick={() => addFromCatalog(item)} className="overflow-hidden rounded-2xl bg-neutral-50 text-left ring-1 ring-black/5 transition hover:ring-black/15 active:scale-[0.99]">
                    <div className="aspect-square bg-neutral-100">
                      {catalogUrls[item.id] && <img src={catalogUrls[item.id]} alt="" className="h-full w-full object-cover" />}
                    </div>
                    <div className="p-3">
                      <div className="truncate text-sm font-medium">{item.name}</div>
                      <div className="mt-1 text-xs text-neutral-500">{formatSomoni(calculateClientPrice(item.price_cny, item.work_price_somoni, item.weight_grams))}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        {products.map((product, index) => {
          const totals = calc(product)
          return (
            <article key={product.id} className="rounded-[28px] bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.05)] ring-1 ring-black/5 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black text-xs font-semibold text-white">{index + 1}</span>
                  <span className="text-sm font-semibold">Платок</span>
                  {product.fromCatalog && <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700">из каталога</span>}
                </div>
                {products.length > 1 && <button type="button" onClick={() => setProducts((items) => items.filter((x) => x.id !== product.id))} className="text-xs font-medium text-red-600">Удалить</button>}
              </div>

              <div className="grid gap-5 sm:grid-cols-[145px_1fr]">
                <label className={"relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-2xl bg-neutral-100 " + (product.fromCatalog ? 'cursor-default' : '')}>
                  {product.preview ? <img src={product.preview} alt="" className="h-full w-full object-cover" /> : <div className="text-center"><div className="text-2xl">＋</div><span className="text-xs text-neutral-500">Добавить фото</span></div>}
                  {!product.fromCatalog && <input type="file" accept="image/*" onChange={(e) => onFile(product.id, e.target.files?.[0] || null)} className="sr-only" />}
                </label>
                <div className="space-y-3">
                  <input value={product.name} onChange={(e) => update(product.id, { name: e.target.value })} placeholder="Название / модель" className="h-12 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 outline-none focus:border-black focus:bg-white" />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-400">Закупка, ¥</span>
                      <input value={product.priceCny} onChange={(e) => update(product.id, { priceCny: e.target.value })} inputMode="decimal" placeholder="35" className="h-12 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 outline-none focus:border-black focus:bg-white" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-400">Моя работа, смн</span>
                      <input value={product.workPrice} onChange={(e) => update(product.id, { workPrice: e.target.value })} inputMode="decimal" placeholder="5" className="h-12 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 outline-none focus:border-black focus:bg-white" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-400">Вес, г</span>
                      <input value={product.weightGrams} onChange={(e) => update(product.id, { weightGrams: e.target.value })} inputMode="numeric" placeholder="80" className="h-12 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 outline-none focus:border-black focus:bg-white" />
                    </label>
                  </div>
                  <input value={product.supplierUrl} onChange={(e) => update(product.id, { supplierUrl: e.target.value })} type="url" placeholder="Ссылка поставщика (опционально)" className="h-12 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 text-sm outline-none focus:border-black focus:bg-white" />

                  {totals ? (
                    <div className="rounded-2xl bg-neutral-950 p-4 text-white">
                      <div className="grid grid-cols-3 gap-3 text-xs text-white/60">
                        <div>Юань<div className="mt-1 text-sm font-semibold text-white">{formatSomoni(Number(product.priceCny) * 1.4)}</div></div>
                        <div>Карго<div className="mt-1 text-sm font-semibold text-white">{formatSomoni(totals.cargo)}</div></div>
                        <div>Работа<div className="mt-1 text-sm font-semibold text-white">{formatSomoni(Number(product.workPrice))}</div></div>
                      </div>
                      <div className="mt-3 border-t border-white/10 pt-3">
                        <div className="text-xs text-white/60">Цена для клиента</div>
                        <div className="mt-0.5 text-2xl font-semibold">{formatSomoni(totals.client)}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-700">Введите цену, работу и вес — итог посчитается автоматически.</div>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </section>

      <button type="button" onClick={() => setProducts((items) => [...items, emptyProduct()])} className="w-full rounded-2xl border border-dashed border-neutral-300 bg-white py-3.5 text-sm font-medium shadow-sm transition hover:border-neutral-500">＋ Новый платок вручную</button>
      {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className="sticky bottom-3 z-10">
        <button disabled={saving} className="h-14 w-full rounded-2xl bg-black text-sm font-semibold text-white shadow-xl shadow-black/10 transition active:scale-[0.995] disabled:opacity-50">{saving ? `Сохраняем… ${saveProgress.done}/${saveProgress.total}` : 'Создать заказ'}</button>
      </div>
    </form>
  )
}
