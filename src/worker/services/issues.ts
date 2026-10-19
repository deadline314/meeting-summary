import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, like, lt, or, sql, type SQL } from 'drizzle-orm'
import type { Ctx } from '../context'
import { isAdmin, requireScope } from '../context'
import { ISSUE_PRIORITIES, ISSUE_STATUSES, activities, files, idempotency, issueSubscriptions, issueAssignees, issueComments, issueLabels, issueRelations, issues, labels, projects, references } from '../db/schema'
import { newId } from '../lib/crypto'
import { AppError, badRequest, conflict, notFound } from '../lib/errors'
import { activity } from './activity'
import { limits, parentChecks, usedBytes } from './files'
import { mentionedUserIds, notify } from './notify'
import { notesMentioning } from './notes'
import { access, need, requireActive, userCanSee, visibleProjectIds, type Access, type Project } from './projects'

export type Issue = typeof issues.$inferSelect
export type Status = (typeof ISSUE_STATUSES)[number]
export type Priority = (typeof ISSUE_PRIORITIES)[number]
const DONE: Status[] = ['done', 'canceled']
const MAX_DEPTH = 10

export function parseRef(ref: string) {
  const m = /^([A-Za-z]{2,6})-(\d+)$/.exec(ref.trim())
  if (!m) throw notFound()
  return { key: m[1]!.toUpperCase(), number: Number(m[2]) }
}

/** Runs `fn` once per (user, operationId): retries of the same external write return the first result. */
export async function idempotent<T>(ctx: Ctx, operationId: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (!operationId) return fn()
  const key = `${ctx.user.id}:${operationId}`
  const prev = await ctx.db.select().from(idempotency).where(eq(idempotency.key, key)).get()
  if (prev) return prev.response as T
  const out = await fn()
  await ctx.db.insert(idempotency).values({ key, response: out as unknown, createdAt: Date.now() }).onConflictDoNothing()
  return out
}

export async function getIssue(ctx: Ctx, ref: string) {
  const { key, number } = parseRef(ref)
  const { project, role } = await access(ctx, { key })
  const issue = await ctx.db
    .select()
    .from(issues)
    .where(and(eq(issues.projectId, project.id), eq(issues.number, number), isNull(issues.deletedAt)))
    .get()
  if (!issue) throw notFound()
  return { issue, project, role }
}

const refOf = (p: Pick<Project, 'key'>, i: Pick<Issue, 'number'>) => `${p.key}-${i.number}`

// ---------- subscriptions ----------

const subscribeOps = (ctx: Ctx, issueId: string, userIds: string[]) =>
  [...new Set(userIds)].map((userId) => ctx.db.insert(issueSubscriptions).values({ issueId, userId }).onConflictDoNothing())

async function subscribers(ctx: Ctx, issueId: string) {
  return (await ctx.db.select({ userId: issueSubscriptions.userId }).from(issueSubscriptions).where(eq(issueSubscriptions.issueId, issueId)).all()).map((r) => r.userId)
}

export async function setSubscribed(ctx: Ctx, ref: string, on: boolean) {
  const { issue } = await getIssue(ctx, ref)
  if (on) await ctx.db.insert(issueSubscriptions).values({ issueId: issue.id, userId: ctx.user.id }).onConflictDoNothing()
  else await ctx.db.delete(issueSubscriptions).where(and(eq(issueSubscriptions.issueId, issue.id), eq(issueSubscriptions.userId, ctx.user.id)))
  return { subscribed: on }
}

// ---------- read models ----------

/** Adds assignees, labels, open blockers, parent and sub-issue progress to a page of issues. */
export async function hydrate(ctx: Ctx, rows: Issue[], keyById: Map<string, string>) {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const [assignees, labelRows, blockers, children, parents] = await Promise.all([
    ctx.db.select().from(issueAssignees).where(inArray(issueAssignees.issueId, ids)).orderBy(asc(issueAssignees.position)).all(),
    ctx.db
      .select({ issueId: issueLabels.issueId, id: labels.id, name: labels.name, color: labels.color })
      .from(issueLabels)
      .innerJoin(labels, eq(labels.id, issueLabels.labelId))
      .where(inArray(issueLabels.issueId, ids))
      .all(),
    // "blocked by" is derived from `blocks` edges, and only unfinished blockers count.
    ctx.db
      .select({ toId: issueRelations.toId, id: issues.id, number: issues.number, title: issues.title, projectId: issues.projectId })
      .from(issueRelations)
      .innerJoin(issues, eq(issues.id, issueRelations.fromId))
      .where(and(inArray(issueRelations.toId, ids), eq(issueRelations.type, 'blocks'), sql`${issues.status} not in ('done','canceled')`, isNull(issues.deletedAt)))
      .all(),
    ctx.db
      .select({ parentId: issues.parentId, done: sql<number>`sum(case when ${issues.status} in ('done','canceled') then 1 else 0 end)`, total: sql<number>`count(*)` })
      .from(issues)
      .where(and(inArray(issues.parentId, ids), isNull(issues.deletedAt)))
      .groupBy(issues.parentId)
      .all(),
    ctx.db
      .select({ id: issues.id, number: issues.number, title: issues.title, projectId: issues.projectId })
      .from(issues)
      .where(inArray(issues.id, rows.map((r) => r.parentId).filter((x): x is string => !!x)))
      .all(),
  ])
  const keyOf = (pid: string) => keyById.get(pid) ?? '?'
  return rows.map((r) => {
    const parent = parents.find((p) => p.id === r.parentId)
    const sub = children.find((c) => c.parentId === r.id)
    return {
      ...r,
      ref: `${keyOf(r.projectId)}-${r.number}`,
      projectKey: keyOf(r.projectId),
      assigneeIds: assignees.filter((a) => a.issueId === r.id).map((a) => a.userId),
      labels: labelRows.filter((l) => l.issueId === r.id).map(({ issueId: _i, ...l }) => l),
      blockedBy: blockers.filter((b) => b.toId === r.id).map((b) => ({ ref: `${keyOf(b.projectId)}-${b.number}`, title: b.title })),
      parent: parent ? { ref: `${keyOf(parent.projectId)}-${parent.number}`, title: parent.title } : null,
      subProgress: sub ? { done: Number(sub.done), total: Number(sub.total) } : null,
    }
  })
}

