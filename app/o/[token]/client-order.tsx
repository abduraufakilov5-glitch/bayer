'use client'

import { useMemo, useState } from 'react'
import type { PublicProduct } from '@/lib/types'

type Props = { endpoint: string; token: string; title: string; orderNumber: number; products: PublicProduct[] }

export default function ClientOrder({ endpoint, token, title, orderNumber, products }: Props) {
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const total = useMemo(() => Object.values(quantities).reduce((sum, n) => sum + n, 0), [quantities])

  function setQty(id: string, quantity: number) {
    setQuantities((current) => ({ ...current, [id]: Math.max(0, Math.min(99, quantity)) }))
  }

  async function submit() {
    setSending(true); setError('')
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, items: Object.entries(quantities).map(([product_id, quantity]) => ({ product_id, quantity })).filter((item) => item.quantity > 0) }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Не удалось отправить заказ')
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
      setSending(false)
      return
    }
    setSending(false)
    setConfirming(false)
  }

  if (sent) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-3xl text-emerald-600">✓</div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">Заказ отправлен</h1>
          <p className="mt-2 text-sm text-neutral-500">Байер получил ваш выбор.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-dvh pb-28">
      <header className="mx-auto max-w-xl px-4 pb-4 pt-6 sm:px-5">
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>Заказ #{String(orderNumber).padStart(5, '0')}</span>
          <span>{total} шт.</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
      </header>

      <div className="mx-auto grid max-w-xl gap-4 px-4 sm:grid-cols-2 sm:px-5">
        {products.map((product) => {
          const quantity = quantities[product.id] ?? 0
          return (
            <article key={product.id} className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
              <div className="aspect-[4/5] overflow-hidden bg-neutral-100">
                <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
              </div>
              <div className="p-4">
                <div className="font-medium">{product.name}</div>
                {product.price != null && <div className="mt-1 text-sm text-neutral-500">{product.price}</div>}
                <div className="mt-4 flex items-center justify-between rounded-2xl bg-neutral-50 p-1">
                  <button type="button" aria-label="Уменьшить" onClick={() => setQty(product.id, quantity - 1)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-xl shadow-sm">−</button>
                  <span className="min-w-10 text-center font-semibold">{quantity}</span>
                  <button type="button" aria-label="Увеличить" onClick={() => setQty(product.id, quantity + 1)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-black text-xl text-white">+</button>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {error && <div className="mx-auto mt-4 max-w-xl px-4 text-center text-sm text-red-600">{error}</div>}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200/80 bg-[#f7f7f5]/95 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-xl">
          <button disabled={total === 0} onClick={() => setConfirming(true)} className="h-13 w-full rounded-2xl bg-black text-sm font-semibold text-white disabled:bg-neutral-300">Готово {total > 0 ? '· ' + total + ' шт.' : ''}</button>
        </div>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">
            <h2 className="text-xl font-semibold">Подтвердить заказ?</h2>
            <p className="mt-2 text-sm text-neutral-500">Будет отправлено всего товаров: {total} шт.</p>
            <div className="mt-5 grid gap-2">
              <button disabled={sending} onClick={submit} className="h-12 rounded-2xl bg-black font-medium text-white disabled:opacity-50">{sending ? 'Отправляем…' : 'Подтвердить заказ'}</button>
              <button disabled={sending} onClick={() => setConfirming(false)} className="h-12 rounded-2xl bg-neutral-100 font-medium text-neutral-800">Назад</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
