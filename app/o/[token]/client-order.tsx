'use client'

import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PublicProduct } from '@/lib/types'
import { formatSomoni as money, roundMoney } from '@/lib/pricing'
import { MAX_QUANTITY, restoreCart } from '@/lib/validation'

type Props = { endpoint: string; token: string; title: string; orderNumber: number; products: PublicProduct[] }

export default function ClientOrder({ endpoint, token, title, orderNumber, products }: Props) {
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [ready, setReady] = useState(false)
  const [restored, setRestored] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const submitting = useRef(false)
  const storageKey = `bayer:cart:v1:${token}`

  useEffect(() => {
    try {
      const cart = restoreCart(localStorage.getItem(storageKey), products.map(p => p.id))
      // Restore browser storage only after hydration to keep server markup stable.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuantities(cart)
      setRestored(Object.keys(cart).length > 0)
    } catch { /* Private browsing can block storage; ordering still works. */ }
    setReady(true)
  }, [storageKey, products])

  useEffect(() => {
    if (!ready || sent) return
    try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, quantities })) } catch { /* Optional persistence. */ }
  }, [ready, sent, storageKey, quantities])

  useEffect(() => {
    if (confirming) dialogRef.current?.showModal()
    else dialogRef.current?.close()
  }, [confirming])

  const selected = useMemo(() => products.filter(p => (quantities[p.id] ?? 0) > 0), [products, quantities])
  const total = selected.reduce((sum, p) => sum + quantities[p.id], 0)
  const totalAmount = roundMoney(selected.reduce((sum, p) => sum + quantities[p.id] * (p.price ?? 0), 0))
  const allPriced = selected.length > 0 && selected.every(p => p.price != null)

  function setQty(id: string, quantity: number) {
    if (!ready || sending || !Number.isInteger(quantity)) return
    setQuantities(current => ({ ...current, [id]: Math.max(0, Math.min(MAX_QUANTITY, quantity)) }))
  }

  async function submit() {
    if (submitting.current || total === 0) return
    submitting.current = true
    setSending(true); setError('')
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ token, items: selected.map(p => ({ product_id: p.id, quantity: quantities[p.id] })) }),
      })
      if (!response.ok) {
        if (response.status === 409) throw new Error('Заказ уже подтверждён или изменён. Обновите страницу, чтобы проверить его статус.')
        throw new Error('Не удалось отправить заказ. Ваш выбор сохранён — попробуйте снова.')
      }
      try { localStorage.removeItem(storageKey) } catch { /* Optional persistence. */ }
      setConfirming(false); setSent(true)
    } catch (e) {
      setError(e instanceof Error && e.name !== 'TimeoutError' && e.name !== 'TypeError' ? e.message : 'Нет ответа от сервера. Проверьте интернет и повторите отправку — дубликат заказа не создастся.')
    } finally { setSending(false); submitting.current = false }
  }

  if (sent) return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm rounded-[28px] bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-3xl text-emerald-600">✓</div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Заказ отправлен</h1>
        <p className="mt-2 text-sm text-neutral-500">#{String(orderNumber).padStart(5, '0')} · {title}</p>
        <p className="mt-4 font-semibold">{total} шт.{allPriced ? ` · ${money(totalAmount)}` : ''}</p>
        <p className="mt-3 text-sm text-neutral-500">Байер получил ваш выбор. Спасибо!</p>
      </div>
    </main>
  )

  return (
    <main className="client-page min-h-dvh pb-32">
      <header className="sticky top-0 z-10 border-b border-black/5 bg-[#f5f5f7]/95 px-4 pb-4 pt-5 backdrop-blur-xl">
        <div className="mx-auto max-w-xl">
          <div className="flex items-center justify-between text-xs font-medium text-neutral-500"><span>Заказ #{String(orderNumber).padStart(5, '0')}</span><span aria-live="polite">{total} шт.</span></div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-xs text-neutral-500">Укажите количество и нажмите «Готово».</p>

        </div>
      </header>
      {restored && <p role="status" className="mx-auto max-w-xl px-4 pt-4 text-sm text-emerald-700">Ваш предыдущий выбор восстановлен.</p>}
      <div className="mx-auto grid max-w-xl gap-4 px-4 py-4 sm:grid-cols-2">
        {products.map(product => {
          const quantity = quantities[product.id] ?? 0
          return (
            <article key={product.id} className={'overflow-hidden rounded-[28px] bg-white shadow-sm ring-1 ' + (quantity > 0 ? 'ring-black/30' : 'ring-black/5')}>
              <div className="aspect-[4/5] overflow-hidden bg-neutral-100"><Image unoptimized width={480} height={600} src={product.image_url} alt={product.name} className="h-full w-full object-cover" /></div>
              <div className="p-4">
                <h2 className="font-medium">{product.name}</h2>
                {product.price != null && <div className="mt-1 text-lg font-semibold">{money(product.price)}</div>}
                <div className="mt-4 flex items-center justify-between rounded-2xl bg-neutral-100 p-1">
                  <button type="button" aria-label={`Уменьшить: ${product.name}`} disabled={!ready || quantity === 0} onClick={() => setQty(product.id, quantity - 1)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-xl shadow-sm disabled:opacity-30">−</button>
                  <output aria-label={`Количество: ${product.name}`} className="min-w-10 text-center font-semibold">{quantity}</output>
                  <button type="button" aria-label={`Увеличить: ${product.name}`} disabled={!ready || quantity === MAX_QUANTITY} onClick={() => setQty(product.id, quantity + 1)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-black text-xl text-white shadow-sm disabled:opacity-30">+</button>
                </div>
                {quantity > 0 && product.price != null && <div className="mt-3 text-right text-xs text-neutral-500">{money(quantity * (product.price ?? 0))}</div>}
              </div>
            </article>
          )
        })}
      </div>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-black/5 bg-[#f5f5f7]/95 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur-xl">
        <div className="mx-auto max-w-xl"><button disabled={!ready || total === 0} onClick={() => setConfirming(true)} className="flex h-14 w-full items-center justify-between rounded-2xl bg-black px-5 text-sm font-semibold text-white shadow-xl disabled:bg-neutral-300"><span>Готово{total > 0 ? ' · ' + total + ' шт.' : ''}</span><span>{allPriced ? money(totalAmount) : ''}</span></button></div>
      </div>
      <dialog ref={dialogRef} aria-labelledby="confirmation-title" onCancel={event => { if (sending) event.preventDefault(); else setConfirming(false) }} onClose={() => setConfirming(false)} className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-[28px] border-0 bg-white p-5 shadow-2xl backdrop:bg-black/40">
        <h2 id="confirmation-title" className="text-xl font-semibold">Проверьте ваш заказ</h2>
        <div className="mt-4 divide-y divide-neutral-100">{selected.map(product => <div key={product.id} className="flex justify-between gap-3 py-3 text-sm"><span>{product.name} × {quantities[product.id]}</span>{product.price != null && <strong className="shrink-0">{money(product.price * quantities[product.id])}</strong>}</div>)}</div>
        <div className="mt-3 flex justify-between rounded-2xl bg-neutral-100 p-4"><span>{total} шт.</span>{allPriced && <strong>{money(totalAmount)}</strong>}</div>
        {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="mt-4 grid gap-2">
          <button disabled={sending} onClick={submit} className="h-12 rounded-2xl bg-black font-medium text-white disabled:opacity-50">{sending ? 'Отправляем…' : 'Подтвердить заказ'}</button>
          <button autoFocus disabled={sending} onClick={() => setConfirming(false)} className="h-12 rounded-2xl bg-neutral-100 font-medium">Вернуться к выбору</button>
        </div>
      </dialog>
    </main>
  )
}
