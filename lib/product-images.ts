import type { SupabaseClient } from '@supabase/supabase-js'
export type ImageCache = Map<string,{url:string;expires:number}>
// One batch for missing URLs. Cache belongs to the mounted page, not another buyer/session.
export async function signProductImages(client: SupabaseClient, products: {id:string;image_path:string}[], cache: ImageCache) {
  const paths = [...new Set(products.map(p => p.image_path))]
  const missing = paths.filter(path => !cache.has(path) || cache.get(path)!.expires < Date.now())
  if (missing.length) {
    const {data,error} = await client.storage.from('buyer-product-images').createSignedUrls(missing,3600)
    if (error) throw error
    for (const item of data ?? []) {
      if (item.path && item.signedUrl && !item.error) cache.set(item.path,{url:item.signedUrl,expires:Date.now()+50*60*1000})
    }
  }
  return Object.fromEntries(products.map(p => [p.id,cache.get(p.image_path)?.url ?? '']))
}
