'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type DraftProduct = { id: string; name: string; price: string; supplierUrl: string; file: File | null; preview: string }
const emptyProduct = (): DraftProduct => ({ id: crypto.randomUUID(), name: '', price: '', supplierUrl: '', file: null, preview: '' })

export default function NewOrderPage() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [products, setProducts] = useState<DraftProduct[]>([emptyProduct()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function update(id: string, patch: Partial<DraftProduct>) {
    setProducts((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  function onFile(id: string, file: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Фото должно быть изображением.'); return }
    if (file.size > 8 * 1024 * 1024) { setError('Максимальный размер фото — 8 МБ.'); return }
    update(id, { file, preview: URL.createObjectURL(file) })
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const valid = title.trim() && products.every((p) => p.name.trim() && p.file)
    if (!valid) { setError('Укажите название заказа и добавьте фото для каждого товара.'); return }

    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/login'); return }

    const { data: order, error: orderError } = await supabase.from('orders').insert({ owner_id: user.id, title: title.trim() }).select('id').single()
    if (orderError || !order) { setError(orderError?.message || 'Не удалось создать заказ.'); setSaving(false); return }

    for (const [index, product] of products.entries()) {
      const file = product.file as File
      const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = user.id + '/' + crypto.randomUUID() + '.' + extension
      const { error: uploadError } = await supabase.storage.from('product-images').upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) { setError('Не удалось загрузить фото «' + product.name + '». ' + uploadError.message); setSaving(false); return }

      const { error: productError } = await supabase.from('products').insert({
        order_id: order.id,
        name: product.name.trim(),
        price: product.price.trim() ? Number(product.price) : null,
        supplier_url: product.supplierUrl.trim() || null,
        image_path: path,
        sort_order: index,
      })
      if (productError) { setError('Не удалось сохранить товар «' + product.name + '». ' + productError.message); setSaving(false); return }
    }

    router.push('/orders/' + order.id)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-sm text-neutral-500">Новый заказ</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Соберите товары</h1>
      </div>

      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <label className="text-sm font-medium">Название заказа</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: Осенняя закупка" required className="mt-2 h-12 w-full rounded-2xl border border-neutral-200 px-4 outline-none focus:border-black" />
      </section>

      <section className="space-y-3">
        {products.map((product, index) => (
          <div key={product.id} className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold">Товар {index + 1}</div>
              {products.length > 1 && <button type="button" onClick={() => setProducts((items) => items.filter((x) => x.id !== product.id))} className="text-xs text-red-600">Удалить</button>}
            </div>

            <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
              <label className="relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-2xl bg-neutral-100">
                {product.preview ? <img src={product.preview} alt="" className="h-full w-full object-cover" /> : <span className="text-center text-xs text-neutral-500">Добавить фото</span>}
                <input type="file" accept="image/*" onChange={(e) => onFile(product.id, e.target.files?.[0] || null)} className="sr-only" />
              </label>
              <div className="space-y-3">
                <input value={product.name} onChange={(e) => update(product.id, { name: e.target.value })} placeholder="Название товара" className="h-12 w-full rounded-2xl border border-neutral-200 px-4 outline-none focus:border-black" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <input value={product.price} onChange={(e) => update(product.id, { price: e.target.value })} inputMode="decimal" placeholder="Цена (опционально)" className="h-12 rounded-2xl border border-neutral-200 px-4 outline-none focus:border-black" />
                  <input value={product.supplierUrl} onChange={(e) => update(product.id, { supplierUrl: e.target.value })} type="url" placeholder="Ссылка поставщика" className="h-12 rounded-2xl border border-neutral-200 px-4 outline-none focus:border-black" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </section>

      <button type="button" onClick={() => setProducts((items) => [...items, emptyProduct()])} className="w-full rounded-2xl border border-dashed border-neutral-300 bg-white py-3.5 text-sm font-medium">+ Добавить товар</button>
      {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <button disabled={saving} className="h-13 w-full rounded-2xl bg-black text-sm font-medium text-white disabled:opacity-50">{saving ? 'Создаём…' : 'Создать заказ'}</button>
    </form>
  )
}
