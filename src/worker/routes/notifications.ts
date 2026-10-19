import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../context'
import { ctxOf, parse } from '../context'
import { notifications } from '../db/schema'

export const notificationRoutes = new Hono<AppEnv>()

notificationRoutes.get('/notifications', async (c) => {
  const ctx = ctxOf(c)
  const q = parse(z.object({ before: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }), c.req.query())
  const mine = eq(notifications.userId, ctx.user.id)
  const [items, unread] = await Promise.all([
    ctx.db
      .select()
      .from(notifications)
      .where(and(mine, q.before ? lt(notifications.createdAt, q.before) : undefined))
      .orderBy(desc(notifications.createdAt))
      .limit(q.limit)
      .all(),
    ctx.db.select({ n: sql<number>`count(*)` }).from(notifications).where(and(mine, isNull(notifications.readAt))).get(),
  ])
  return c.json({ items, unread: unread?.n ?? 0 })
})

notificationRoutes.post('/notifications/read', async (c) => {
  const ctx = ctxOf(c)
  const { ids } = parse(z.object({ ids: z.array(z.string()).max(100).optional() }), await c.req.json().catch(() => ({})))
  const mine = and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt))
  await ctx.db
    .update(notifications)
    .set({ readAt: Date.now() })
    .where(ids?.length ? and(mine, sql`${notifications.id} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`) : mine)
  return c.json({ ok: true })
})
