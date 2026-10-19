import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Ctx } from '../context'
import { isAdmin, requireScope } from '../context'
import { submissions, tasks, users, type ResultDetail } from '../db/schema'
import { newId } from '../lib/crypto'
import { AppError, conflict, notFound } from '../lib/errors'
import { activity } from './activity'
import { parentChecks, uploadFile } from './files'
import { SYSTEM_ACTOR, notify } from './notify'
import { readSettings } from './site'
import { visibleProjectIds } from './projects'
import { dispatchGrading } from './grader'

export type Task = typeof tasks.$inferSelect
export type Submission = typeof submissions.$inferSelect

export type TaskInput = {
  title: string
  description?: string
  opensAt?: number | null
  dueAt?: number | null
  projectId?: string | null
  submitKind?: 'file' | 'code'
  accept?: string
  maxBytes?: number
  dailyLimit?: number
  leaderboard?: boolean
  higherIsBetter?: boolean
  image?: string
  requirements?: string
  timeoutSec?: number
  memoryMb?: number
  graderFileId?: string | null
  dataFileId?: string | null
}

async function canSee(ctx: Ctx, t: Task) {
  if (isAdmin(ctx.user)) return true
  if (t.status !== 'published') return false
  return !t.projectId || (await visibleProjectIds(ctx)).includes(t.projectId)
}

export async function getTask(ctx: Ctx, id: string) {
  const t = await ctx.db.select().from(tasks).where(eq(tasks.id, id)).get()
  if (!t || !(await canSee(ctx, t))) throw notFound()
  return t
}

/** What students may see: no grader/data file ids. */
export function taskDto(ctx: Ctx, t: Task) {
  const admin = isAdmin(ctx.user)
  const now = Date.now()
  const open = t.status === 'published' && (!t.opensAt || t.opensAt <= now) && (!t.dueAt || t.dueAt > now)
  const base = { ...t, open, canManage: admin }
  if (admin) return base
  const { graderFileId: _g, dataFileId: _d, requirements: _r, ...pub } = base
  return pub
}

function requireAdmin(ctx: Ctx) {
  if (!isAdmin(ctx.user)) throw notFound()
}

export async function createTask(ctx: Ctx, input: TaskInput) {
  requireScope(ctx, 'write')
  requireAdmin(ctx)
  const def = (await readSettings(ctx)).grading_defaults
  const now = Date.now()
  const t: Task = {
    id: newId(),
    title: input.title,
    description: input.description ?? '',
    status: 'draft',
    opensAt: input.opensAt ?? null,
    dueAt: input.dueAt ?? null,
    projectId: input.projectId ?? null,
    submitKind: input.submitKind ?? 'file',
    accept: input.accept ?? '',
    maxBytes: input.maxBytes ?? def.maxBytes,
    dailyLimit: input.dailyLimit ?? def.dailyLimit,
    leaderboard: input.leaderboard ?? true,
    higherIsBetter: input.higherIsBetter ?? true,
    graderFileId: input.graderFileId ?? null,
    dataFileId: input.dataFileId ?? null,
    image: input.image ?? 'python:3.12-slim',
    requirements: input.requirements ?? '',
    timeoutSec: input.timeoutSec ?? def.timeoutSec,
    memoryMb: input.memoryMb ?? def.memoryMb,
    trialPassedAt: null,
    createdBy: ctx.user.id,
    createdAt: now,
    updatedAt: now,
    version: 1,
  }
  await ctx.db.batch([ctx.db.insert(tasks).values(t), activity(ctx, { entityType: 'task', entityId: t.id, action: 'created', data: { title: t.title } })])
  return t
}

const GRADING_FIELDS = ['graderFileId', 'dataFileId', 'image', 'requirements', 'timeoutSec', 'memoryMb'] as const