async function keyMap(ctx: Ctx, projectIds: string[]) {
  if (!projectIds.length) return new Map<string, string>()
  const rows = await ctx.db.select({ id: projects.id, key: projects.key }).from(projects).where(inArray(projects.id, projectIds)).all()
  return new Map(rows.map((r) => [r.id, r.key]))
}

export type IssueFilter = {
  status?: Status
  assigneeId?: string
  priority?: Priority
  labelId?: string
  q?: string
  sort?: 'manual' | 'created' | 'updated' | 'priority' | 'due'
  /** overdue = past due and unfinished; week = due within 7 days; none = no due date. */
  due?: 'overdue' | 'week' | 'none'
  doneSince?: number
  offset: number
  limit: number
}

const PRIORITY_RANK = sql`case ${issues.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`

async function scopeProjects(ctx: Ctx, scope: { key?: string; mine?: boolean }) {
  return scope.key ? [(await access(ctx, { key: scope.key })).project.id] : visibleProjectIds(ctx)
}

function issueWhere(ctx: Ctx, projectIds: string[], scope: { mine?: boolean }, f: Omit<IssueFilter, 'offset' | 'limit'>) {
  return and(
    inArray(issues.projectId, projectIds),
    isNull(issues.deletedAt),
    f.status ? eq(issues.status, f.status) : undefined,
    f.priority ? eq(issues.priority, f.priority) : undefined,
    scope.mine ? sql`exists (select 1 from issue_assignees a where a.issue_id = ${issues.id} and a.user_id = ${ctx.user.id})` : undefined,
    f.assigneeId ? sql`exists (select 1 from issue_assignees a where a.issue_id = ${issues.id} and a.user_id = ${f.assigneeId})` : undefined,
    f.labelId ? sql`exists (select 1 from issue_labels l where l.issue_id = ${issues.id} and l.label_id = ${f.labelId})` : undefined,
    // Words match title or description; "KEY-12" (or "12") also matches the issue number.
    f.q
      ? or(
          like(issues.title, `%${f.q}%`),
          like(issues.description, `%${f.q}%`),
          sql`((select key from projects p where p.id = ${issues.projectId}) || '-' || ${issues.number}) = ${f.q.trim().toUpperCase()}`,
          /^\d+$/.test(f.q.trim()) ? eq(issues.number, Number(f.q.trim())) : undefined,
        )
      : undefined,
    f.doneSince && f.status && DONE.includes(f.status) ? gt(issues.statusChangedAt, f.doneSince) : undefined,
    f.due === 'none' ? isNull(issues.dueAt) : undefined,
    f.due === 'overdue' ? and(lt(issues.dueAt, Date.now()), sql`${issues.status} not in ('done','canceled')`) : undefined,
    f.due === 'week' ? and(gt(issues.dueAt, Date.now()), lt(issues.dueAt, Date.now() + 7 * 86400_000)) : undefined,
  )
}

/** One status at a time, each with its own page — a status group never vanishes because of another's size. */
export async function listIssues(ctx: Ctx, scope: { key?: string; mine?: boolean }, f: IssueFilter) {
  const projectIds = await scopeProjects(ctx, scope)
  if (!projectIds.length) return { items: [], total: 0 }
  const where = issueWhere(ctx, projectIds, scope, f)
  const order: SQL[] =
    f.sort === 'created'
      ? [desc(issues.createdAt)]
      : f.sort === 'updated'
        ? [desc(issues.updatedAt)]
        : f.sort === 'priority'
          ? [PRIORITY_RANK, asc(issues.sortOrder)]
          : f.sort === 'due'
            ? [sql`${issues.dueAt} is null`, asc(issues.dueAt)]
            : [asc(issues.sortOrder)]
  const [rows, total] = await Promise.all([
    ctx.db.select().from(issues).where(where).orderBy(...order).limit(f.limit).offset(f.offset).all(),
    ctx.db.select({ n: sql<number>`count(*)` }).from(issues).where(where).get(),
  ])
  return { items: await hydrate(ctx, rows, await keyMap(ctx, projectIds)), total: total?.n ?? 0 }
}

export const TIMELINE_MAX = 500
export type Segment = { status: Status; from: number; to: number | null }

/**
 * Status segments per issue, derived from the "created" and status-change activities (nothing
 * extra is stored). Issues whose history is missing or out of order fall back to one segment in
 * their current status, so one bad row never breaks the chart.
 */
