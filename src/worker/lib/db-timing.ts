// Per-request D1 accounting for the Server-Timing header: how many queries a request made and how
// long it spent waiting on the database (overlapping queries counted once). Each round trip to the
// primary costs ~100 ms from Taiwan, so this is the number to watch.
// `delayMs` (dev only, DB_LATENCY_MS in .dev.vars) adds that much to every call to reproduce it locally.

export type DbStats = { count: number; ms: number }

export function timedD1(d1: D1Database, delayMs = 0): { db: D1Database; stats: DbStats } {
  const stats: DbStats = { count: 0, ms: 0 }
  let inFlight = 0
  let since = 0
  const time = async <T>(run: () => Promise<T>) => {
    stats.count++
    if (inFlight++ === 0) since = performance.now()
    try {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      return await run()
    } finally {
      if (--inFlight === 0) stats.ms += performance.now() - since
    }
  }
  const real = new WeakMap<object, D1PreparedStatement>()
  const wrap = (s: D1PreparedStatement): D1PreparedStatement => {
    const w = new Proxy(s, {
      get(target, prop) {
        if (prop === 'bind') return (...args: unknown[]) => wrap(target.bind(...args))
        if (prop === 'all' || prop === 'raw' || prop === 'run' || prop === 'first') {
          const fn = (target[prop] as (...a: unknown[]) => Promise<unknown>).bind(target)
          return (...args: unknown[]) => time(() => fn(...args))
        }
        const v = Reflect.get(target, prop, target)
        return typeof v === 'function' ? v.bind(target) : v
      },
    })
    real.set(w, s)
    return w
  }
  const db = new Proxy(d1, {
    get(target, prop) {
      if (prop === 'prepare') return (q: string) => wrap(target.prepare(q))
      // A batch is one round trip however many statements it holds.
      if (prop === 'batch') return (stmts: D1PreparedStatement[]) => time(() => target.batch(stmts.map((s) => real.get(s) ?? s)))
      if (prop === 'exec') return (q: string) => time(() => target.exec(q))
      const v = Reflect.get(target, prop, target)
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
  return { db, stats }
}
