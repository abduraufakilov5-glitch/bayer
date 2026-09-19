import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  const supabase = createAdminClient()
  const { data: order } = await supabase.from('orders').select('id, order_number, title, status').eq('public_token', token).single()
  if (!order || order.status === 'draft') return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: products } = await supabase.from('products').select('id, name, price, image_path, sort_order').eq('order_id', order.id).order('sort_order')
  const result = []
  for (const product of products ?? []) {
    const { data } = await supabase.storage.from('product-images').createSignedUrl(product.image_path, 7200)
    if (data?.signedUrl) result.push({ id: product.id, name: product.name, price: product.price, image_url: data.signedUrl })
  }
  return NextResponse.json({ order, products: result })
}