export async function issueTimeline(ctx: Ctx, scope: { key?: string }, f: Omit<IssueFilter, 'offset' | 'limit' | 'status' | 'sort' | 'doneSince'>) {
  const projectIds = await scopeProjects(ctx, scope)
  if (!projectIds.length) return { items: [], total: 0, projects: [] }
  const where = issueWhere(ctx, projectIds, {}, f)
  const [rows, total, projectRows] = await Promise.all([
    ctx.db.select().from(issues).where(where).orderBy(asc(issues.createdAt)).limit(TIMELINE_MAX).all(),
    ctx.db.select({ n: sql<number>`count(*)` }).from(issues).where(where).get(),
    ctx.db.select({ id: projects.id, key: projects.key, name: projects.name, targetDate: projects.targetDate, state: projects.state }).from(projects).where(inArray(projects.id, projectIds)).all(),
  ])
  const keyOf = new Map(projectRows.map((p) => [p.id, p.key]))
  const wanted = new Set(rows.map((r) => r.id))
  const acts = rows.length
    ? await ctx.db
        .select({ entityId: activities.entityId, action: activities.action, data: activities.data, createdAt: activities.createdAt })
        .from(activities)
        .where(
          and(
            inArray(activities.projectId, projectIds),
            eq(activities.entityType, 'issue'),
            or(eq(activities.action, 'created'), sql`json_extract(${activities.data}, '$.field') = 'status'`),
          ),
        )
        .orderBy(asc(activities.createdAt))
        .all()
    : []
  const byIssue = new Map<string, typeof acts>()
  for (const a of acts) if (wanted.has(a.entityId)) byIssue.set(a.entityId, [...(byIssue.get(a.entityId) ?? []), a])
  const isStatus = (s: unknown): s is Status => typeof s === 'string' && (ISSUE_STATUSES as readonly string[]).includes(s)
  const items = rows.map((r) => {
    let segments: Segment[] = []
    try {
      const list = byIssue.get(r.id) ?? []
      const created = list.find((a) => a.action === 'created')
      const changes = list.filter((a) => a.action !== 'created')
      const first = (created?.data as { status?: unknown } | undefined)?.status ?? (changes[0]?.data as { from?: unknown } | undefined)?.from
      let cur: Segment = { status: isStatus(first) ? first : r.status, from: r.createdAt, to: null }
      for (const c of changes) {
        const to = (c.data as { to?: unknown }).to
        if (!isStatus(to) || c.createdAt < cur.from) continue
        segments.push({ ...cur, to: c.createdAt })
        cur = { status: to, from: c.createdAt, to: null }
      }
      if (cur.status !== r.status) cur = { ...cur, status: r.status }
      segments.push(cur)
    } catch {
      segments = [{ status: r.status, from: r.createdAt, to: null }]
    }
    // Finished issues stop at completion instead of running to today.
    const last = segments[segments.length - 1]!
    if (DONE.includes(last.status)) last.to = last.from
    return { ref: `${keyOf.get(r.projectId)}-${r.number}`, title: r.title, status: r.status, priority: r.priority, dueAt: r.dueAt, projectKey: keyOf.get(r.projectId)!, createdAt: r.createdAt, segments }
  })
  return { items, total: total?.n ?? 0, projects: projectRows.map(({ id: _id, ...p }) => p) }
}

export async function statusCounts(ctx: Ctx, scope: { key?: string; mine?: boolean }, f: Omit<IssueFilter, 'status' | 'offset' | 'limit'>) {
  const out: Record<string, number> = {}
  for (const s of ISSUE_STATUSES) out[s] = (await listIssues(ctx, scope, { ...f, status: s, offset: 0, limit: 0 })).total
  return out
}

export async function issueDetail(ctx: Ctx, ref: string) {
  const { issue, project, role } = await getIssue(ctx, ref)
  const [h] = await hydrate(ctx, [issue], new Map([[project.id, project.key]]))
  const rel = await ctx.db
    .select({ fromId: issueRelations.fromId, toId: issueRelations.toId, type: issueRelations.type })
    .from(issueRelations)
    .where(or(eq(issueRelations.fromId, issue.id), eq(issueRelations.toId, issue.id)))
    .all()
  const otherIds = rel.map((r) => (r.fromId === issue.id ? r.toId : r.fromId))
  const visible = new Set(await visibleProjectIds(ctx))
  const others = otherIds.length
    ? await ctx.db.select().from(issues).where(and(inArray(issues.id, otherIds), isNull(issues.deletedAt))).all()
    : []
  const keys = await keyMap(ctx, [...new Set(others.map((o) => o.projectId))])
  const relations = rel
    .map((r) => {
      const outgoing = r.fromId === issue.id
      const o = others.find((x) => x.id === (outgoing ? r.toId : r.fromId))
      if (!o || !visible.has(o.projectId)) return null
      const type = r.type === 'blocks' ? (outgoing ? 'blocks' : 'blocked_by') : r.type === 'duplicate_of' ? (outgoing ? 'duplicate_of' : 'duplicated_by') : 'relates'
      return { type, ref: `${keys.get(o.projectId)}-${o.number}`, title: o.title, status: o.status }
    })
    .filter(Boolean)
  const children = await ctx.db.select().from(issues).where(and(eq(issues.parentId, issue.id), isNull(issues.deletedAt))).orderBy(asc(issues.sortOrder)).all()
  // Meeting notes are matched on their stored text; comments use the references table.
  const issueRef = refOf(project, issue)
  const mentionedIn = await notesMentioning(ctx, `#[issue:${issueRef}]`)
  const sub = await ctx.db.select().from(issueSubscriptions).where(and(eq(issueSubscriptions.issueId, issue.id), eq(issueSubscriptions.userId, ctx.user.id))).get()
  return {
    subscribed: !!sub,
    issue: { ...h!, role, projectState: project.state, projectName: project.name },
    relations,
    children: (await hydrate(ctx, children, new Map([[project.id, project.key]]))).map(({ ref, title, status, assigneeIds }) => ({ ref, title, status, assigneeIds })),
    mentionedIn,
  }
}

const WEEK = 7 * 86400_000

/**
 * Project statistics, all derived from the same status segments as the timeline:
 * lead time (created → done), cycle time (first in progress → done), average time per
 * status (finished segments only) and issues completed in each of the last 12 weeks.
 */
export async function issueStats(ctx: Ctx, key: string) {
  const { items, total } = await issueTimeline(ctx, { key }, {})
  const lead: number[] = []
  const cycle: number[] = []
  const inStatus = new Map<Status, number[]>()
  const now = Date.now()
  const weekStart = (() => {
    const d = new Date(now)
    d.setUTCHours(0, 0, 0, 0)
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    return d.getTime()
  })()
  const weeks = Array.from({ length: 12 }, (_, i) => ({ start: weekStart - (11 - i) * WEEK, done: 0 }))
  for (const it of items) {
    for (const s of it.segments) if (s.to !== null && s.to > s.from) inStatus.set(s.status, [...(inStatus.get(s.status) ?? []), s.to - s.from])
    const done = it.segments.find((s) => s.status === 'done')
    if (!done) continue
    lead.push(done.from - it.createdAt)
    const started = it.segments.find((s) => s.status === 'in_progress')
    if (started) cycle.push(done.from - started.from)
    const w = weeks.find((x) => done.from >= x.start && done.from < x.start + WEEK)
    if (w) w.done++
  }
  const summary = (xs: number[]) => {
    if (!xs.length) return null
    const sorted = [...xs].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    return { avg: xs.reduce((a, b) => a + b, 0) / xs.length, median: sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2, n: xs.length }
  }
  return {
    total,
    sampled: items.length,
    lead: summary(lead),
    cycle: summary(cycle),
    statuses: ISSUE_STATUSES.filter((s) => !DONE.includes(s)).map((s) => ({ status: s, ...summary(inStatus.get(s) ?? []) })),
    weeks,
  }
}

