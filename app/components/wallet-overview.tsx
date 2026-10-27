'use client'
import { useMemo } from 'react'
import Link from 'next/link'
import { projectOrders } from '@/lib/wallet'
import { formatSomoni } from '@/lib/pricing'
import { useWalletStore } from './wallet-store'
export function WalletOverview({orderId}:{orderId:string}){
 const {data,loading,error,reload}=useWalletStore()
 const order=useMemo(()=>projectOrders(data).find(o=>o.id===orderId),[data,orderId])
 if(loading)return <div className="skeleton" role="status" aria-label="Загрузка финансов заказа"/>
 if(error)return <p className="notice" role="alert">{error} <button onClick={()=>void reload()}>Повторить</button></p>
 if(!order)return null
 return <section className="panel panel-padding mb-6"><div className="wallet-row mb-4"><h2 className="text-xl font-semibold">Деньги по заказу</h2><Link className="text-button" href={'/work/finances?order='+orderId}>Все операции →</Link></div><div className="wallet-metrics"><div className="wallet-metric"><span>Получено от клиента</span><strong>{formatSomoni(order.paid)}</strong></div><div className="wallet-metric wallet-expected"><span>Осталось получить</span><strong>{formatSomoni(order.expected)}</strong></div><div className="wallet-metric"><span>Ещё на товар и карго</span><strong>{formatSomoni(order.purchaseLeft+order.cargoLeft)}</strong></div><div className="wallet-metric"><span>Ожидаемая прибыль</span><strong>{order.profit==null?'—':formatSomoni(order.profit)}</strong></div></div><p className="form-hint mt-3">Оплаты и расходы этого заказа находятся в разделе «Работа → Финансы».</p></section>
}
