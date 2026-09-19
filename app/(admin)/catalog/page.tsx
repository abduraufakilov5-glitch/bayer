'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CatalogProduct } from '@/lib/types'
import { calculateCargo, calculateClientPrice, DEFAULT_WEIGHT_GRAMS, formatSomoni } from '@/lib/pricing'

type Draft = { name: string; price_cny: string; work_price_somoni: string; weight_grams: string; supplier_url: string }

export default function CatalogPage() {
  const [items, setItems] = useState<CatalogProduct[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ name: '', price_cny: '', work_price_somoni: '0', weight_grams: String(DEFAULT_WEIGHT_GRAMS), supplier_url: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const supabase = createClient()
    const { data, error: loadError } = await supabase.from('buyer_catalog_products').select('*').order('created_at', { ascending: false })
    if (loadError) { setError(loadError.message); return }
    const rows = (data ?? []) as CatalogProduct[]
    setItems(rows)
    const signed: Record<string, string> = {}
    await Promise.all(rows.map(async (item) => {
      const { data: file } = await supabase.storage.from('buyer-product-images').createSignedUrl(item.image_path, 3600)
      if (file?.signedUrl) signed[item.id] = file.signedUrl
    }))
    setUrls(signed)
  }

  useEffect(() => { void load() }, [])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => item.active === !showArchived && (!q || item.name.toLowerCase().includes(q)))
  }, [items, search, showArchived])

  function startEdit(item: CatalogProduct) {
    setEditing(item.id)
    setDraft({
      name: item.name,
      price_cny: String(item.price_cny),
      work_price_somoni: String(item.work_price_somoni),
      weight_grams: String(item.weight_grams),
      supplier_url: item.supplier_url ?? '',
    })
    setError('')
  }

  async function saveEdit(item: CatalogProduct) {
    const cny = Number(draft.price_cny)
    const work = Number(draft.work_price_somoni)
    const weight = Number(draft.weight_grams)
    if (!draft.name.trim() || !Number.isFinite(cny) || cny < 0 || !Number.isFinite(work) || work < 0 || !Number.isFinite(weight) || weight <= 0) {
      setError('Проверьте название, цену, работу и вес.')
      return
    }
    setSaving(true); setError('')
    const supabase = createClient()
    const { error: updateError } = await supabase.from('buyer_catalog_products').update({
      name: draft.name.trim(),
      price_cny: cny,
      work_price_somoni: work,
      weight_grams: weight,
      supplier_url: draft.supplier_url.trim() || null,
    }).eq('id', item.id)
    if (updateError) setError(updateError.message)
    else { setEditing(null); await load() }
    setSaving(false)
  }

  async function toggleActive(item: CatalogProduct) {
    const supabase = createClient()
    const { error: updateError } = await supabase.from('buyer_catalog_products').update({ active: !item.active }).eq('id', item.id)
    if (updateError) setError(updateError.message)
    else await load()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/dashboard" className="text-sm text-neutral-500">← Заказы</Link>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Каталог</h1>
          <p className="mt-1 text-sm text-neutral-500">Платки, которые уже были добавлены. Повторно фото загружать не нужно.</p>
        </div>
        <Link href="/orders/new" className="inline-flex justify-center rounded-2xl bg-black px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-black/10">＋ Новый заказ</Link>
      </div>

      <section className="rounded-[28px] bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.05)] ring-1 ring-black/5">
        <div className="flex gap-2 rounded-2xl bg-neutral-100 p-1">
          <button onClick={() => setShowArchived(false)} className={"flex-1 rounded-xl px-3 py-2.5 text-sm font-medium " + (!showArchived ? 'bg-white shadow-sm' : 'text-neutral-500')}>Активные · {items.filter((x) => x.active).length}</button>
          <button onClick={() => setShowArchived(true)} className={"flex-1 rounded-xl px-3 py-2.5 text-sm font-medium " + (showArchived ? 'bg-white shadow-sm' : 'text-neutral-500')}>Скрытые · {items.filter((x) => !x.active).length}</button>
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск платка…" className="mt-3 h-12 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 outline-none focus:border-black focus:bg-white" />
      </section>

      {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {visible.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-neutral-300 bg-white p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-2xl">▱</div>
          <h2 className="mt-4 font-semibold">{showArchived ? 'Нет скрытых платков' : 'Каталог пока пуст'}</h2>
          <p className="mt-1 text-sm text-neutral-500">Добавь первый новый платок при создании заказа.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((item) => {
            const finalPrice = calculateClientPrice(item.price_cny, item.work_price_somoni, item.weight_grams)
            return (
              <article key={item.id} className="overflow-hidden rounded-[24px] bg-white shadow-[0_8px_30px_rgba(0,0,0,0.05)] ring-1 ring-black/5">
                <div className="aspect-square bg-neutral-100">
                  {urls[item.id] && <img src={urls[item.id]} alt={item.name} className="h-full w-full object-cover" />}
                </div>
                <div className="p-3.5">
                  {editing === item.id ? (
                    <div className="space-y-2">
                      <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className="h-10 w-full rounded-xl border border-neutral-200 px-2.5 text-sm" />
                      <input value={draft.price_cny} onChange={(e) => setDraft((d) => ({ ...d, price_cny: e.target.value }))} inputMode="decimal" placeholder="¥" className="h-10 w-full rounded-xl border border-neutral-200 px-2.5 text-sm" />
                      <input value={draft.work_price_somoni} onChange={(e) => setDraft((d) => ({ ...d, work_price_somoni: e.target.value }))} inputMode="decimal" placeholder="Работа, смн" className="h-10 w-full rounded-xl border border-neutral-200 px-2.5 text-sm" />
                      <input value={draft.weight_grams} onChange={(e) => setDraft((d) => ({ ...d, weight_grams: e.target.value }))} inputMode="numeric" placeholder="Вес, г" className="h-10 w-full rounded-xl border border-neutral-200 px-2.5 text-sm" />
                      <div className="flex gap-2">
                        <button disabled={saving} onClick={() => saveEdit(item)} className="flex-1 rounded-xl bg-black px-2 py-2 text-xs font-medium text-white">Сохранить</button>
                        <button disabled={saving} onClick={() => setEditing(null)} className="rounded-xl bg-neutral-100 px-3 py-2 text-xs font-medium">Отмена</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="truncate font-medium">{item.name}</div>
                      <div className="mt-1 text-sm font-semibold">{formatSomoni(finalPrice)}</div>
                      <div className="mt-1 text-[11px] text-neutral-500">¥{item.price_cny} · карго {formatSomoni(calculateCargo(item.weight_grams))} · работа {formatSomoni(item.work_price_somoni)}</div>
                      <div className="mt-3 flex items-center gap-2 text-xs">
                        <button onClick={() => startEdit(item)} className="rounded-xl bg-neutral-100 px-3 py-2 font-medium">Изменить</button>
                        <button onClick={() => toggleActive(item)} className="rounded-xl bg-neutral-100 px-3 py-2 font-medium">{item.active ? 'Скрыть' : 'Вернуть'}</button>
                      </div>
                    </>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