// ---------- writes ----------

export type IssueInput = {
  title: string
  description?: string
  status?: Status
  priority?: Priority
  assigneeIds?: string[]
  labelIds?: string[]
  parentRef?: string | null
  dueAt?: number | null
}

async function assertAssignable(ctx: Ctx, projectId: string, userIds: string[]) {
  for (const id of userIds) if (!(await userCanSee(ctx, projectId, id))) throw new AppError('not_visible', 422, 'Assignee cannot see this project', { userId: id })
}

async function assertLabels(ctx: Ctx, projectId: string, labelIds: string[]) {
  if (!labelIds.length) return
  const rows = await ctx.db.select({ id: labels.id }).from(labels).where(and(eq(labels.projectId, projectId), inArray(labels.id, labelIds))).all()
  if (rows.length !== new Set(labelIds).size) throw badRequest('Unknown label')
}

/** New parent must not be the issue itself, one of its descendants, or exceed 10 levels. */
async function assertParent(ctx: Ctx, issueId: string | null, parentId: string) {
  let depth = 1
  let cur: string | null = parentId
  while (cur) {
    if (cur === issueId) throw new AppError('cycle', 422, 'That would create a cycle')
    const row: { parentId: string | null } | undefined = await ctx.db.select({ parentId: issues.parentId }).from(issues).where(eq(issues.id, cur)).get()
    cur = row?.parentId ?? null
    if (++depth > MAX_DEPTH) throw new AppError('depth_exceeded', 422, 'More than 10 levels')
  }
}

export async function createIssue(ctx: Ctx, key: string, input: IssueInput) {
  requireScope(ctx, 'write')
  const { project, role } = await access(ctx, { key })
  need(role, 'member')
  requireActive(project)
  const assigneeIds = [...new Set(input.assigneeIds ?? [])]
  await assertAssignable(ctx, project.id, assigneeIds)
  await assertLabels(ctx, project.id, input.labelIds ?? [])
  let parentId: string | null = null
  if (input.parentRef) {
    const parent = await getIssue(ctx, input.parentRef)
    parentId = parent.issue.id
    await assertParent(ctx, null, parentId)
  }
  const status = input.status ?? 'todo'
  const last = await ctx.db.select({ s: sql<number>`max(${issues.sortOrder})` }).from(issues).where(and(eq(issues.projectId, project.id), eq(issues.status, status))).get()
  const now = Date.now()
  const id = newId()
  // The counter bump and the insert share one atomic batch, so numbers never collide or get reused.
  await ctx.db.batch([
    ctx.db.update(projects).set({ issueSeq: sql`${projects.issueSeq} + 1` }).where(eq(projects.id, project.id)),
    ctx.db.insert(issues).values({
      id,
      projectId: project.id,
      number: sql`(select issue_seq from projects where id = ${project.id})` as unknown as number,
      title: input.title,
      description: input.description ?? '',
      status,
      priority: input.priority ?? 'none',
      sortOrder: (last?.s ?? 0) + 1024,
      parentId,
      dueAt: input.dueAt ?? null,
      createdBy: ctx.user.id,
      createdAt: now,
      updatedAt: now,
      statusChangedAt: now,
      completedAt: DONE.includes(status) ? now : null,
    }),
    ...assigneeIds.map((userId, position) => ctx.db.insert(issueAssignees).values({ issueId: id, userId, position })),
    ...(input.labelIds ?? []).map((labelId) => ctx.db.insert(issueLabels).values({ issueId: id, labelId })),
    ...subscribeOps(ctx, id, [ctx.user.id, ...assigneeIds]),
  ])
  const issue = (await ctx.db.select().from(issues).where(eq(issues.id, id)).get())!
  const ref = refOf(project, issue)
  await activity(ctx, { entityType: 'issue', entityId: id, action: 'created', data: { ref, title: issue.title, status }, projectId: project.id }).run()
  notify(ctx, assigneeIds, { type: 'issue_assigned', entityType: 'issue', entityId: id, data: { ref, title: issue.title }, projectId: project.id })
  await syncReferences(ctx, 'issue', id, input.description ?? '', ref)
  return { ...issue, ref }
}

export type IssuePatch = Partial<Omit<IssueInput, 'parentRef'>> & { parentRef?: string | null; sortOrder?: number }

