import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, C } from '../context'
import { body, ctxOf, parse } from '../context'
import { users } from '../db/schema'
import { addComment, deleteComment, editComment, listComments, resolveComment } from '../services/note-comments'
import {
  canEditNote,
  createNote,
  deleteNote,
  docRoom,
  getNote,
  getVersion,
  listNotes,
  listVersions,
  noteAuthors,
  noteDto,
  noteMarkdown,
  restoreVersion,
  updateNote,
} from '../services/notes'

export const noteRoutes = new Hono<AppEnv>()

const absentee = z.object({ userId: z.string().optional(), name: z.string().max(40).optional(), reason: z.string().max(100).optional() })
const fields = {
  title: z.string().trim().min(1).max(120),
  startsAt: z.number().int(),
  endsAt: z.number().int().nullable().optional(),
  location: z.string().max(500).optional(),
  recorderId: z.string().optional(),
  attendeeIds: z.array(z.string()).max(100).optional(),
  absentees: z.array(absentee).max(100).optional(),
  projectId: z.string().nullable().optional(),
  visibility: z.enum(['site', 'project']).optional(),
}
const locale = (c: { req: { header(n: string): string | undefined } }) => (c.req.header('x-locale') === 'en' ? 'en' : 'zh')

noteRoutes.get('/notes', async (c) => {
  const q = parse(
    z.object({
      q: z.string().max(100).optional(),
      from: z.coerce.number().int().optional(),
      to: z.coerce.number().int().optional(),
      projectId: z.string().optional(),
      recorderId: z.string().optional(),
      attendeeId: z.string().optional(),
      openComments: z.coerce.boolean().optional(),
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(200).default(30),
    }),
    c.req.query(),
  )
  return c.json(await listNotes(ctxOf(c), q))
})

noteRoutes.post('/notes', async (c) => {
  const input = await body(c, z.object(fields))
  const ctx = ctxOf(c)
  return c.json({ note: await noteDto(ctx, await createNote(ctx, input, locale(c))) }, 201)
})

noteRoutes.get('/notes/:id', async (c) => {
  const ctx = ctxOf(c)
  return c.json({ note: await noteDto(ctx, await getNote(ctx, c.req.param('id'))) })
})

noteRoutes.get('/notes/:id/markdown', async (c) => {
  const ctx = ctxOf(c)
  const n = await getNote(ctx, c.req.param('id'))
  const names = new Map((await ctx.db.select({ id: users.id, name: users.name }).from(users).all()).map((u) => [u.id, u.name]))
  return c.text(await noteMarkdown(ctx, n, names, locale(c)), 200, { 'content-type': 'text/markdown; charset=utf-8' })
})

noteRoutes.patch('/notes/:id', async (c) => {
  const { version, ...patch } = await body(c, z.object({ version: z.number().int(), ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])) }))
  const ctx = ctxOf(c)
  return c.json({ note: await noteDto(ctx, await updateNote(ctx, c.req.param('id'), version as number, patch)) })
})

noteRoutes.delete('/notes/:id', async (c) => {
  await deleteNote(ctxOf(c), c.req.param('id'))
  return c.json({ ok: true })
})

noteRoutes.get('/notes/:id/authors', async (c) => c.json({ clients: await noteAuthors(ctxOf(c), c.req.param('id')) }))

noteRoutes.get('/notes/:id/versions', async (c) => {
  const q = parse(z.object({ before: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }), c.req.query())
  return c.json(await listVersions(ctxOf(c), c.req.param('id'), q.before, q.limit))
})

noteRoutes.get('/notes/:id/versions/:vid', async (c) => c.json({ version: await getVersion(ctxOf(c), c.req.param('id'), c.req.param('vid')) }))

noteRoutes.post('/notes/:id/versions/:vid/restore', async (c) => {
  await restoreVersion(ctxOf(c), c.req.param('id'), c.req.param('vid'))
  return c.json({ ok: true })
})

// ---------- comments ----------

noteRoutes.get('/notes/:id/comments', async (c) => c.json({ items: await listComments(ctxOf(c), c.req.param('id')) }))

noteRoutes.post('/notes/:id/comments', async (c) => {
  const input = await body(
    c,
    z.object({
      body: z.string().trim().min(1).max(10_000),
      parentId: z.string().optional(),
      anchor: z.object({ start: z.string().max(200), end: z.string().max(200) }).optional(),
      quote: z.string().max(2000).optional(),
    }),
  )
  return c.json({ comment: await addComment(ctxOf(c), c.req.param('id'), input) }, 201)
})

noteRoutes.patch('/notes/:id/comments/:cid', async (c) => {
  const input = await body(c, z.object({ body: z.string().trim().min(1).max(10_000).optional(), resolved: z.boolean().optional() }))
  const ctx = ctxOf(c)
  const [id, cid] = [c.req.param('id'), c.req.param('cid')]
  if (input.resolved !== undefined) return c.json({ comment: await resolveComment(ctx, id, cid, input.resolved) })
  return c.json({ comment: await editComment(ctx, id, cid, input.body ?? '') })
})

noteRoutes.delete('/notes/:id/comments/:cid', async (c) => {
  await deleteComment(ctxOf(c), c.req.param('id'), c.req.param('cid'))
  return c.json({ ok: true })
})

// ---------- realtime ----------

/** Authenticates, then hands the socket to the note's Durable Object with the caller's identity. */
export async function noteSocket(c: C) {
  const ctx = ctxOf(c)
  const id = c.req.param('id') ?? ''
  const n = await getNote(ctx, id)
  const headers = new Headers(c.req.raw.headers)
  headers.set('x-note-id', id)
  headers.set('x-user-id', ctx.user.id)
  headers.set('x-can-edit', canEditNote(ctx, n) ? '1' : '0')
  return docRoom(c.env, id).fetch(new Request(c.req.url, { headers }))
}
