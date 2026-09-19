import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PublicProduct } from '@/lib/types'
import ClientOrder from './client-order'

export const dynamic = 'force-dynamic'

export default async function PublicOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createAdminClient()
  const { data: order } = await supabase.from('buyer_orders').select('id, order_number, title, status').eq('public_token', token).single()
  if (!order || order.status === 'draft') notFound()

  const { data: products } = await supabase.from('buyer_products').select('id, name, price, image_path').eq('order_id', order.id).order('sort_order')
  const publicProducts: PublicProduct[] = []
  for (const product of products ?? []) {
    const { data } = await supabase.storage.from('buyer-product-images').createSignedUrl(product.image_path, 60 * 60 * 2)
    if (data?.signedUrl) publicProducts.push({ id: product.id, name: product.name, price: product.price, image_url: data.signedUrl })
  }

  if (order.status !== 'waiting') {
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

  return <ClientOrder token={token} title={order.title} orderNumber={order.order_number} products={publicProducts} />
}