/** Applies a patch with optimistic locking; every changed field becomes a `{field, from, to}` activity. */
export async function updateIssue(ctx: Ctx, ref: string, version: number, patch: IssuePatch) {
  requireScope(ctx, 'write')
  const { issue, project, role } = await getIssue(ctx, ref)
  need(role, 'member')
  requireActive(project)
  if (issue.version !== version) throw conflict()
  const now = Date.now()
  const set: Partial<Issue> = { updatedAt: now, version: issue.version + 1 }
  const changes: { field: string; from: unknown; to: unknown }[] = []
  for (const k of ['title', 'description', 'priority', 'dueAt', 'sortOrder'] as const) {
    if (patch[k] !== undefined && patch[k] !== issue[k]) {
      ;(set as Record<string, unknown>)[k] = patch[k]
      if (k !== 'sortOrder' && k !== 'description') changes.push({ field: k, from: issue[k], to: patch[k] })
      if (k === 'description') changes.push({ field: k, from: null, to: null })
    }
  }
  if (patch.status && patch.status !== issue.status) {
    set.status = patch.status
    set.statusChangedAt = now
    set.completedAt = DONE.includes(patch.status) ? now : null
    changes.push({ field: 'status', from: issue.status, to: patch.status })
  }
  if (patch.parentRef !== undefined) {
    const parentId = patch.parentRef ? (await getIssue(ctx, patch.parentRef)).issue.id : null
    if (parentId) await assertParent(ctx, issue.id, parentId)
    if (parentId !== issue.parentId) {
      set.parentId = parentId
      changes.push({ field: 'parent', from: issue.parentId, to: parentId })
    }
  }
  const ops = []
  let newAssignees: string[] = []
  if (patch.assigneeIds) {
    const before = (await ctx.db.select().from(issueAssignees).where(eq(issueAssignees.issueId, issue.id)).orderBy(asc(issueAssignees.position)).all()).map((a) => a.userId)
    const after = [...new Set(patch.assigneeIds)]
    if (before.join() !== after.join()) {
      await assertAssignable(ctx, project.id, after.filter((x) => !before.includes(x)))
      ops.push(ctx.db.delete(issueAssignees).where(eq(issueAssignees.issueId, issue.id)), ...after.map((userId, position) => ctx.db.insert(issueAssignees).values({ issueId: issue.id, userId, position })))
      changes.push({ field: 'assignees', from: before, to: after })
      newAssignees = after.filter((x) => !before.includes(x))
      ops.push(...subscribeOps(ctx, issue.id, newAssignees))
    }
  }
  if (patch.labelIds) {
    const before = (await ctx.db.select().from(issueLabels).where(eq(issueLabels.issueId, issue.id)).all()).map((l) => l.labelId).sort()
    const after = [...new Set(patch.labelIds)].sort()
    if (before.join() !== after.join()) {
      await assertLabels(ctx, project.id, after)
      ops.push(ctx.db.delete(issueLabels).where(eq(issueLabels.issueId, issue.id)), ...after.map((labelId) => ctx.db.insert(issueLabels).values({ issueId: issue.id, labelId })))
      changes.push({ field: 'labels', from: before, to: after })
    }
  }
  const res = await ctx.db.batch([
    ctx.db.update(issues).set(set).where(and(eq(issues.id, issue.id), eq(issues.version, version))),
    ...ops,
    ...changes.map((c) => activity(ctx, { entityType: 'issue', entityId: issue.id, action: 'changed', data: { ref, ...c }, projectId: project.id }, now)),
  ])
  if (res[0].meta.changes === 0) throw conflict()
  if (newAssignees.length) notify(ctx, newAssignees, { type: 'issue_assigned', entityType: 'issue', entityId: issue.id, data: { ref, title: set.title ?? issue.title }, projectId: project.id })
  if (set.status) notify(ctx, await subscribers(ctx, issue.id), { type: 'issue_status', entityType: 'issue', entityId: issue.id, data: { ref, title: issue.title, to: set.status }, projectId: project.id })
  if (patch.description !== undefined) await syncReferences(ctx, 'issue', issue.id, patch.description, ref)
  return { ...issue, ...set, ref }
}

/** Board move: new status and/or position between two neighbours (midpoint, one row written). */
export async function moveIssue(ctx: Ctx, ref: string, version: number, o: { status?: Status; beforeRef?: string | null; afterRef?: string | null }) {
  const order = async (r?: string | null) => (r ? (await getIssue(ctx, r)).issue.sortOrder : null)
  const [before, after] = await Promise.all([order(o.beforeRef), order(o.afterRef)])
  const sortOrder = before !== null && after !== null ? (before + after) / 2 : before !== null ? before + 1024 : after !== null ? after - 1024 : undefined
  return updateIssue(ctx, ref, version, { status: o.status, sortOrder })
}

/** Applies one patch to 1–50 issues; each succeeds or fails on its own (version per item). */
export async function batchUpdate(ctx: Ctx, items: { ref: string; version: number }[], patch: IssuePatch) {
  const results: { ref: string; ok: boolean; code?: string; version?: number }[] = []
  for (const it of items) {
    try {
      const r = await updateIssue(ctx, it.ref, it.version, patch)
      results.push({ ref: it.ref, ok: true, version: r.version })
    } catch (err) {
      results.push({ ref: it.ref, ok: false, code: err instanceof AppError ? err.code : 'internal' })
    }
  }
  return results
}

export type DuplicateOptions = { title: string; key: string; children: boolean; attachments: boolean; labels: boolean; assignees: boolean }
const MAX_COPY = 200

/**
 * Copies an issue (optionally its whole sub-tree) into `key`. Numbers are reserved in one atomic
 * batch, so the copied tree is numbered contiguously even while others create issues. Labels are
 * matched by name across projects and assignees who can't see the target are dropped; both are
 * reported back as `skipped`.
 */
