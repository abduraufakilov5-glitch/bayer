/* Cache public, immutable assets only. Never cache authenticated HTML, API
   responses, balances, rates or writes. Each navigation still checks auth. */
const CACHE = 'my-balance-public-v1'
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline.html'])).then(() => self.skipWaiting()))
})
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('my-balance-public-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')))
    return
  }
  if (!url.pathname.startsWith('/_next/static/')) return
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(request)
    if (cached) return cached
    const response = await fetch(request)
    if (response.ok) {
      const copy = response.clone()
      event.waitUntil((async () => {
        await cache.put(request, copy)
        const keys = await cache.keys()
        if (keys.length > 100) await Promise.all(keys.filter(key => !key.url.endsWith('/offline.html')).slice(0, keys.length - 100).map(key => cache.delete(key)))
      })())
    }
    return response
  }))
})
