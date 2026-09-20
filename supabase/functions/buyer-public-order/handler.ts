import type { SupabaseClient } from '@supabase/supabase-js'
import { MAX_ORDER_PRODUCTS, MAX_QUANTITY, UUID_PATTERN } from './validation.ts'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
}
function json(body: unknown, status = 200) { return Response.json(body, { status, headers }) }

export function createHandler(supabase: SupabaseClient) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405)
    try {
      if (request.method === 'POST') {
        // Bound streamed bodies too: Content-Length is optional and untrusted.
        const reader = request.body?.getReader()
        if (!reader) return json({ error: 'Invalid body' }, 400)
        const chunks: Uint8Array[] = []
        let size = 0
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 65536) { await reader.cancel(); return json({ error: 'Payload too large' }, 413) }
          chunks.push(value)
        }
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
        let body
        try { body = JSON.parse(new TextDecoder().decode(bytes)) } catch { return json({ error: 'Invalid JSON' }, 400) }
        if (!body || typeof body.token !== 'string' || !UUID_PATTERN.test(body.token) || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_ORDER_PRODUCTS) return json({ error: 'Invalid order' }, 400)
        const ids = new Set<string>()
        for (const item of body.items) {
          if (!item || typeof item.product_id !== 'string' || !UUID_PATTERN.test(item.product_id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY || ids.has(item.product_id)) return json({ error: 'Invalid items' }, 400)
          ids.add(item.product_id)
        }
        const { data, error } = await supabase.rpc('submit_buyer_order', { p_token: body.token, p_items: body.items })
        if (error) {
          if (error.message === 'Order is not available' || error.message === 'Order already submitted') return json({ error: 'Order is not available' }, 409)
          if (error.message === 'Invalid items') return json({ error: 'Invalid items' }, 400)
          return json({ error: 'Could not submit order' }, 503)
        }
        const receipt = data?.[0]
        if (!receipt) return json({ error: 'Could not submit order' }, 503)
        return json({ order_number: receipt.order_number, total_quantity: receipt.total_quantity, confirmed_at: receipt.confirmed_at })
      }

      const token = new URL(request.url).searchParams.get('token') ?? ''
      if (!UUID_PATTERN.test(token)) return json({ error: 'Not found' }, 404)
      const { data: order, error } = await supabase.from('buyer_orders').select('id, owner_id, title, order_number, status').eq('public_token', token).neq('status', 'draft').maybeSingle()
      if (error) return json({ error: 'Service unavailable' }, 503)
      if (!order) return json({ error: 'Not found' }, 404)
      const publicOrder = { title: order.title, order_number: order.order_number, status: order.status }
      if (order.status !== 'waiting') return json({ order: publicOrder, products: [] })
      const { data: products, error: productsError } = await supabase.from('buyer_products').select('id, name, price, image_path').eq('order_id', order.id).order('sort_order').order('id')
      if (productsError || !products) return json({ error: 'Service unavailable' }, 503)
      // Defend against paths pointing into another buyer's storage namespace.
      if (products.some(p => !p.image_path.startsWith(order.owner_id + '/'))) return json({ error: 'Invalid product image' }, 503)
      const { data: images, error: imageError } = await supabase.storage.from('buyer-product-images').createSignedUrls(products.map(p => p.image_path), 3600)
      if (imageError || !images || images.some(image => image.error || !image.signedUrl)) return json({ error: 'Images unavailable' }, 503)
      const urls = new Map(images.map(image => [image.path, image.signedUrl]))
      return json({ order: publicOrder, products: products.map(p => ({ id: p.id, name: p.name, price: p.price, image_url: urls.get(p.image_path) })) })
    } catch { return json({ error: 'Service unavailable' }, 503) }
  }
}
