import type { Receipt } from './telegram.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MAX_ORDER_PRODUCTS, MAX_QUANTITY, UUID_PATTERN } from './validation.ts'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'content-type, authorization, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
}
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers })
}

export function createHandler(
  supabase: SupabaseClient,
  notify?: (receipt: Receipt) => Promise<void>,
) {
  async function allowed(request: Request) {
    // Gateway-provided address, hashed before persistence. No raw IPs or tokens in the table.
    const address =
      request.headers.get('x-real-ip') ??
      request.headers.get('cf-connecting-ip') ??
      request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ??
      'unknown'
    const bytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(address),
    )
    const key = Array.from(new Uint8Array(bytes), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
    const { data, error } = await supabase.rpc('buyer_limit_public', {
      p_key: key,
    })
    if (error) throw error
    return data === true
  }
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers })
    if (!['GET', 'POST'].includes(request.method))
      return json({ error: 'Method not allowed' }, 405)
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
          if (size > 524288) {
            await reader.cancel()
            return json({ error: 'Payload too large' }, 413)
          }
          chunks.push(value)
        }
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.length
        }
        let body
        try {
          body = JSON.parse(new TextDecoder().decode(bytes))
        } catch {
          return json({ error: 'Invalid JSON' }, 400)
        }
        if (
          !body ||
          typeof body.token !== 'string' ||
          !UUID_PATTERN.test(body.token) ||
          !Array.isArray(body.items) ||
          body.items.length < 1 ||
          body.items.length > MAX_ORDER_PRODUCTS
        )
          return json({ error: 'Invalid order' }, 400)
        if (
          (body.note !== undefined &&
            (typeof body.note !== 'string' || body.note.length > 1000)) ||
          (body.revision !== undefined &&
            (!Number.isInteger(body.revision) || body.revision < 1)) ||
          (body.request_id !== undefined && !UUID_PATTERN.test(body.request_id))
        )
          return json({ error: 'Invalid order' }, 400)
        const ids = new Set<string>()
        for (const item of body.items) {
          if (
            !item ||
            typeof item.product_id !== 'string' ||
            !UUID_PATTERN.test(item.product_id) ||
            !Number.isInteger(item.quantity) ||
            item.quantity < 1 ||
            item.quantity > MAX_QUANTITY ||
            ids.has(item.product_id) ||
            (item.note !== undefined &&
              (typeof item.note !== 'string' || item.note.length > 300))
          )
            return json({ error: 'Invalid items' }, 400)
          ids.add(item.product_id)
        }
        if (!(await allowed(request)))
          return json({ error: 'Too many requests' }, 429)
        const { data, error } = await supabase.rpc('submit_buyer_order', {
          p_token: body.token,
          p_items: body.items,
          p_note: body.note ?? '',
          p_revision: body.revision ?? 1,
          p_request_id: body.request_id ?? null,
        })
        if (error) {
          if (
            error.message === 'Order is not available' ||
            error.message === 'Order already submitted' ||
            error.message === 'Order changed; reload' ||
            error.message === 'Selection below purchased quantity'
          )
            return json({ error: 'Order is not available' }, 409)
          if (error.message === 'Invalid items')
            return json({ error: 'Invalid items' }, 400)
          return json({ error: 'Could not submit order' }, 503)
        }
        const receipt = data?.[0]
        if (!receipt) return json({ error: 'Could not submit order' }, 503)
        if (notify) {
          try {
            await notify(receipt)
          } catch {
            console.warn('Notification unavailable; order is saved')
          }
        }
        return json({
          order_number: receipt.order_number,
          total_quantity: receipt.total_quantity,
          confirmed_at: receipt.confirmed_at,
        })
      }

      const token = new URL(request.url).searchParams.get('token') ?? ''
      if (!UUID_PATTERN.test(token)) return json({ error: 'Not found' }, 404)
      if (!(await allowed(request)))
        return json({ error: 'Too many requests' }, 429)
      const { data: order, error } = await supabase
        .from('buyer_orders')
        .select('id, owner_id, title, order_number, status, revision')
        .eq('public_token', token)
        .is('deleted_at', null)
        .eq('link_revoked', false)
        .gt('created_at', new Date(Date.now() - 25 * 86400000).toISOString())
        .neq('status', 'draft')
        .maybeSingle()
      if (error) return json({ error: 'Service unavailable' }, 503)
      if (!order) return json({ error: 'Not found' }, 404)
      const publicOrder = {
        title: order.title,
        order_number: order.order_number,
        status: order.status,
        revision: order.revision,
      }
      const { data: previous, error: receiptError } = await supabase
        .from('buyer_submissions')
        .select(
          'note,revision,total_quantity,confirmed_at,buyer_submission_items(product_id,product_name,price,quantity,note)',
        )
        .eq('order_id', order.id)
        .order('revision', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (receiptError) return json({ error: 'Service unavailable' }, 503)
      const receipt = previous
        ? {
            note: previous.note,
            revision: previous.revision,
            total_quantity: previous.total_quantity,
            confirmed_at: previous.confirmed_at,
            items: previous.buyer_submission_items.map(
              (i: {
                product_id: string
                product_name: string
                price: number | null
                quantity: number
                note: string
              }) => ({
                product_id: i.product_id,
                product_name: i.product_name,
                price: i.price,
                quantity: i.quantity,
                note: i.note,
              }),
            ),
          }
        : null
      if (order.status !== 'waiting')
        return json({ order: publicOrder, products: [], receipt })
      const { data: products, error: productsError } = await supabase
        .from('buyer_products')
        .select('id, name, price, image_path, thumbnail_path')
        .eq('order_id', order.id)
        .order('sort_order')
        .order('id')
      if (productsError || !products)
        return json({ error: 'Service unavailable' }, 503)
      // Defend against paths pointing into another buyer's storage namespace.
      if (
        products.some(
          (p) =>
            !p.image_path.startsWith(order.owner_id + '/') ||
            (p.thumbnail_path &&
              !p.thumbnail_path.startsWith(order.owner_id + '/')),
        )
      )
        return json({ error: 'Invalid product image' }, 503)
      const { data: images, error: imageError } = await supabase.storage
        .from('buyer-product-images')
        .createSignedUrls(
          [
            ...new Set(
              products.flatMap((p) =>
                [p.image_path, p.thumbnail_path].filter(Boolean),
              ),
            ),
          ],
          3600,
        )
      if (
        imageError ||
        !images ||
        images.some((image) => image.error || !image.signedUrl)
      )
        return json({ error: 'Images unavailable' }, 503)
      const urls = new Map(images.map((image) => [image.path, image.signedUrl]))
      return json({
        order: publicOrder,
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          image_url: urls.get(p.thumbnail_path ?? p.image_path),
          full_image_url: urls.get(p.image_path),
        })),
        receipt,
      })
    } catch {
      return json({ error: 'Service unavailable' }, 503)
    }
  }
}
