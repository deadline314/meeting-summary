import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../context'
import { body, ctxOf, parse } from '../context'
import { badRequest } from '../lib/errors'
import { deleteFile, getFile, linkDriveFile, listFiles, readFileText, serveFile, uploadFile } from '../services/files'

export const fileRoutes = new Hono<AppEnv>()

const parentType = z.enum(['note', 'issue', 'task', 'task_asset', 'avatar'])

fileRoutes.get('/files', async (c) => {
  const q = parse(z.object({ parentType, parentId: z.string() }), c.req.query())
  return c.json({ items: await listFiles(ctxOf(c), q.parentType, q.parentId) })
})

/** Raw body upload: `PUT /api/files?parentType=note&parentId=…` with `x-file-name` and a Content-Length. */
fileRoutes.put('/files', async (c) => {
  const q = parse(z.object({ parentType, parentId: z.string() }), c.req.query())
  const size = Number(c.req.header('content-length'))
  const body = c.req.raw.body
  if (!body || !Number.isFinite(size) || size <= 0) throw badRequest('Content-Length and a body are required')
  const name = decodeURIComponent(c.req.header('x-file-name') ?? 'file')
  const mime = (c.req.header('content-type') ?? 'application/octet-stream').split(';')[0]!
  const file = await uploadFile(ctxOf(c), { ...q, name, mime, size, body })
  return c.json({ file }, 201)
})

fileRoutes.post('/files/drive', async (c) => {
  const input = await body(
    c,
    z.object({
      parentType,
      parentId: z.string(),
      name: z.string().min(1).max(200),
      mime: z.string().max(100).default('application/vnd.google-apps.file'),
      url: z.url().refine((u) => /^https:\/\/(drive|docs)\.google\.com\//.test(u), 'Must be a Google Drive link'),
    }),
  )
  return c.json({ file: await linkDriveFile(ctxOf(c), input) }, 201)
})

/** Text preview for code / notebooks (first 2 MB). */
fileRoutes.get('/files/:id/text', async (c) => {
  const ctx = ctxOf(c)
  const f = await getFile(ctx, c.req.param('id'))
  return c.text(await readFileText(ctx, f))
})

fileRoutes.delete('/files/:id', async (c) => {
  await deleteFile(ctxOf(c), c.req.param('id'))
  return c.json({ ok: true })
})

/** Mounted at /files/:id (not under /api) so Markdown image links stay short. */
export const rawFileRoute = new Hono<AppEnv>().get('/:id', async (c) => serveFile(ctxOf(c), c.req.param('id'), c.req.query('download') === '1'))