export async function updateTask(ctx: Ctx, id: string, version: number, patch: Partial<TaskInput> & { status?: Task['status']; regradeAll?: boolean }) {
  requireScope(ctx, 'write')
  requireAdmin(ctx)
  const t = await getTask(ctx, id)
  const { regradeAll, ...fields } = patch
  const gradingChanged = GRADING_FIELDS.some((k) => k in fields && fields[k] !== t[k])
  if (fields.status === 'published' && t.status !== 'published' && (!t.trialPassedAt || gradingChanged)) {
    throw new AppError('trial_required', 422, 'Run a passing trial submission first')
  }
  const next = { ...fields, ...(gradingChanged && { trialPassedAt: null }), updatedAt: Date.now(), version: t.version + 1 }
  const res = await ctx.db.batch([
    ctx.db.update(tasks).set(next).where(and(eq(tasks.id, id), eq(tasks.version, version))),
    activity(ctx, {
      entityType: 'task',
      entityId: id,
      action: fields.status === 'published' && t.status !== 'published' ? 'published' : 'updated',
      data: { title: fields.title ?? t.title },
    }),
  ])
  if (res[0].meta.changes === 0) throw conflict()
  const updated = { ...t, ...next } as Task
  if (regradeAll) await regrade(ctx, updated)
  return updated
}

async function regrade(ctx: Ctx, t: Task) {
  const rows = await ctx.db.select({ id: submissions.id }).from(submissions).where(and(eq(submissions.taskId, t.id), eq(submissions.isTrial, false))).all()
  if (!rows.length) return
  await ctx.db
    .update(submissions)
    .set({ status: 'queued', score: null, message: null, details: null, log: null, runId: null, startedAt: null, finishedAt: null })
    .where(inArray(submissions.id, rows.map((r) => r.id)))
  for (const r of rows) ctx.waitUntil(dispatchGrading(ctx.env, r.id, ctx.origin))
}

export async function listTasks(ctx: Ctx) {
  const admin = isAdmin(ctx.user)
  const visible = await visibleProjectIds(ctx)
  const rows = await ctx.db
    .select()
    .from(tasks)
    .where(
      admin
        ? sql`${tasks.status} != 'archived'`
        : and(eq(tasks.status, 'published'), or(isNull(tasks.projectId), visible.length ? inArray(tasks.projectId, visible) : sql`0`)),
    )
    .orderBy(desc(tasks.createdAt))
    .all()
  const mine = rows.length
    ? await ctx.db
        .select({ taskId: submissions.taskId, status: submissions.status, score: submissions.score, createdAt: submissions.createdAt })
        .from(submissions)
        .where(and(eq(submissions.userId, ctx.user.id), eq(submissions.isTrial, false), inArray(submissions.taskId, rows.map((r) => r.id))))
        .all()
    : []
  return rows.map((t) => ({ ...taskDto(ctx, t), best: bestOf(t, mine.filter((m) => m.taskId === t.id)) }))
}

type Scored = { status: string; score: number | null; createdAt: number }

/** Best = passed with the best score (ties → earliest); else the latest attempt. */
export function bestOf(t: Pick<Task, 'higherIsBetter'>, rows: Scored[]) {
  if (!rows.length) return null
  const passed = rows.filter((r) => r.status === 'passed')
  if (passed.length) {
    return [...passed].sort((a, b) => {
      const d = (b.score ?? -Infinity) - (a.score ?? -Infinity)
      return (t.higherIsBetter ? d : -d) || a.createdAt - b.createdAt
    })[0]!
  }
  return [...rows].sort((a, b) => b.createdAt - a.createdAt)[0]!
}

// ---------- submissions ----------

const DAY = 86400_000