export async function duplicateIssue(ctx: Ctx, ref: string, o: DuplicateOptions) {
  requireScope(ctx, 'write')
  const src = await getIssue(ctx, ref)
  const { project: target, role } = await access(ctx, { key: o.key })
  need(role, 'member')
  requireActive(target)

  // Breadth-first so every parent is inserted before its children.
  const tree: Issue[] = [src.issue]
  for (let i = 0; o.children && i < tree.length && tree.length < MAX_COPY; i++) {
    const kids = await ctx.db.select().from(issues).where(and(eq(issues.parentId, tree[i]!.id), isNull(issues.deletedAt))).orderBy(asc(issues.sortOrder)).all()
    tree.push(...kids.slice(0, MAX_COPY - tree.length))
  }
  const ids = tree.map((t) => t.id)
  const newIds = new Map(ids.map((id) => [id, newId()]))

  const skipped = { labels: new Set<string>(), assignees: new Set<string>() }
  const labelsOf = new Map<string, string[]>()
  if (o.labels) {
    const rows = await ctx.db.select({ issueId: issueLabels.issueId, id: labels.id, name: labels.name }).from(issueLabels).innerJoin(labels, eq(labels.id, issueLabels.labelId)).where(inArray(issueLabels.issueId, ids)).all()
    const byName = new Map(
      (await ctx.db.select().from(labels).where(eq(labels.projectId, target.id)).all()).map((l) => [l.name.toLowerCase(), l.id]),
    )
    for (const r of rows) {
      const id = src.project.id === target.id ? r.id : byName.get(r.name.toLowerCase())
      if (id) labelsOf.set(r.issueId, [...(labelsOf.get(r.issueId) ?? []), id])
      else skipped.labels.add(r.name)
    }
  }
  const assigneesOf = new Map<string, string[]>()
  if (o.assignees) {
    const rows = await ctx.db.select().from(issueAssignees).where(inArray(issueAssignees.issueId, ids)).orderBy(asc(issueAssignees.position)).all()
    const can = new Map<string, boolean>()
    for (const r of rows) {
      if (!can.has(r.userId)) can.set(r.userId, await userCanSee(ctx, target.id, r.userId))
      if (can.get(r.userId)) assigneesOf.set(r.issueId, [...(assigneesOf.get(r.issueId) ?? []), r.userId])
      else skipped.assignees.add(r.userId)
    }
  }

  // Stored files are copied object-by-object before any row is written; a failure removes the copies.
  const fileRows: (typeof files.$inferInsert)[] = []
  const fileIds = new Map<string, string>()
  if (o.attachments) {
    const srcFiles = await ctx.db.select().from(files).where(and(eq(files.parentType, 'issue'), inArray(files.parentId, ids), isNull(files.deletedAt), eq(files.status, 'ready'))).all()
    const lim = await limits(ctx)
    const bytes = srcFiles.reduce((n, f) => n + f.size, 0)
    if (!isAdmin(ctx.user) && (await usedBytes(ctx, ctx.user.id)) + bytes > lim.quotaBytes) throw new AppError('quota_exceeded', 413, 'Storage quota exceeded')
    try {
      for (const f of srcFiles) {
        const id = newId()
        const parentId = newIds.get(f.parentId)!
        let r2Key = ''
        if (f.kind !== 'drive') {
          const obj = await ctx.env.FILES.get(f.r2Key)
          if (!obj) continue
          r2Key = `issue/${parentId}/${id}`
          await ctx.env.FILES.put(r2Key, obj.body, { httpMetadata: obj.httpMetadata, customMetadata: { name: f.name, owner: ctx.user.id } })
        }
        fileIds.set(f.id, id)
        fileRows.push({ ...f, id, r2Key, parentId, ownerId: ctx.user.id, createdAt: Date.now() })
      }
    } catch (err) {
      ctx.waitUntil(Promise.all(fileRows.filter((f) => f.r2Key).map((f) => ctx.env.FILES.delete(f.r2Key))).catch(() => undefined))
      throw err
    }
  }
  // Inline images in descriptions point at the copies, not the originals.
  const rewrite = (text: string) => [...fileIds].reduce((s, [from, to]) => s.replaceAll(from, to), text)

  const last = await ctx.db.select({ s: sql<number>`max(${issues.sortOrder})` }).from(issues).where(and(eq(issues.projectId, target.id), eq(issues.status, 'todo'))).get()
  const now = Date.now()
  const n = tree.length
  const srcRef = (i: Issue) => `${src.project.key}-${i.number}`
  await ctx.db.batch([
    ctx.db.update(projects).set({ issueSeq: sql`${projects.issueSeq} + ${n}` }).where(eq(projects.id, target.id)),
    ...tree.map((t, i) =>
      ctx.db.insert(issues).values({
        id: newIds.get(t.id)!,
        projectId: target.id,
        number: sql`(select issue_seq from projects where id = ${target.id}) - ${n - 1 - i}` as unknown as number,
        title: i === 0 ? o.title : t.title,
        description: rewrite(t.description),
        status: 'todo',
        priority: t.priority,
        sortOrder: (last?.s ?? 0) + 1024 * (i + 1),
        parentId: i === 0 ? null : newIds.get(t.parentId!)!,
        dueAt: t.dueAt,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
        statusChangedAt: now,
        completedAt: null,
      }),
    ),
    ...tree.flatMap((t) => (assigneesOf.get(t.id) ?? []).map((userId, position) => ctx.db.insert(issueAssignees).values({ issueId: newIds.get(t.id)!, userId, position }))),
    ...tree.flatMap((t) => [...new Set(labelsOf.get(t.id) ?? [])].map((labelId) => ctx.db.insert(issueLabels).values({ issueId: newIds.get(t.id)!, labelId }))),
    ...fileRows.map((f) => ctx.db.insert(files).values(f)),
    ...tree.flatMap((t) => subscribeOps(ctx, newIds.get(t.id)!, [ctx.user.id, ...(assigneesOf.get(t.id) ?? [])])),
  ])
  const created = await ctx.db.select().from(issues).where(inArray(issues.id, [...newIds.values()])).all()
  const byId = new Map(created.map((c) => [c.id, c]))
  for (const t of tree) {
    const c = byId.get(newIds.get(t.id)!)!
    const r = refOf(target, c)
    await activity(ctx, { entityType: 'issue', entityId: c.id, action: 'created', data: { ref: r, title: c.title, status: c.status, copiedFrom: srcRef(t) }, projectId: target.id }).run()
    notify(ctx, assigneesOf.get(t.id) ?? [], { type: 'issue_assigned', entityType: 'issue', entityId: c.id, data: { ref: r, title: c.title }, projectId: target.id })
    if (c.description) await syncReferences(ctx, 'issue', c.id, c.description)
  }
  const root = byId.get(newIds.get(src.issue.id)!)!
  return { ref: refOf(target, root), count: n, skipped: { labels: [...skipped.labels], assignees: [...skipped.assignees] } }
}

export async function deleteIssue(ctx: Ctx, ref: string) {
  requireScope(ctx, 'write')
  const { issue, project, role } = await getIssue(ctx, ref)
  need(role, 'member')
  await ctx.db.batch([
    ctx.db.update(issues).set({ deletedAt: Date.now(), version: issue.version + 1 }).where(eq(issues.id, issue.id)),
    activity(ctx, { entityType: 'issue', entityId: issue.id, action: 'deleted', data: { ref, title: issue.title }, projectId: project.id }),
  ])
}

