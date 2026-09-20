'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Order, OrderStatus } from '@/lib/types'

import { downloadCsv, filterOrders, statusLabels as statusLabel } from '@/lib/orders'

function statusClass(status: OrderStatus) {
  if (status === 'received') return 'bg-amber-100 text-amber-800'
  if (status === 'ordered') return 'bg-blue-100 text-blue-800'
  if (status === 'completed') return 'bg-emerald-100 text-emerald-800'
  if (status === 'waiting') return 'bg-neutral-100 text-neutral-800'
  return 'bg-neutral-100 text-neutral-500'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export default function DashboardPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<OrderStatus | 'all'>('all')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [page, setPage] = useState(1)
  const visible = useMemo(() => filterOrders(orders, query, status, sort), [orders, query, status, sort])
  const pageSize = 20


  const loadOrders = useCallback(async () => {
    try {
      const supabase = createClient()
      const all: Order[] = []
      // Fetch every page; Supabase caps a single response at 1,000 rows by default.
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase.from('buyer_orders').select('*').order('created_at', { ascending: false }).order('id').range(from, from + 499)
        if (error) throw error
        all.push(...(data ?? []) as Order[])
        if (!data || data.length < 500) break
      }
      setOrders(all)
    } catch { setError('Не удалось загрузить заказы. Проверьте подключение и повторите попытку.') }
    finally { setLoading(false) }
  }, [])

  // Fetch external data on mount; state is populated from the asynchronous response.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadOrders() }, [loadOrders])

  const received = useMemo(() => orders.filter((o) => o.status === 'received').length, [orders])
  const active = useMemo(() => orders.filter((o) => o.status !== 'completed').length, [orders])

  return (
    <div className="space-y-5 pb-20 sm:pb-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-neutral-500">Добро пожаловать</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Заказы</h1>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/5"><div className="text-[11px] text-neutral-500">Активных</div><div className="mt-1 text-xl font-semibold">{active}</div></div>
          <div className="rounded-2xl bg-black px-4 py-3 text-white shadow-lg shadow-black/10"><div className="text-[11px] text-white/55">К закупке</div><div className="mt-1 text-xl font-semibold">{received}</div></div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/orders/new" className="group rounded-[28px] bg-black p-5 text-white shadow-xl shadow-black/10 transition active:scale-[0.99]">
          <div className="flex items-center justify-between"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-xl">＋</div><span className="text-2xl text-white/40 transition group-hover:text-white">→</span></div>
          <div className="mt-8 text-lg font-semibold">Новый заказ</div>
          <div className="mt-1 text-sm text-white/55">Добавьте платки из каталога или новые фото.</div>
        </Link>
        <Link href="/catalog" className="rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.05)] ring-1 ring-black/5 transition active:scale-[0.99]">
          <div className="flex items-center justify-between"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-100 text-xl">▱</div><span className="text-2xl text-neutral-300">→</span></div>
          <div className="mt-8 text-lg font-semibold">Каталог платков</div>
          <div className="mt-1 text-sm text-neutral-500">Сохранённые товары и их цены для клиента.</div>
        </Link>
      </div>

      <section className="space-y-3 rounded-[24px] bg-white p-4 ring-1 ring-black/5">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input aria-label="Поиск заказов" value={query} onChange={e => { setQuery(e.target.value); setPage(1) }} placeholder="Найти по названию или номеру…" className="h-12 min-w-0 flex-1 rounded-xl border border-neutral-200 px-4" />
          <select aria-label="Сортировка заказов" value={sort} onChange={e => { setSort(e.target.value as typeof sort); setPage(1) }} className="rounded-xl border border-neutral-200 p-3 text-sm"><option value="newest">Сначала новые</option><option value="oldest">Сначала старые</option></select>
          <button disabled={loading || !visible.length || !!error} onClick={() => downloadCsv('bayer-orders.csv', [['Номер', 'Название', 'Статус', 'Создан', 'Подтверждён'], ...visible.map(o => [o.order_number, o.title, statusLabel[o.status], o.created_at, o.confirmed_at])])} className="rounded-xl border border-neutral-200 px-4 py-3 text-sm font-medium disabled:opacity-40">Скачать CSV</button>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Фильтр по статусу">
          {(['all', ...Object.keys(statusLabel)] as (OrderStatus | 'all')[]).map(value => <button key={value} aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1) }} className={'rounded-full px-3 py-2 text-xs font-medium ' + (status === value ? 'bg-black text-white' : 'bg-neutral-100 text-neutral-600')}>{value === 'all' ? 'Все' : statusLabel[value]} · {value === 'all' ? orders.length : orders.filter(o => o.status === value).length}</button>)}
        </div>
      </section>
      {error && <div role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error} <button onClick={() => { setError(''); setLoading(true); void loadOrders() }} className="ml-2 underline">Повторить</button></div>}
      {loading ? (
        <div className="rounded-[28px] bg-white p-8 text-sm text-neutral-500 shadow-sm ring-1 ring-black/5">Загрузка…</div>
      ) : error ? null : orders.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-neutral-300 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-2xl">＋</div>
          <h2 className="mt-4 font-semibold">Пока нет заказов</h2>
          <p className="mt-1 text-sm text-neutral-500">Первый платок автоматически попадёт в каталог.</p>
          <Link href="/orders/new" className="mt-5 inline-flex rounded-2xl bg-black px-4 py-2.5 text-sm font-semibold text-white">Создать заказ</Link>
        </div>
      ) : (
        <section>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Список заказов</h2><span className="text-sm text-neutral-500">{visible.length}</span></div>
          {visible.length === 0 && <div className="rounded-2xl bg-white p-8 text-center text-neutral-500">Ничего не найдено. Измените поиск или статус.</div>}
          <div className="grid gap-3">
            {visible.slice((page - 1) * pageSize, page * pageSize).map((order) => (
              <Link key={order.id} href={`/orders/${order.id}`} className="rounded-[24px] bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.04)] ring-1 ring-black/5 transition hover:ring-black/10 active:scale-[0.998]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">#{String(order.order_number).padStart(5, '0')}</span><span className={"rounded-full px-2.5 py-1 text-[11px] font-medium " + statusClass(order.status)}>{statusLabel[order.status]}</span></div>
                    <h3 className="mt-2 truncate font-medium">{order.title}</h3>
                    <p className="mt-1 text-xs text-neutral-500">{formatDate(order.created_at)}</p>
                  </div>
                  <span className="pt-1 text-xl text-neutral-300">›</span>
                </div>
              </Link>
            ))}
          </div>
          {visible.length > pageSize && <div className="mt-4 flex items-center justify-between text-sm"><button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="rounded-xl bg-white px-4 py-3 disabled:opacity-40">← Назад</button><span>{page} / {Math.ceil(visible.length / pageSize)}</span><button disabled={page * pageSize >= visible.length} onClick={() => setPage(p => p + 1)} className="rounded-xl bg-white px-4 py-3 disabled:opacity-40">Далее →</button></div>}
        </section>
      )}
    </div>
  )
}
