'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Order, OrderStatus } from '@/lib/types'

const statusLabel: Record<OrderStatus, string> = {
  draft: 'Draft', waiting: 'Waiting', received: 'Received', ordered: 'Ordered', completed: 'Completed',
}

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

  const loadOrders = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase.from('orders').select('*').order('created_at', { ascending: false })
    setOrders((data ?? []) as Order[])
    setLoading(false)
  }, [])

  useEffect(() => { void loadOrders() }, [loadOrders])

  const received = useMemo(() => orders.filter((o) => o.status === 'received').length, [orders])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-neutral-500">Рабочая панель</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Заказы</h1>
        </div>
        <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/5">
          <div className="text-xs text-neutral-500">Ожидают подтверждения</div>
          <div className="mt-1 text-2xl font-semibold">{received}</div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl bg-white p-8 text-sm text-neutral-500">Загрузка…</div>
      ) : orders.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-neutral-300 bg-white p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 text-xl">＋</div>
          <h2 className="mt-4 font-semibold">Пока нет заказов</h2>
          <p className="mt-1 text-sm text-neutral-500">Создайте первый заказ и добавьте товары.</p>
          <Link href="/orders/new" className="mt-5 inline-flex rounded-2xl bg-black px-4 py-2.5 text-sm font-medium text-white">Создать заказ</Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {orders.map((order) => (
            <Link key={order.id} href={"/orders/" + order.id} className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5 transition hover:ring-black/10 active:scale-[0.998]">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">#{String(order.order_number).padStart(5, '0')}</span>
                    <span className={"rounded-full px-2.5 py-1 text-[11px] font-medium " + statusClass(order.status)}>{statusLabel[order.status]}</span>
                  </div>
                  <h2 className="mt-2 truncate font-medium">{order.title}</h2>
                  <p className="mt-1 text-xs text-neutral-500">Создан {formatDate(order.created_at)}</p>
                </div>
                <span className="text-xl text-neutral-400">›</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
