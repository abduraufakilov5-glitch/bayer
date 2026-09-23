'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { FinanceSummary, Order, OrderStatus } from '@/lib/types'
import { statusLabels } from '@/lib/orders'
import { Icon } from '@/app/components/icons'
import { formatSomoni } from '@/lib/pricing'
const pageSize = 24
const steps: OrderStatus[] = ['draft','waiting','received','ordered','completed']
const dateFormatter = new Intl.DateTimeFormat('ru', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'})
export default function DashboardPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [status, setStatus] = useState<OrderStatus | 'all' | 'deleted'>('all')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState({active:0, received:0, completed:0})
  const [finance, setFinance] = useState<FinanceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const version = useRef(0)
  useEffect(() => { const timer = setTimeout(() => {setSearch(query.trim()); setPage(0)}, 250); return () => clearTimeout(timer) }, [query])
  useEffect(() => {
    const current = ++version.current
    const controller = new AbortController()
    let inFlight = false
    async function load(background = false) {
      if (inFlight) return
      inFlight = true
      if (!background) setLoading(true)
      try {
        const supabase = createClient()
        let request = supabase.from('buyer_orders').select('id,title,order_number,status,created_at,confirmed_at,deleted_at', {count:'exact'}).order('created_at', {ascending:false}).order('id').range(page * pageSize, (page + 1) * pageSize - 1)
        request = status === 'deleted' ? request.not('deleted_at', 'is', null) : request.is('deleted_at', null)
        if (status !== 'all' && status !== 'deleted') request = request.eq('status', status)
        if (search) {
          if (/^#?\d+$/.test(search)) request = request.eq('order_number', Number(search.replace('#','')))
          else request = request.ilike('title', '%' + search.replace(/[\\%_]/g, '\\$&') + '%')
        }
        const {data, count, error} = await request.abortSignal(controller.signal)
        if (current !== version.current || controller.signal.aborted) return
        if (error) throw error
        setOrders((data ?? []) as Order[]); setTotal(count ?? data?.length ?? 0); setError('')
      } catch { if (!controller.signal.aborted) setError('Не удалось обновить заказы. Проверьте подключение.') }
      finally { inFlight = false; if (current === version.current && !controller.signal.aborted) setLoading(false) }
    }
    void load()
    const refresh = () => { if (document.visibilityState === 'visible') void load(true) }
    const timer = setInterval(refresh,15000)
    window.addEventListener('focus',refresh)
    return () => { controller.abort();clearInterval(timer);window.removeEventListener('focus',refresh) }
  }, [status, search, page, refreshKey])
  useEffect(() => {
    let live = true
    async function loadStats() {
      const supabase = createClient()
      const results = await Promise.all([
        supabase.from('buyer_orders').select('id',{count:'exact',head:true}).is('deleted_at',null).neq('status','completed'),
        supabase.from('buyer_orders').select('id',{count:'exact',head:true}).is('deleted_at',null).eq('status','received'),
        supabase.from('buyer_orders').select('id',{count:'exact',head:true}).is('deleted_at',null).eq('status','completed'),
        supabase.rpc('buyer_finance_summary'),
      ])
      if (!live) return
      if (results.slice(0,3).every(r => !r.error)) setStats({active:results[0].count ?? 0,received:results[1].count ?? 0,completed:results[2].count ?? 0})
      if (!results[3].error && results[3].data?.[0]) setFinance(results[3].data[0] as FinanceSummary)
    }
    void loadStats()
    const refresh = () => {if (document.visibilityState === 'visible') void loadStats()}
    window.addEventListener('focus',refresh)
    const timer = setInterval(refresh,60000)
    return () => {live=false;clearInterval(timer);window.removeEventListener('focus',refresh)}
  }, [refreshKey])
  async function restoreOrder(id: string) {
    const supabase = createClient()
    const {error} = await supabase.from('buyer_orders').update({deleted_at:null}).eq('id',id).not('deleted_at','is',null)
    if (error) setError('Не удалось восстановить заказ.')
    else {setRefreshKey(key => key + 1);setPage(0)}
  }
  return <div>
    <div className="dashboard-heading"><div><p className="eyebrow mb-3">Ваше рабочее пространство</p><h1 className="page-title">Заказы. Всё на месте.</h1><p className="subtitle mt-3">Меньше переписок. Больше ясности.</p></div><Link href="/orders/new" className="btn btn-primary"><Icon name="plus" size={18}/><span>Новый заказ</span></Link></div>
    <section className="summary-strip" aria-label="Сводка заказов"><div className="summary-item"><span>В работе</span><strong>{stats.active}</strong></div><div className="summary-item"><span>Готовы к закупке</span><strong style={{color:'var(--accent)'}}>{stats.received}</strong></div><div className="summary-item"><span>Завершено</span><strong>{stats.completed}</strong></div></section>
    <section aria-labelledby="finance-title"><div className="mb-3 flex items-center justify-between"><div><p className="eyebrow">Финансы</p><h2 id="finance-title" className="mt-1 text-xl font-semibold tracking-tight">За всё время</h2></div><span className="order-id">{finance?.confirmed_orders ?? 0} подтверждённых</span></div><div className="finance-card"><div className="finance-metric"><span>Выручка</span><strong>{formatSomoni(finance?.revenue ?? 0)}</strong></div><div className="finance-metric"><span>Потрачено</span><strong>{formatSomoni(finance?.spent ?? 0)}</strong></div><div className="finance-metric earned"><span>Заработано</span><strong>{formatSomoni(finance?.earned ?? 0)}</strong></div></div>{finance && <p className="-mt-4 mb-7 text-xs text-neutral-500">В этом месяце: заработано {formatSomoni(finance.month_earned)}, потрачено {formatSomoni(finance.month_spent)}</p>}</section>
    <div className="search-field"><Icon name="search" size={18}/><input aria-label="Поиск заказов" placeholder="Найти по названию или номеру" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button aria-label="Очистить поиск" className="text-button" onClick={() => setQuery('')}>×</button>}</div>
    <div className="filter-bar" aria-label="Фильтр по статусу">{(['all',...steps,'deleted'] as const).map(value => <button key={value} className="filter-pill" aria-pressed={status === value} onClick={() => {setStatus(value);setPage(0)}}>{value === 'all' ? 'Все заказы' : value === 'deleted' ? 'Корзина' : statusLabels[value]}</button>)}</div>
    {error && <p role="alert" className="notice mb-5">{error} <button onClick={() => setRefreshKey(k => k + 1)} className="underline">Повторить</button></p>}
    {loading ? <div className="order-grid" aria-label="Загрузка заказов" role="status"><div className="skeleton"/><div className="skeleton"/></div> : !orders.length ? <div className="empty-state"><div className="empty-icon"><Icon name={status === 'deleted' ? 'trash' : search ? 'search' : 'bag'} size={28}/></div><h2 className="text-xl font-semibold tracking-tight">{search ? 'Ничего не найдено' : status === 'deleted' ? 'Корзина пуста' : status !== 'all' ? 'Здесь пока пусто' : 'Начните с одной подборки'}</h2><p className="subtitle mt-3 mb-6">{search ? 'Попробуйте другое название или номер заказа.' : status === 'deleted' ? 'Удалённые заказы можно восстановить здесь.' : 'Добавьте фото, отправьте ссылку — остальное выберет клиент.'}</p>{search ? <button className="btn btn-secondary" onClick={() => setQuery('')}>Сбросить поиск</button> : status !== 'deleted' && <Link href="/orders/new" className="btn btn-primary"><Icon name="plus" size={18}/>Создать заказ</Link>}</div> : <div className="order-grid">{orders.map(order => status === 'deleted' ? <article key={order.id} className="order-card"><div className="flex items-center justify-between gap-3 mb-5"><span className="order-id">№ {String(order.order_number).padStart(5,'0')}</span><span className="status-badge">Удалён</span></div><h2>{order.title}</h2><p className="order-date mt-3"><Icon name="clock" size={13}/>{dateFormatter.format(new Date(order.deleted_at || order.created_at))}</p><button className="btn btn-secondary mt-5" onClick={() => void restoreOrder(order.id)}><Icon name="restore" size={16}/>Восстановить</button></article> : <Link key={order.id} href={'/orders/' + order.id} className="order-card"><div className="flex items-center justify-between gap-3 mb-5"><span className="order-id">№ {String(order.order_number).padStart(5,'0')}</span><span className={'status-badge status-' + order.status}>{statusLabels[order.status]}</span></div><div className="flex items-center justify-between gap-4"><h2>{order.title}</h2><Icon name="arrow" size={16} className="shrink-0 text-neutral-400"/></div><p className="order-date mt-3"><Icon name="clock" size={13}/>{order.confirmed_at ? 'Подтверждён ' : ''}{dateFormatter.format(new Date(order.confirmed_at || order.created_at))}</p><div className="order-progress" aria-hidden="true">{steps.map((step,index) => <span key={step} className={index === steps.indexOf(order.status) ? 'current' : index < steps.indexOf(order.status) ? 'filled' : ''}/>)}</div></Link>)}</div>}
    {total > pageSize && <div className="mt-6 flex items-center justify-between"><button className="btn btn-secondary" disabled={!page || loading} onClick={() => setPage(p => p-1)}>Назад</button><span className="text-xs text-neutral-500">{page+1} / {Math.ceil(total/pageSize)}</span><button className="btn btn-secondary" disabled={(page+1)*pageSize >= total || loading} onClick={() => setPage(p => p+1)}>Далее</button></div>}
    {!loading && orders.length > 0 && <p className="mt-7 text-center text-xs text-neutral-400">Подтверждения появляются автоматически</p>}
  </div>
}
