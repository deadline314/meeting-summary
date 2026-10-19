import { and, desc, eq, gt } from 'drizzle-orm'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'
import type { AppEnv } from '../context'
import { body, ctxOf, isAdmin } from '../context'
import { sessions, users } from '../db/schema'
import { notFound } from '../lib/errors'
import { LAST_LOGIN_COOKIE, revokeOtherSessions } from '../services/auth'
import { createApiKey, listApiKeys, revokeApiKey } from '../services/api-keys'
import { readSettings } from '../services/site'
import { directory, hasAdminKey, redeemAdminKey, rotateAdminKey, updateMe, userDto } from '../services/users'
import { devLoginEnabled } from './auth'

export const meRoutes = new Hono<AppEnv>()

const name = z.string().trim().min(1).max(40)
const prefs = z.object({
  locale: z.enum(['zh', 'en']).optional(),
  accent: z.enum(['indigo', 'emerald', 'amber', 'rose', 'slate']).optional(),
  mode: z.enum(['light', 'dark', 'system']).optional(),
})

// Public: what the login page needs.
meRoutes.get('/config', async (c) => {
  const site = (await readSettings({ db: c.get('db') })).site
  return c.json({ version: c.env.APP_VERSION, devLogin: devLoginEnabled(c), google: !!c.env.GOOGLE_CLIENT_ID, siteName: site.name, siteIcon: site.icon })
},
)

meRoutes.get('/auth/hint', async (c) => {
  const email = getCookie(c, LAST_LOGIN_COOKIE)
  if (!email) return c.json({ hint: null })
  const u = await c.get('db').select().from(users).where(eq(users.email, email)).get()
  return c.json({ hint: { email, name: u?.name ?? null, avatarUrl: u?.avatarUrl ?? null } })
})

meRoutes.get('/me', (c) => {
  const ctx = ctxOf(c)
  return c.json({ user: userDto(ctx.user) })
})

meRoutes.patch('/me', async (c) => {
  const input = await body(
    c,
    z.object({ name: name.optional(), avatarUrl: z.url().nullable().optional(), prefs: prefs.optional(), onboarded: z.boolean().optional() }),
  )
  return c.json({ user: await updateMe(ctxOf(c), input) })
})

meRoutes.get('/me/sessions', async (c) => {
  const ctx = ctxOf(c)
  const rows = await ctx.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, ctx.user.id), gt(sessions.expiresAt, Date.now())))
    .orderBy(desc(sessions.lastUsedAt))
    .all()
  const current = c.get('sessionId')
  return c.json({
    items: rows.map((s) => ({ id: s.id, userAgent: s.userAgent, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt, current: s.id === current })),
  })
})

meRoutes.delete('/me/sessions/:id', async (c) => {
  const ctx = ctxOf(c)
  await ctx.db.delete(sessions).where(and(eq(sessions.id, c.req.param('id')), eq(sessions.userId, ctx.user.id)))
  return c.json({ ok: true })
})

meRoutes.delete('/me/sessions', async (c) => {
  const ctx = ctxOf(c)
  await revokeOtherSessions(ctx.db, ctx.user.id, c.get('sessionId') ?? '')
  return c.json({ ok: true })
})

meRoutes.post('/me/admin-key', async (c) => {
  const { key } = await body(c, z.object({ key: z.string().min(1).max(200) }))
  return c.json({ user: await redeemAdminKey(ctxOf(c), key) })
})

meRoutes.get('/users', async (c) => c.json({ items: await directory(ctxOf(c)) }))

meRoutes.get('/admin/admin-key', async (c) => {
  const ctx = ctxOf(c)
  if (!isAdmin(ctx.user)) throw notFound()
  return c.json({ configured: await hasAdminKey(ctx) })
})

meRoutes.post('/admin/admin-key/rotate', async (c) => c.json({ key: await rotateAdminKey(ctxOf(c)) }))

meRoutes.get('/me/api-keys', async (c) => c.json({ items: await listApiKeys(ctxOf(c)) }))

meRoutes.post('/me/api-keys', async (c) => {
  const input = await body(
    c,
    z.object({
      name: z.string().trim().min(1).max(60),
      scope: z.enum(['read', 'write', 'manage']),
      projectIds: z.array(z.string()).max(50).nullable().optional(),
      expiresAt: z.number().int().nullable().optional(),
    }),
  )
  return c.json(await createApiKey(ctxOf(c), input), 201)
})

meRoutes.delete('/me/api-keys/:id', async (c) => {
  await revokeApiKey(ctxOf(c), c.req.param('id'))
  return c.json({ ok: true })
})
