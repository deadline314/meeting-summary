import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../context'
import { body, ctxOf, isAdmin, parse } from '../context'
import { notFound } from '../lib/errors'
import { listActivity, type ActivityQuery } from '../services/activity'
import { memberOverview } from '../services/member-overview'
import { SITE_DEFAULTS, readSettings, requireAdmin, usage, writeSetting, type SiteKey } from '../services/site'
import { users } from '../db/schema'
import { visibleProjectIds } from '../services/projects'
import { listMembers, setMember } from '../services/users'

export const adminRoutes = new Hono<AppEnv>()

const role = z.enum(['student', 'admin', 'owner'])

adminRoutes.get('/members', async (c) => {
  const q = parse(
    z.object({
      search: z.string().max(100).optional(),
      role: role.optional(),
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
    c.req.query(),
  )
  return c.json(await listMembers(ctxOf(c), q))
})

adminRoutes.patch('/members/:id', async (c) => {
  const input = await body(c, z.object({ role: role.optional(), status: z.enum(['active', 'disabled', 'removed']).optional() }))
  return c.json({ user: await setMember(ctxOf(c), c.req.param('id'), input) })
})

const activityFilter = z.object({
  actor: z.string().optional(),
  type: z.string().max(30).optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  before: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
const toQuery = (q: z.infer<typeof activityFilter>): ActivityQuery => ({ actorId: q.actor, entityType: q.type, from: q.from, to: q.to, before: q.before, limit: q.limit })

adminRoutes.get('/activity', async (c) => {
  const ctx = ctxOf(c)
  if (!isAdmin(ctx.user)) throw notFound()
  return c.json(await listActivity(ctx, toQuery(parse(activityFilter, c.req.query())), await visibleProjectIds(ctx)))
})

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v)
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

/** Same filters as the feed, streamed page by page so 10k+ rows never sit in memory at once. */
adminRoutes.get('/activity.csv', async (c) => {
  const ctx = ctxOf(c)
  if (!isAdmin(ctx.user)) throw notFound()
  const base = toQuery(parse(activityFilter, c.req.query()))
  const visible = await visibleProjectIds(ctx)
  const names = new Map((await ctx.db.select({ id: users.id, name: users.name, email: users.email }).from(users).all()).map((u) => [u.id, u]))
  const enc = new TextEncoder()
  let before = base.before
  let sent = 0
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(enc.encode('﻿time,actor,email,module,action,target,source,details\n'))
    },
    async pull(ctrl) {
      const page = await listActivity(ctx, { ...base, before, limit: 100 }, visible)
      for (const a of page.items) {
        const u = a.actorId ? names.get(a.actorId) : undefined
        const d = a.data as Record<string, unknown>
        const target = d.ref ?? d.title ?? d.key ?? d.name ?? a.entityId
        ctrl.enqueue(enc.encode([new Date(a.createdAt).toISOString(), u?.name, u?.email, a.entityType, a.action, target, a.source, d].map(csvCell).join(',') + '\n'))
      }
      sent += page.items.length
      before = page.nextBefore ?? undefined
      if (!page.nextBefore || sent >= 100_000) ctrl.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="activity-${new Date().toISOString().slice(0, 10)}.csv"` } })
})

adminRoutes.get('/members/:id/overview', async (c) => {
  const { tz } = parse(z.object({ tz: z.coerce.number().int().min(-840).max(840).default(0) }), c.req.query())
  return c.json(await memberOverview(ctxOf(c), c.req.param('id'), tz))
})

adminRoutes.get('/usage', async (c) => {
  const ctx = ctxOf(c)
  requireAdmin(ctx)
  return c.json(await usage(ctx))
})

adminRoutes.get('/settings', async (c) => {
  const ctx = ctxOf(c)
  requireAdmin(ctx)
  return c.json(await readSettings(ctx))
})

const MB = 1024 * 1024
const settingSchemas: { [K in SiteKey]: z.ZodType<(typeof SITE_DEFAULTS)[K]> } = {
  site: z.object({ name: z.string().trim().max(40), icon: z.enum(['doc', 'flask', 'cap', 'microscope', 'book', 'atom', 'brain', 'cpu']) }),
  file_limits: z.object({ maxFileBytes: z.number().int().min(MB).max(100 * MB), quotaBytes: z.number().int().min(10 * MB).max(10 * 1024 * MB) }),
  grading_defaults: z.object({
    timeoutSec: z.number().int().min(10).max(3600),
    memoryMb: z.number().int().min(256).max(14336),
    dailyLimit: z.number().int().min(1).max(100),
    maxBytes: z.number().int().min(MB).max(100 * MB),
  }),
  note_template_zh: z.string().max(20_000),
  note_template_en: z.string().max(20_000),
}

adminRoutes.put('/settings/:key', async (c) => {
  const key = c.req.param('key') as SiteKey
  if (!(key in settingSchemas)) throw notFound()
  const { value } = await body(c, z.object({ value: settingSchemas[key] }))
  await writeSetting(ctxOf(c), key, value as never)
  return c.json({ ok: true })
})
