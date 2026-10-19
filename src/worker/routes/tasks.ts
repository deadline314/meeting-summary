import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../context'
import { body, ctxOf, parse } from '../context'
import { badRequest } from '../lib/errors'
import { authenticateRunner, claim, jobFile, submitResult } from '../services/grader'
import { notesMentioning } from '../services/notes'
import { bestOf, createTask, getTask, leaderboard, listSubmissions, listTasks, submit, taskDto, taskOverview, updateTask } from '../services/tasks'
import { refResolvers, slices } from './home'
import { and, eq } from 'drizzle-orm'
import { submissions } from '../db/schema'

export const taskRoutes = new Hono<AppEnv>()

const MB = 1024 * 1024
const fields = {
  title: z.string().trim().min(1).max(120),
  description: z.string().max(100_000).optional(),
  opensAt: z.number().int().nullable().optional(),
  dueAt: z.number().int().nullable().optional(),
  projectId: z.string().nullable().optional(),
  submitKind: z.enum(['file', 'code']).optional(),
  accept: z.string().max(200).optional(),
  maxBytes: z.number().int().min(1024).max(100 * MB).optional(),
  dailyLimit: z.number().int().min(1).max(1000).optional(),
  leaderboard: z.boolean().optional(),
  higherIsBetter: z.boolean().optional(),
  image: z.string().regex(/^[\w./:-]+$/, 'Docker image name').max(200).optional(),
  requirements: z.string().max(5000).optional(),
  timeoutSec: z.number().int().min(10).max(6 * 3600).optional(),
  memoryMb: z.number().int().min(128).max(16384).optional(),
  graderFileId: z.string().nullable().optional(),
  dataFileId: z.string().nullable().optional(),
}

taskRoutes.get('/tasks', async (c) => c.json({ items: await listTasks(ctxOf(c)) }))

taskRoutes.post('/tasks', async (c) => {
  const ctx = ctxOf(c)
  return c.json({ task: taskDto(ctx, await createTask(ctx, await body(c, z.object(fields)))) }, 201)
})

taskRoutes.get('/tasks/:id', async (c) => {
  const ctx = ctxOf(c)
  const task = await getTask(ctx, c.req.param('id'))
  return c.json({ task: taskDto(ctx, task), mentionedIn: await notesMentioning(ctx, `#[task:${task.id}]`) })
})

taskRoutes.patch('/tasks/:id', async (c) => {
  const ctx = ctxOf(c)
  const partial = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()]))
  const { version, ...patch } = await body(
    c,
    z.object({ version: z.number().int(), status: z.enum(['draft', 'published', 'archived']).optional(), regradeAll: z.boolean().optional(), ...partial }),
  )
  return c.json({ task: taskDto(ctx, await updateTask(ctx, c.req.param('id'), version as number, patch)) })
})

/** Raw-body submission (file) — or `?code=1` with the code as the body. */
taskRoutes.post('/tasks/:id/submissions', async (c) => {
  const ctx = ctxOf(c)
  const size = Number(c.req.header('content-length'))
  const stream = c.req.raw.body
  if (!stream || !Number.isFinite(size) || size <= 0) throw badRequest('Content-Length and a body are required')
  const name = decodeURIComponent(c.req.header('x-file-name') ?? 'submission')
  const mime = (c.req.header('content-type') ?? 'application/octet-stream').split(';')[0]!
  const s = await submit(ctx, c.req.param('id'), { name, mime, size, body: stream, trial: c.req.query('trial') === '1' })
  return c.json({ submission: s }, 201)
})

taskRoutes.get('/tasks/:id/submissions', async (c) => {
  const q = parse(z.object({ all: z.coerce.boolean().optional(), trial: z.enum(['0', '1']).optional() }), c.req.query())
  const r = await listSubmissions(ctxOf(c), c.req.param('id'), { all: !!q.all, trial: q.trial === undefined ? undefined : q.trial === '1' })
  return c.json({ items: r.items })
})

