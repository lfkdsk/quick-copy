// Content-addressed cache for image bytes. Keys are git blob SHAs, so
// an entry can never go stale — a changed file is a different key.
// Without this, every refresh re-downloads every thumbnail.

const DB_NAME = 'quick-copy'
const DB_VERSION = 1
const STORE = 'blobs'

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      return resolve(null)
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    // Private-browsing modes and blocked site data land here. The app
    // works fine uncached, so a failure is never fatal.
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return dbPromise
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode)
      const request = run(tx.objectStore(STORE))
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export function cacheGet(sha: string): Promise<Blob | null> {
  return withStore<Blob>('readonly', (store) => store.get(sha) as IDBRequest<Blob>)
}

export async function cachePut(sha: string, blob: Blob): Promise<void> {
  await withStore('readwrite', (store) => store.put(blob, sha) as IDBRequest<unknown>)
}

export async function cacheClear(): Promise<void> {
  await withStore('readwrite', (store) => store.clear() as IDBRequest<unknown>)
}

// Item descriptors are small JSON, so localStorage keyed by the same
// content-addressed SHA is a better fit than another IDB round-trip.
const JSON_PREFIX = 'qc.item.'

export function jsonCacheGet(sha: string): string | null {
  try {
    return localStorage.getItem(JSON_PREFIX + sha)
  } catch {
    return null
  }
}

export function jsonCachePut(sha: string, text: string): void {
  try {
    localStorage.setItem(JSON_PREFIX + sha, text)
  } catch {
    // Out of quota: drop every descriptor and let the next load refill
    // the ones that still exist. Cheaper than tracking an LRU.
    pruneJsonCache()
    try {
      localStorage.setItem(JSON_PREFIX + sha, text)
    } catch {
      /* give up quietly — the cache is an optimisation, not state */
    }
  }
}

export function pruneJsonCache(): void {
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(JSON_PREFIX)) doomed.push(key)
    }
    for (const key of doomed) localStorage.removeItem(key)
  } catch {
    /* nothing we can do, and nothing that breaks */
  }
}
