// IndexedDB stores Blobs, not base64. Local recovery expires with the server order.
export type LocalDraft<T> = {
  id: string
  owner: string
  updatedAt: number
  expiresAt: number
  data: T
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
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction('drafts', 'readwrite')
      t.objectStore('drafts').put(draft)
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
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
    return await new Promise((resolve, reject) => {
      const t = db.transaction('drafts', 'readwrite'),
        store = t.objectStore('drafts'),
        r = store.getAll()
      r.onsuccess = () => {
        let found: LocalDraft<T> | null = null
        for (const row of r.result) {
          if (row.expiresAt <= Date.now() || row.owner !== owner)
            store.delete(row.id)
          else if (row.id === id) found = row
        }
        t.oncomplete = () => resolve(found)
      }
      t.onerror = () => reject(t.error)
    })
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
