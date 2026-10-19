import { and, desc, isNull, like, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, Ctx } from '../context'
import { ctxOf, parse } from '../context'
import { notes } from '../db/schema'
import { visibleProjectIds } from '../services/projects'

export const homeRoutes = new Hono<AppEnv>()

type Hit = { type: 'note' | 'task' | 'issue'; id: string; title: string; subtitle?: string; href: string }
type Slice = { home?: (ctx: Ctx) => Promise<Record<string, unknown>>; search?: (ctx: Ctx, q: string) => Promise<Hit[]> }

/** Modules register a slice of the personal dashboard and of global search. */
export const slices: Slice[] = [
  {
    async home(ctx) {
      const rows = await ctx.db
        .select({ id: notes.id, title: notes.title, startsAt: notes.startsAt, attendeeIds: notes.attendeeIds })
        .from(notes)
        .where(
          and(
            isNull(notes.deletedAt),
            or(
              sql`${notes.createdBy} = ${ctx.user.id}`,
              sql`${notes.recorderId} = ${ctx.user.id}`,
              sql`exists (select 1 from json_each(${notes.attendeeIds}) where value = ${ctx.user.id})`,
            ),
          ),
        )
        .orderBy(desc(notes.startsAt))
        .limit(5)
        .all()
      return { notes: rows }
    },
    async search(ctx, q) {
      const rows = await ctx.db
        .select({ id: notes.id, title: notes.title, startsAt: notes.startsAt, visibility: notes.visibility, projectId: notes.projectId })
        .from(notes)
        .where(and(isNull(notes.deletedAt), or(like(notes.title, `%${q}%`), like(notes.content, `%${q}%`))))
        .orderBy(desc(notes.startsAt))
        .limit(10)
        .all()
      const visible = new Set(await visibleProjectIds(ctx))
      return rows
        .filter((r) => r.visibility === 'site' || !r.projectId || visible.has(r.projectId))
        .slice(0, 6)
        .map((r) => ({ type: 'note' as const, id: r.id, title: r.title, subtitle: new Date(r.startsAt).toISOString().slice(0, 10), href: `/notes/${r.id}` }))
    },
  },
]

homeRoutes.get('/home', async (c) => {
  const ctx = ctxOf(c)
  const parts = await Promise.all(slices.map((s) => s.home?.(ctx) ?? {}))
  return c.json(Object.assign({ notes: [], tasks: [], issues: [] }, ...parts))
})

homeRoutes.get('/search', async (c) => {
  const ctx = ctxOf(c)
  const { q } = parse(z.object({ q: z.string().trim().min(1).max(100) }), c.req.query())
  const parts = await Promise.all(slices.map((s) => s.search?.(ctx, q) ?? []))
  return c.json({ items: parts.flat() })
})
