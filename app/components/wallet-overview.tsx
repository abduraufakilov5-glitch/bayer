'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  EMPTY_WALLET,
  projectOrders,
  walletSummary,
  type WalletData,
} from '@/lib/wallet'
import { formatSomoni } from '@/lib/pricing'
import { useRates } from './exchange-rates'
export function useWallet() {
  const [data, setData] = useState<WalletData>(EMPTY_WALLET),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  async function reload() {
    try {
      const r = await createClient().rpc('wallet_snapshot')
      if (r.error || !r.data?.accounts) throw r.error
      setData(r.data as WalletData)
      setError('')
    } catch {
      setError('Не удалось загрузить кошелёк. Повторите загрузку.')
    } finally {
      setLoading(false)
    }
  }
  // Fetch state comes from the asynchronous network response.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
    const focus = () => void reload()
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [])
  return { data, loading, error, reload }
}
export function WalletMetrics({ data }: { data: WalletData }) {
  const { rates } = useRates(),
    s = walletSummary(data, rates)
  return (
    <>
      <div className="wallet-metrics">
        <div className="wallet-metric wallet-cash">
          <span>Доступно сейчас</span>
          <strong>{s.unvalued ? '—' : formatSomoni(s.cash)}</strong>
          <small>На счетах и наличными</small>
        </div>
        <div className="wallet-metric wallet-expected">
          <span>Ожидается</span>
          <strong>{formatSomoni(s.expected)}</strong>
          <small>Ещё не полученные деньги</small>
        </div>
        <div className="wallet-metric">
          <span>Планируемые расходы</span>
          <strong>{formatSomoni(s.planned)}</strong>
          <small>Закупки, карго и ваши планы</small>
        </div>
        <div className="wallet-metric">
          <span>Прогноз остатка</span>
          <strong>{s.unvalued ? '—' : formatSomoni(s.forecast)}</strong>
          <small>После поступлений, планов и возвратов</small>
        </div>
      </div>
      <p className="subtitle text-sm mt-3">
        Мне должны: {formatSomoni(s.receivable)} · Я должен:{' '}
        {formatSomoni(s.payable)} · Резерв:{' '}
        {formatSomoni(s.planned + s.refunds)} · Свободно после резерва:{' '}
        {s.unvalued ? '—' : formatSomoni(s.free)}
      </p>
      <p className="subtitle text-xs mt-2">
        Долги показаны отдельно и не включены в прогноз. Валютные счета оценены
        по Visa Алиф; операции в отчётах — по зафиксированным курсам.
      </p>
      {s.refunds > 0 && (
        <p className="notice mt-3">
          Вернуть клиентам по отменённым заказам: {formatSomoni(s.refunds)}
        </p>
      )}
      {s.incomplete && (
        <p className="notice mt-3">
          Прогноз неполный: у некоторых заказов не указаны цены или затраты.
        </p>
      )}
      {s.unvalued && (
        <p role="status" className="notice mt-3">
          Для общей суммы валютных счетов нужен курс Visa Алиф. Остатки в валюте
          доступны в разделе «Счета».
        </p>
      )}
    </>
  )
}
export function WalletOverview({ orderId }: { orderId?: string }) {
  const { data, loading, error, reload } = useWallet()
  if (loading)
    return (
      <p role="status" className="subtitle">
        Загружаем кошелёк…
      </p>
    )
  if (error)
    return (
      <p className="notice" role="alert">
        {error}{' '}
        <button onClick={() => void reload()} className="underline">
          Повторить
        </button>
      </p>
    )
  const order = orderId
    ? projectOrders(data).find((o) => o.id === orderId)
    : null
  return (
    <section className="panel panel-padding mb-6">
      <div className="wallet-row mb-4">
        <h2 className="text-xl font-semibold">
          {orderId ? 'Деньги по заказу' : 'Кошелёк'}
        </h2>
        <Link
          className="text-button"
          href={'/wallet' + (orderId ? '?order=' + orderId : '')}
        >
          Открыть →
        </Link>
      </div>
      {orderId ? (
        order && (
          <>
            <div className="wallet-metrics">
              <div className="wallet-metric">
                <span>Получено от клиента</span>
                <strong>{formatSomoni(order.paid)}</strong>
              </div>
              <div className="wallet-metric wallet-expected">
                <span>Осталось получить</span>
                <strong>{formatSomoni(order.expected)}</strong>
              </div>
              <div className="wallet-metric">
                <span>Ещё на закупку и карго</span>
                <strong>
                  {formatSomoni(order.purchaseLeft + order.cargoLeft)}
                </strong>
              </div>
              <div className="wallet-metric">
                <span>Ожидаемая прибыль</span>
                <strong>
                  {order.profit == null ? '—' : formatSomoni(order.profit)}
                </strong>
              </div>
            </div>
            <p className="subtitle mt-3 text-xs">
              Завершение заказа само по себе не зачисляет деньги. Оплаты и
              расходы отмечаются в кошельке.
            </p>
          </>
        )
      ) : (
        <WalletMetrics data={data} />
      )}
    </section>
  )
}