export async function submit(ctx: Ctx, taskId: string, o: { name: string; mime: string; size: number; body: ReadableStream; trial?: boolean }) {
  requireScope(ctx, 'write')
  const t = await getTask(ctx, taskId)
  const trial = !!o.trial
  if (trial) requireAdmin(ctx)
  const now = Date.now()
  if (!trial) {
    const open = t.status === 'published' && (!t.opensAt || t.opensAt <= now) && (!t.dueAt || t.dueAt > now)
    if (!open) throw new AppError('submission_closed', 422, 'Task is not accepting submissions')
    const since = now - DAY
    const recent = await ctx.db
      .select({ createdAt: submissions.createdAt })
      .from(submissions)
      .where(and(eq(submissions.taskId, taskId), eq(submissions.userId, ctx.user.id), eq(submissions.isTrial, false), gte(submissions.createdAt, since)))
      .orderBy(asc(submissions.createdAt))
      .all()
    if (recent.length >= t.dailyLimit) {
      const nextAt = recent[0]!.createdAt + DAY
      throw new AppError('daily_limit', 429, 'Daily submission limit reached', { time: new Date(nextAt).toISOString() })
    }
  }
  if (o.size > t.maxBytes) throw new AppError('payload_too_large', 413, 'File too large', { limit: `${Math.round(t.maxBytes / 1024 / 1024)} MB` })
  if (t.accept && !trial) {
    const ok = t.accept.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).some((ext) => o.name.toLowerCase().endsWith(ext))
    if (!ok) throw new AppError('unsupported_type', 415, `Accepted: ${t.accept}`)
  }
  const id = newId()
  // The submission row exists (queued) before the file so the parent check can find it.
  await ctx.db.insert(submissions).values({ id, taskId, userId: ctx.user.id, fileId: '', isTrial: trial, status: 'queued', createdAt: now })
  try {
    const f = await uploadFile(ctx, { parentType: 'submission', parentId: id, name: o.name, mime: o.mime, size: o.size, body: o.body })
    await ctx.db.batch([
      ctx.db.update(submissions).set({ fileId: f.id }).where(eq(submissions.id, id)),
      activity(ctx, { entityType: 'submission', entityId: id, action: trial ? 'trial' : 'submitted', data: { taskId, title: t.title } }),
    ])
  } catch (err) {
    await ctx.db.delete(submissions).where(eq(submissions.id, id))
    throw err
  }
  ctx.waitUntil(dispatchGrading(ctx.env, id, ctx.origin))
  return (await ctx.db.select().from(submissions).where(eq(submissions.id, id)).get())!
}

export async function listSubmissions(ctx: Ctx, taskId: string, o: { all: boolean; trial?: boolean; limit?: number }) {
  const t = await getTask(ctx, taskId)
  if (o.all) requireAdmin(ctx)
  const where = and(
    eq(submissions.taskId, taskId),
    o.all ? undefined : eq(submissions.userId, ctx.user.id),
    o.trial === undefined ? undefined : eq(submissions.isTrial, o.trial),
  )
  const [rows, total] = await Promise.all([
    ctx.db.select().from(submissions).where(where).orderBy(desc(submissions.createdAt)).limit(o.limit ?? 50).all(),
    ctx.db.select({ n: sql<number>`count(*)` }).from(submissions).where(where).get(),
  ])
  return { task: t, items: rows, total: total?.n ?? 0 }
}

export async function leaderboard(ctx: Ctx, taskId: string, page: { offset: number; limit: number } = { offset: 0, limit: 50 }) {
  const t = await getTask(ctx, taskId)
  if (!t.leaderboard && !isAdmin(ctx.user)) throw notFound()
  const rows = await ctx.db
    .select({ userId: submissions.userId, status: submissions.status, score: submissions.score, createdAt: submissions.createdAt })
    .from(submissions)
    .where(and(eq(submissions.taskId, taskId), eq(submissions.isTrial, false), eq(submissions.status, 'passed')))
    .all()
  const by = new Map<string, Scored[]>()
  for (const r of rows) by.set(r.userId, [...(by.get(r.userId) ?? []), r])
  const entries = [...by].map(([userId, list]) => ({ userId, ...bestOf(t, list)!, attempts: list.length }))
  entries.sort((a, b) => {
    const d = (b.score ?? -Infinity) - (a.score ?? -Infinity)
    return (t.higherIsBetter ? d : -d) || a.createdAt - b.createdAt
  })
  const ranked = entries.map((e, i) => ({ rank: i + 1, ...e }))
  // One page, plus the caller's own row so it can be pinned when it falls outside the page.
  return { items: ranked.slice(page.offset, page.offset + page.limit), total: ranked.length, mine: ranked.find((r) => r.userId === ctx.user.id) ?? null }
}