/** Deleted issues of a project, newest first, for its owners to restore. */
export async function deletedIssues(ctx: Ctx, key: string) {
  const { project, role } = await access(ctx, { key })
  need(role, 'owner')
  const rows = await ctx.db.select().from(issues).where(and(eq(issues.projectId, project.id), isNotNull(issues.deletedAt))).orderBy(desc(issues.deletedAt)).limit(100).all()
  return rows.map((r) => ({ ref: `${project.key}-${r.number}`, title: r.title, deletedAt: r.deletedAt }))
}

export async function restoreIssue(ctx: Ctx, ref: string) {
  requireScope(ctx, 'write')
  const { key, number } = parseRef(ref)
  const { project, role } = await access(ctx, { key })
  need(role, 'owner')
  requireActive(project)
  const issue = await ctx.db.select().from(issues).where(and(eq(issues.projectId, project.id), eq(issues.number, number), isNotNull(issues.deletedAt))).get()
  if (!issue) throw notFound()
  await ctx.db.batch([
    ctx.db.update(issues).set({ deletedAt: null, version: issue.version + 1, updatedAt: Date.now() }).where(eq(issues.id, issue.id)),
    activity(ctx, { entityType: 'issue', entityId: issue.id, action: 'restored', data: { ref, title: issue.title }, projectId: project.id }),
  ])
}

/** A deleted comment comes back for its author or a project owner. */
export async function restoreIssueComment(ctx: Ctx, ref: string, id: string) {
  requireScope(ctx, 'write')
  const { issue, role } = await getIssue(ctx, ref)
  const c = await ctx.db.select().from(issueComments).where(and(eq(issueComments.id, id), eq(issueComments.issueId, issue.id), isNotNull(issueComments.deletedAt))).get()
  if (!c || (c.authorId !== ctx.user.id && role !== 'owner')) throw notFound()
  await ctx.db.update(issueComments).set({ deletedAt: null }).where(eq(issueComments.id, id))
}

/** Ticks/unticks the n-th `- [ ]` in the description, refusing if the line no longer matches what the user saw. */
export async function toggleCheckbox(ctx: Ctx, ref: string, version: number, index: number, expectLine: string, checked: boolean) {
  const { issue } = await getIssue(ctx, ref)
  const lines = issue.description.split('\n')
  let n = -1
  const at = lines.findIndex((l) => /^\s*[-*] \[[ xX]\]/.test(l) && ++n === index)
  if (at < 0 || lines[at]!.replace(/\[[ xX]\]/, '[ ]').trim() !== expectLine.replace(/\[[ xX]\]/, '[ ]').trim()) throw conflict('Checklist changed')
  lines[at] = lines[at]!.replace(/\[[ xX]\]/, checked ? '[x]' : '[ ]')
  return updateIssue(ctx, ref, version, { description: lines.join('\n') })
}

// ---------- relations ----------

export async function addRelation(ctx: Ctx, ref: string, type: 'blocks' | 'blocked_by' | 'relates' | 'duplicate_of', targetRef: string) {
  requireScope(ctx, 'write')
  const a = await getIssue(ctx, ref)
  need(a.role, 'member')
  const b = await getIssue(ctx, targetRef)
  if (a.issue.id === b.issue.id) throw badRequest('Cannot relate an issue to itself')
  const [fromId, toId, t] = type === 'blocked_by' ? [b.issue.id, a.issue.id, 'blocks' as const] : [a.issue.id, b.issue.id, type]
  await ctx.db.batch([
    ctx.db.insert(issueRelations).values({ fromId, toId, type: t, createdAt: Date.now() }).onConflictDoNothing(),
    activity(ctx, { entityType: 'issue', entityId: a.issue.id, action: 'related', data: { ref, type, target: targetRef }, projectId: a.project.id }),
  ])
}

export async function removeRelation(ctx: Ctx, ref: string, type: 'blocks' | 'blocked_by' | 'relates' | 'duplicate_of' | 'duplicated_by', targetRef: string) {
  requireScope(ctx, 'write')
  const a = await getIssue(ctx, ref)
  need(a.role, 'member')
  const b = await getIssue(ctx, targetRef)
  const pairs =
    type === 'blocked_by' ? [[b.issue.id, a.issue.id, 'blocks']] : type === 'duplicated_by' ? [[b.issue.id, a.issue.id, 'duplicate_of']] : type === 'relates' ? [[a.issue.id, b.issue.id, 'relates'], [b.issue.id, a.issue.id, 'relates']] : [[a.issue.id, b.issue.id, type]]
  for (const [f, t, ty] of pairs)
    await ctx.db.delete(issueRelations).where(and(eq(issueRelations.fromId, f!), eq(issueRelations.toId, t!), eq(issueRelations.type, ty as 'blocks')))
}

// ---------- comments & timeline ----------

export async function timeline(ctx: Ctx, ref: string, o: { kind: 'all' | 'comments' | 'changes'; order: 'asc' | 'desc'; before?: number; limit: number }) {
  const { issue } = await getIssue(ctx, ref)
  const cmp = o.order === 'desc' ? lt : gt
  const comments =
    o.kind === 'changes'
      ? []
      : await ctx.db
          .select()
          .from(issueComments)
          .where(and(eq(issueComments.issueId, issue.id), o.before ? cmp(issueComments.createdAt, o.before) : undefined))
          .orderBy(o.order === 'desc' ? desc(issueComments.createdAt) : asc(issueComments.createdAt))
          .limit(o.limit)
          .all()
  const changes =
    o.kind === 'comments'
      ? []
      : await ctx.db
          .select()
          .from(activities)
          .where(and(eq(activities.entityType, 'issue'), eq(activities.entityId, issue.id), o.before ? cmp(activities.createdAt, o.before) : undefined))
          .orderBy(o.order === 'desc' ? desc(activities.createdAt) : asc(activities.createdAt))
          .limit(o.limit)
          .all()
  const items = [
    ...comments.map((c) => ({ kind: 'comment' as const, at: c.createdAt, comment: c.deletedAt ? { ...c, body: '' } : c })),
    ...changes.map((a) => ({ kind: 'change' as const, at: a.createdAt, change: a })),
  ].sort((x, y) => (o.order === 'desc' ? y.at - x.at : x.at - y.at))
  const page = items.slice(0, o.limit)
  return { items: page, next: items.length > o.limit || comments.length === o.limit || changes.length === o.limit ? (page[page.length - 1]?.at ?? null) : null }
}

