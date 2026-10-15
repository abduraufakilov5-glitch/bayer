// IndexedDB stores binary buffers: WebKit private contexts can reject Blob values.
export type LocalDraft<T> = {
  id: string
  owner: string
  updatedAt: number
  expiresAt: number
  data: T
}
type StoredBlob = { __bayerBlob: 1; type: string; bytes: ArrayBuffer }
async function encode(value: unknown): Promise<unknown> {
  if (value instanceof Blob)
    return {
      __bayerBlob: 1,
      type: value.type,
      bytes: await value.arrayBuffer(),
    } satisfies StoredBlob
  if (Array.isArray(value)) {
    const result = []
    for (const item of value) result.push(await encode(item))
    return result
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value))
      result[key] = await encode(item)
    return result
  }
  return value
}
function decode(value: unknown): unknown {
  if (value instanceof Blob || value instanceof ArrayBuffer) return value
  if (Array.isArray(value)) return value.map(decode)
  if (value && typeof value === 'object') {
    const blob = value as StoredBlob
    if (blob.__bayerBlob === 1 && blob.bytes instanceof ArrayBuffer)
      return new Blob([blob.bytes], { type: blob.type })
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, decode(item)]),
    )
  }
  return value
}
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('bayer-drafts', 1)
    r.onupgradeneeded = () =>
      r.result.createObjectStore('drafts', { keyPath: 'id' })
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
export async function writeDraft<T>(draft: LocalDraft<T>) {
  const stored = { ...draft, data: await encode(draft.data) },
    db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('drafts', 'readwrite')
      t.objectStore('drafts').put(stored)
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  } finally {
    db.close()
  }
}
export async function readDraft<T>(
  id: string,
  owner: string,
): Promise<LocalDraft<T> | null> {
  const db = await database()
  try {
    const found = await new Promise<LocalDraft<T> | null>((resolve, reject) => {
      let row: LocalDraft<T> | null = null
      const t = db.transaction('drafts', 'readwrite'),
        r = t.objectStore('drafts').openCursor()
      r.onsuccess = () => {
        const cursor = r.result
        if (!cursor) return
        const current = cursor.value as LocalDraft<T>
        if (current.expiresAt <= Date.now() || current.owner !== owner)
          cursor.delete()
        else if (current.id === id) row = current
        cursor.continue()
      }
      t.oncomplete = () => resolve(row)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
    return found ? { ...found, data: decode(found.data) as T } : null
  } finally {
    db.close()
  }
}
export async function removeDraft(id: string) {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('drafts', 'readwrite')
      t.objectStore('drafts').delete(id)
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
    })
  } finally {
    db.close()
  }
}
