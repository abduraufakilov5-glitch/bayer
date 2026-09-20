import { getSupabaseConfig } from '@/lib/supabase/config'
import { UUID_PATTERN } from '@/lib/validation'
import { notFound } from 'next/navigation'
import type { PublicProduct } from '@/lib/types'
import ClientOrder from './client-order'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' as const }

export default async function PublicOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!UUID_PATTERN.test(token)) notFound()
  const config = getSupabaseConfig()
  if (!config) throw new Error('Supabase is not configured')
  const SUPABASE_URL = config.url

  const response = await fetch(
    SUPABASE_URL + '/functions/v1/buyer-public-order?token=' + encodeURIComponent(token),
    { cache: 'no-store', signal: AbortSignal.timeout(15000) },
  )

  if (response.status === 404) notFound()
  if (!response.ok) throw new Error('Public order service is unavailable')

  const data = (await response.json()) as {
    order: { order_number: number; title: string; status: string }
    products: PublicProduct[]
  }

  if (data.order.status === 'draft') notFound()

  if (data.order.status !== 'waiting') {
    return (
      <main className="flex min-h-dvh items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-2xl">✓</div>
          <h1 className="mt-5 text-xl font-semibold">Заказ уже отправлен</h1>
          <p className="mt-2 text-sm text-neutral-500">Этот заказ больше не принимает изменения.</p>
        </div>
      </main>
    )
  }

  return (
    <ClientOrder
      endpoint={SUPABASE_URL + '/functions/v1/buyer-public-order'}
      token={token}
      title={data.order.title}
      orderNumber={data.order.order_number}
      products={data.products}
    />
  )
}