export async function addIssueComment(ctx: Ctx, ref: string, body: string, parentId?: string) {
  requireScope(ctx, 'write')
  const { issue, project, role } = await getIssue(ctx, ref)
  need(role, 'member')
  if (parentId) {
    const p = await ctx.db.select().from(issueComments).where(and(eq(issueComments.id, parentId), eq(issueComments.issueId, issue.id))).get()
    if (!p || p.parentId) throw badRequest('Replies are one level deep')
  }
  const mentioned = mentionedUserIds(body)
  for (const id of mentioned) if (!(await userCanSee(ctx, project.id, id))) throw new AppError('not_visible', 422, 'Mentioned user cannot see this project')
  const c = { id: newId(), issueId: issue.id, parentId: parentId ?? null, authorId: ctx.user.id, body, createdAt: Date.now(), editedAt: null, deletedAt: null, version: 1 }
  await ctx.db.batch([
    ctx.db.insert(issueComments).values(c),
    ctx.db.update(issues).set({ updatedAt: c.createdAt }).where(eq(issues.id, issue.id)),
    // Commenting subscribes you, as in Linear.
    ...subscribeOps(ctx, issue.id, [ctx.user.id]),
  ])
  const ref2 = refOf(project, issue)
  const subs = (await subscribers(ctx, issue.id)).filter((id) => !mentioned.includes(id))
  notify(ctx, subs, { type: 'issue_comment', entityType: 'issue', entityId: issue.id, data: { ref: ref2, title: issue.title, commentId: c.id }, projectId: project.id })
  notify(ctx, mentioned, { type: 'mention', entityType: 'issue', entityId: issue.id, data: { ref: ref2, title: issue.title, commentId: c.id }, projectId: project.id })
  await syncReferences(ctx, 'issue_comment', c.id, body, ref2)
  return c
}

export async function editIssueComment(ctx: Ctx, ref: string, id: string, version: number, body: string) {
  requireScope(ctx, 'write')
  const { issue } = await getIssue(ctx, ref)
  const c = await ctx.db.select().from(issueComments).where(and(eq(issueComments.id, id), eq(issueComments.issueId, issue.id), isNull(issueComments.deletedAt))).get()
  if (!c || c.authorId !== ctx.user.id) throw notFound()
  const res = await ctx.db
    .update(issueComments)
    .set({ body, editedAt: Date.now(), version: c.version + 1 })
    .where(and(eq(issueComments.id, id), eq(issueComments.version, version)))
  if (res.meta.changes === 0) throw conflict()
  await syncReferences(ctx, 'issue_comment', id, body, ref)
  return { ...c, body, version: c.version + 1 }
}

export async function deleteIssueComment(ctx: Ctx, ref: string, id: string) {
  requireScope(ctx, 'write')
  const { issue } = await getIssue(ctx, ref)
  const c = await ctx.db.select().from(issueComments).where(and(eq(issueComments.id, id), eq(issueComments.issueId, issue.id))).get()
  if (!c || c.authorId !== ctx.user.id) throw notFound()
  await ctx.db.update(issueComments).set({ deletedAt: Date.now() }).where(eq(issueComments.id, id))
}

// ---------- #[issue:KEY-N] / #[task:id] back-references ----------

/**
 * Records which issues/tasks a body references (for "mentioned in" on the target). When an issue
 * or issue comment newly cites another issue, the cited issue's timeline gets "referenced from
 * KEY-N". Never throws.
 */
export async function syncReferences(ctx: Ctx, sourceType: 'note' | 'issue_comment' | 'issue', sourceId: string, body: string, fromRef?: string) {
  try {
    const targets: { type: 'issue' | 'task'; id: string }[] = []
    for (const m of body.matchAll(/#\[(issue|task):([\w-]+)\]/g)) {
      if (m[1] === 'task') targets.push({ type: 'task', id: m[2]! })
      else {
        const found = await getIssue(ctx, m[2]!).catch(() => null)
        if (found) targets.push({ type: 'issue', id: found.issue.id })
      }
    }
    const before = new Set(
      (await ctx.db.select({ id: references.targetId }).from(references).where(and(eq(references.sourceType, sourceType), eq(references.sourceId, sourceId))).all()).map((r) => r.id),
    )
    await ctx.db.delete(references).where(and(eq(references.sourceType, sourceType), eq(references.sourceId, sourceId)))
    for (const t of targets)
      await ctx.db.insert(references).values({ sourceType, sourceId, targetType: t.type, targetId: t.id, createdAt: Date.now() }).onConflictDoNothing()
    if (!fromRef) return
    for (const t of targets) {
      if (t.type !== 'issue' || before.has(t.id)) continue
      const target = await ctx.db.select({ number: issues.number, projectId: issues.projectId }).from(issues).where(eq(issues.id, t.id)).get()
      const key = target && (await ctx.db.select({ key: projects.key }).from(projects).where(eq(projects.id, target.projectId)).get())?.key
      if (!target || !key || `${key}-${target.number}` === fromRef) continue
      await activity(ctx, { entityType: 'issue', entityId: t.id, action: 'referenced', data: { ref: `${key}-${target.number}`, from: fromRef }, projectId: target.projectId }).run()
    }
  } catch {
    /* side effect only */
  }
}

export type { Access }

// Attachments on issues follow the project: members upload, anyone who sees the issue reads.
parentChecks.issue = async (ctx, id, mode) => {
  const row = await ctx.db.select({ projectId: issues.projectId, deletedAt: issues.deletedAt }).from(issues).where(eq(issues.id, id)).get()
  if (!row || row.deletedAt) throw notFound()
  const { role } = await access(ctx, { id: row.projectId })
  if (mode === 'write') need(role, 'member')
}
