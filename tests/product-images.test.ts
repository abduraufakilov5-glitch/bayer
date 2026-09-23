import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { signProductImages, type ImageCache } from '../lib/product-images'
test('photos are signed in one batch and reused until expiry', async () => {
  const bodies: string[][] = []
  const client = createClient('https://fixture.example','fixture',{global:{fetch:async (_url,init) => {
    const body = JSON.parse(String(init?.body));bodies.push(body.paths)
    return Response.json(body.paths.map((path:string) => ({path,signedURL:'/signed/'+path})))
  }}})
  const products = [{id:'1',image_path:'owner/a.jpg'},{id:'2',image_path:'owner/b.jpg'},{id:'3',image_path:'owner/a.jpg'}]
  const cache:ImageCache = new Map()
  const first = await signProductImages(client,products,cache)
  assert.equal(Object.keys(first).length,3)
  assert.deepEqual(bodies,[['owner/a.jpg','owner/b.jpg']])
  assert.deepEqual(await signProductImages(client,products,cache),first)
  assert.equal(bodies.length,1)
  cache.get('owner/a.jpg')!.expires = 0
  await signProductImages(client,products,cache)
  assert.deepEqual(bodies[1],['owner/a.jpg'])
})