taskRoutes.get('/tasks/:id/leaderboard', async (c) => c.json({ items: await leaderboard(ctxOf(c), c.req.param('id')) }))
taskRoutes.get('/tasks/:id/overview', async (c) => c.json(await taskOverview(ctxOf(c), c.req.param('id'))))

/** CSV of every student's best result (admin). */
taskRoutes.get('/tasks/:id/export.csv', async (c) => {
  const ctx = ctxOf(c)
  const o = await taskOverview(ctx, c.req.param('id'))
  const names = new Map((await ctx.db.query.users.findMany({ columns: { id: true, name: true, email: true } })).map((u) => [u.id, u]))
  const esc = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`
  const rows = [['name', 'email', 'best_status', 'best_score', 'attempts']]
  for (const p of o.perUser) rows.push([names.get(p.userId)?.name ?? '', names.get(p.userId)?.email ?? '', p.best?.status ?? '', String(p.best?.score ?? ''), String(p.attempts)])
  for (const id of o.notSubmitted) rows.push([names.get(id)?.name ?? '', names.get(id)?.email ?? '', 'not_submitted', '', '0'])
  return c.body('﻿' + rows.map((r) => r.map(esc).join(',')).join('\n'), 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="results.csv"',
  })
})

// ---------- runner protocol (no session; runner-authenticated) ----------

export const graderRoutes = new Hono<AppEnv>()

const result = z.object({
  status: z.enum(['passed', 'failed', 'error', 'timeout']),
  score: z.number().finite().nullable().default(null),
  message: z.string().max(4000).nullable().default(null),
  details: z.array(z.object({ name: z.string().max(200), passed: z.boolean(), message: z.string().max(1000).optional() })).max(500).nullable().default(null),
  log: z.string().max(100_000).nullable().default(null),
})

graderRoutes.post('/claim', async (c) => {
  const who = await authenticateRunner(c.env, c.req.header('authorization'))
  const { job } = await body(c, z.object({ job: z.string().nullable().default(null) }))
  return c.json({ job: await claim(c.env, who, job) })
})

graderRoutes.get('/jobs/:id/:kind', async (c) => {
  const who = await authenticateRunner(c.env, c.req.header('authorization'))
  const kind = parse(z.enum(['grader', 'data', 'submission']), c.req.param('kind'))
  return jobFile(c.env, who, c.req.param('id'), kind)
})

graderRoutes.post('/jobs/:id/result', async (c) => {
  const who = await authenticateRunner(c.env, c.req.header('authorization'))
  await submitResult(c.env, who, c.req.param('id'), await body(c, result), (p) => c.executionCtx.waitUntil(p))
  return c.json({ ok: true })
})

// ---------- dashboard, search and #[task:id] pills ----------

slices.push({
  async home(ctx) {
    const now = Date.now()
    const all = await listTasks(ctx)
    return { tasks: all.filter((t) => t.status === 'published' && (!t.dueAt || t.dueAt > now)).slice(0, 5) }
  },
  async search(ctx, q) {
    const needle = q.toLowerCase()
    return (await listTasks(ctx))
      .filter((t) => t.title.toLowerCase().includes(needle))
      .slice(0, 6)
      .map((t) => ({ type: 'task' as const, id: t.id, title: t.title, href: `/tasks/${t.id}` }))
  },
})

refResolvers.task = async (ctx, id) => {
  const t = await getTask(ctx, id)
  const mine = await ctx.db
    .select({ status: submissions.status, score: submissions.score, createdAt: submissions.createdAt })
    .from(submissions)
    .where(and(eq(submissions.taskId, id), eq(submissions.userId, ctx.user.id), eq(submissions.isTrial, false)))
    .all()
  const best = bestOf(t, mine)
  return { title: t.title, href: `/tasks/${id}`, best: best ? { status: best.status, score: best.score } : null }
}
