import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../context'
import { body, ctxOf, isAdmin, parse } from '../context'
import { notFound } from '../lib/errors'
import { listActivity } from '../services/activity'
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

adminRoutes.get('/activity', async (c) => {
  const ctx = ctxOf(c)
  if (!isAdmin(ctx.user)) throw notFound()
  const q = parse(
    z.object({
      actorId: z.string().optional(),
      entityType: z.string().max(30).optional(),
      before: z.coerce.number().int().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
    c.req.query(),
  )
  return c.json(await listActivity(ctx, q, await visibleProjectIds(ctx)))
})
