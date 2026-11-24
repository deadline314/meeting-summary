import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query'

// Keeps what the project pages last showed in IndexedDB, so opening them again (even after a
// reload) draws at once from the browser while the server is asked for anything newer.
// Only the signed-in person's own data, cleared on sign-out and when another account signs in;
// discarded after a new deploy (data shapes may change) or after a few days.

/** Query families worth keeping: project management and the lists around it. */
const KEEP = new Set(['projects', 'project', 'labels', 'counts', 'issues', 'issue', 'users', 'notes', 'saved-views'])
const MAX_AGE = 3 * 86400_000
const BUILD = import.meta.env.VITE_BUILD_ID ?? 'dev'
const KEY = 'queries'

type Saved = { build: string; user: string; at: number; state: ReturnType<typeof dehydrate> }

let dbp: Promise<IDBDatabase> | null = null
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('ms-cache', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const store = (await db()).transaction('kv', mode).objectStore('kv')
    return await new Promise<T>((resolve, reject) => {
      const req = fn(store)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } catch {
    // Private windows and blocked storage: the app simply works without the cache.
    return undefined
  }
}

export const clearQueryCache = () => run('readwrite', (s) => s.clear())

/** Puts the last saved state back, if it belongs to this user and this build. */
export async function restoreQueryCache(client: QueryClient, userId: string) {
  const saved = (await run<Saved>('readonly', (s) => s.get(KEY))) ?? null
  if (!saved) return
  if (saved.user !== userId || saved.build !== BUILD || Date.now() - saved.at > MAX_AGE) {
    await clearQueryCache()
    return
  }
  // Queries that already have newer data keep it.
  hydrate(client, saved.state)
  // Shown at once, but still asked again when a page uses it: the browser copy may be old.
  for (const q of saved.state.queries) void client.invalidateQueries({ queryKey: q.queryKey, exact: true, refetchType: 'none' })
}

let stop: (() => void) | null = null
let owner: string | null = null

/** Saves the kept queries (throttled) for as long as this user is signed in. */
export function persistQueryCache(client: QueryClient, userId: string) {
  if (owner === userId && stop) return
  stop?.()
  owner = userId
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = () => {
    timer = null
    if (owner !== userId) return // signed out while waiting
    const state = dehydrate(client, { shouldDehydrateQuery: (q) => q.state.status === 'success' && KEEP.has(String(q.queryKey[0])) })
    void run('readwrite', (s) => s.put({ build: BUILD, user: userId, at: Date.now(), state } satisfies Saved, KEY))
  }
  // Only when kept data actually changed, and written while the browser is idle so it never
  // lands in the middle of scrolling or typing.
  const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 10_000 }) : setTimeout(fn, 0))
  const unsubscribe = client.getQueryCache().subscribe((e) => {
    if (!KEEP.has(String(e.query.queryKey[0]))) return
    if (e.type !== 'removed' && !(e.type === 'updated' && e.action.type === 'success')) return
    timer ??= setTimeout(() => idle(save), 2000)
  })
  stop = () => {
    unsubscribe()
    if (timer) clearTimeout(timer)
    stop = null
    owner = null
  }
}

export function stopPersisting() {
  stop?.()
}
