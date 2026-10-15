import { getSupabaseConfig } from '@/lib/supabase/config'
import { UUID_PATTERN } from '@/lib/validation'
import { notFound } from 'next/navigation'
import type { PublicProduct, PublicReceipt } from '@/lib/types'
import ClientOrder from './client-order'

export const dynamic = 'force-dynamic'

export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
}

export default async function PublicOrderPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!UUID_PATTERN.test(token)) notFound()
  const config = getSupabaseConfig()
  if (!config) throw new Error('Supabase is not configured')
  const SUPABASE_URL = config.url

  const response = await fetch(
    SUPABASE_URL +
      '/functions/v1/buyer-public-order?token=' +
      encodeURIComponent(token),
    { cache: 'no-store', signal: AbortSignal.timeout(15000) },
  )

  if (response.status === 404) notFound()
  if (!response.ok) throw new Error('Public order service is unavailable')

  const data = (await response.json()) as {
    order: {
      order_number: number
      title: string
      status: string
      revision: number
    }
    products: PublicProduct[]
    receipt: PublicReceipt | null
  }

  if (data.order.status === 'draft') notFound()

  return (
    <ClientOrder
      endpoint={SUPABASE_URL + '/functions/v1/buyer-public-order'}
      token={token}
      title={data.order.title}
      orderNumber={data.order.order_number}
      products={data.products}
      revision={data.order.revision}
      initialReceipt={data.receipt}
      readOnly={data.order.status !== 'waiting'}
    />
  )
}
