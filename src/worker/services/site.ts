import { and, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Ctx } from '../context'
import { isAdmin, requireScope } from '../context'
import { files, settings, submissions, usageDaily, users } from '../db/schema'
import { notFound } from '../lib/errors'
import { activity } from './activity'
import { DEFAULT_LIMITS } from './files'
import { notify, SYSTEM_ACTOR } from './notify'

/** Site-wide settings, each stored as one row in `settings`. Defaults apply when a row is missing. */
export const SITE_DEFAULTS = {
  site: { name: '', icon: 'doc' },
  file_limits: DEFAULT_LIMITS,
  grading_defaults: { timeoutSec: 300, memoryMb: 2048, dailyLimit: 10, maxBytes: 10 * 1024 * 1024 },
  note_template_zh: '',
  note_template_en: '',
}
export type SiteKey = keyof typeof SITE_DEFAULTS
export type SiteSettings = { [K in SiteKey]: (typeof SITE_DEFAULTS)[K] }

export function requireAdmin(ctx: Ctx) {
  if (!isAdmin(ctx.user)) throw notFound()
}

export async function readSettings(ctx: Pick<Ctx, 'db'>): Promise<SiteSettings> {
  const rows = await ctx.db.select().from(settings).all()
  const out = structuredClone(SITE_DEFAULTS) as SiteSettings
  for (const r of rows) {
    if (!(r.key in SITE_DEFAULTS)) continue
    const k = r.key as SiteKey
    const def = SITE_DEFAULTS[k]
    ;(out as Record<string, unknown>)[k] = typeof def === 'object' && def ? { ...def, ...(r.value as object) } : r.value
  }
  return out
}

export async function writeSetting<K extends SiteKey>(ctx: Ctx, key: K, value: SiteSettings[K]) {
  requireScope(ctx, 'manage')
  requireAdmin(ctx)
  await ctx.db.batch([
    ctx.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }),
    activity(ctx, { entityType: 'site', entityId: key, action: 'settings_changed', data: { key } }),
  ])
}

// ---------- usage ----------

const GB = 1024 ** 3
/** Cloudflare free-plan allowances this app depends on. GitHub Actions is unmetered for public repos. */
export const FREE = { storageBytes: 10 * GB, dbBytes: 5 * GB, requestsPerDay: 100_000 }
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)

// ponytail: per-isolate counter flushed at most once a minute — approximate (lost if an isolate is
// evicted before flushing), but one D1 write a minute instead of one per request. Swap for
// Workers Analytics Engine if exact counts matter.
let pending = 0
let lastFlush = 0
export function countRequest(db: Ctx['db'], waitUntil: (p: Promise<unknown>) => void, now = Date.now()) {
  pending++
  if (now - lastFlush < 60_000) return
  const n = pending
  pending = 0
  lastFlush = now
  waitUntil(
    db
      .insert(usageDaily)
      .values({ day: today(now), requests: n })
      .onConflictDoUpdate({ target: usageDaily.day, set: { requests: sql`${usageDaily.requests} + ${n}` } })
      .run()
      .catch(() => undefined),
  )
}

export async function usage(ctx: Pick<Ctx, 'db' | 'env'>) {
  const month = new Date()
  month.setUTCDate(1)
  month.setUTCHours(0, 0, 0, 0)
  const [storage, top, grading, req, size] = await Promise.all([
    ctx.db.select({ n: sql<number>`coalesce(sum(${files.size}), 0)` }).from(files).where(isNull(files.deletedAt)).get(),
    ctx.db
      .select({ userId: files.ownerId, name: users.name, bytes: sql<number>`sum(${files.size})` })
      .from(files)
      .innerJoin(users, eq(users.id, files.ownerId))
      .where(isNull(files.deletedAt))
      .groupBy(files.ownerId)
      .orderBy(desc(sql`sum(${files.size})`))
      .limit(10)
      .all(),
    ctx.db
      .select({ n: sql<number>`count(*)`, ms: sql<number>`coalesce(sum(${submissions.finishedAt} - ${submissions.startedAt}), 0)` })
      .from(submissions)
      .where(and(gte(submissions.createdAt, month.getTime()), isNotNull(submissions.startedAt)))
      .get(),
    ctx.db.select().from(usageDaily).where(eq(usageDaily.day, today())).get(),
    ctx.env.DB.prepare('select 1').run(),
  ])
  const pct = (v: number, max: number) => Math.round((v / max) * 1000) / 10
  const items = {
    storage: { used: storage?.n ?? 0, limit: FREE.storageBytes, pct: pct(storage?.n ?? 0, FREE.storageBytes) },
    database: { used: size.meta.size_after ?? 0, limit: FREE.dbBytes, pct: pct(size.meta.size_after ?? 0, FREE.dbBytes) },
    requests: { used: req?.requests ?? 0, limit: FREE.requestsPerDay, pct: pct(req?.requests ?? 0, FREE.requestsPerDay) },
  }
  return { ...items, grading: { runs: grading?.n ?? 0, ms: grading?.ms ?? 0 }, topStorage: top, warn: Object.entries(items).filter(([, v]) => v.pct >= 80).map(([k]) => k) }
}

/** Run from the periodic sweep: tells owners once a day per metric when one passes 80%. */
export async function alertUsage(ctx: Pick<Ctx, 'db' | 'env' | 'waitUntil'>) {
  const u = await usage(ctx)
  if (!u.warn.length) return
  const owners = await ctx.db.select().from(users).where(and(eq(users.role, 'owner'), eq(users.status, 'active'))).all()
  if (!owners.length) return
  const sys = { db: ctx.db, env: ctx.env, user: { ...owners[0]!, id: SYSTEM_ACTOR }, source: 'system' as const, requestId: '', origin: '', waitUntil: ctx.waitUntil } as Ctx
  for (const metric of u.warn) {
    const key = `usage_alert:${metric}:${today()}`
    const done = await ctx.db.insert(settings).values({ key, value: true }).onConflictDoNothing().run()
    if (!done.meta.changes) continue
    const pct = u[metric as 'storage' | 'database' | 'requests'].pct
    notify(sys, owners.map((o) => o.id), { type: 'usage_high', entityType: 'site', entityId: metric, data: { metric, pct: String(pct) } })
  }
}