/** Admin overview: per-student best, failure reasons, who hasn't submitted. */
export async function taskOverview(ctx: Ctx, taskId: string) {
  requireAdmin(ctx)
  const t = await getTask(ctx, taskId)
  const subs = await ctx.db.select().from(submissions).where(and(eq(submissions.taskId, taskId), eq(submissions.isTrial, false))).all()
  const students = await ctx.db.select({ id: users.id }).from(users).where(and(eq(users.role, 'student'), eq(users.status, 'active'))).all()
  const by = new Map<string, Submission[]>()
  for (const s of subs) by.set(s.userId, [...(by.get(s.userId) ?? []), s])
  const reasons = new Map<string, number>()
  for (const s of subs) if (s.status !== 'passed' && s.message) reasons.set(s.message, (reasons.get(s.message) ?? 0) + 1)
  return {
    perUser: [...by].map(([userId, list]) => ({ userId, best: bestOf(t, list), attempts: list.length })),
    notSubmitted: students.map((s) => s.id).filter((id) => !by.has(id)),
    reasons: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([message, count]) => ({ message, count })),
  }
}

// ---------- grading results (called by the grader route) ----------

export type GradeResult = { status: 'passed' | 'failed' | 'error' | 'timeout'; score: number | null; message: string | null; details: ResultDetail[] | null; log: string | null }

export async function recordResult(ctx: Pick<Ctx, 'db' | 'env' | 'waitUntil'>, submissionId: string, r: GradeResult) {
  const s = await ctx.db.select().from(submissions).where(eq(submissions.id, submissionId)).get()
  if (!s) throw notFound()
  const now = Date.now()
  await ctx.db.batch([
    ctx.db
      .update(submissions)
      .set({ status: r.status, score: r.score, message: r.message?.slice(0, 2000) ?? null, details: r.details?.slice(0, 200) ?? null, log: r.log?.slice(-20_000) ?? null, finishedAt: now })
      .where(eq(submissions.id, submissionId)),
    ...(s.isTrial && r.status === 'passed' ? [ctx.db.update(tasks).set({ trialPassedAt: now }).where(eq(tasks.id, s.taskId))] : []),
  ])
  const t = await ctx.db.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, s.taskId)).get()
  const user = await ctx.db.select().from(users).where(eq(users.id, s.userId)).get()
  if (user) {
    const sys = { db: ctx.db, env: ctx.env, user: { ...user, id: SYSTEM_ACTOR }, source: 'system' as const, requestId: '', origin: '', waitUntil: ctx.waitUntil }
    notify(sys, [s.userId], { type: 'submission_result', entityType: 'task', entityId: s.taskId, data: { submissionId, status: r.status, title: t?.title ?? '' } })
    await activity({ db: ctx.db, user, source: 'system' }, { entityType: 'submission', entityId: submissionId, action: r.status, data: { taskId: s.taskId, title: t?.title ?? '', score: r.score ?? '' } }).run()
  }
}

// Files attached to tasks: grader/data are admin-only; description assets follow task visibility.
parentChecks.task = async (ctx, id) => {
  requireAdmin(ctx)
  await getTask(ctx, id)
}
parentChecks.task_asset = async (ctx, id, mode) => {
  if (mode === 'write') requireAdmin(ctx)
  await getTask(ctx, id)
}
parentChecks.submission = async (ctx, id, mode) => {
  const s = await ctx.db.select().from(submissions).where(eq(submissions.id, id)).get()
  if (!s) throw notFound()
  if (mode === 'write' ? s.userId !== ctx.user.id : s.userId !== ctx.user.id && !isAdmin(ctx.user)) throw notFound()
}

