import { and, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../context'
import { body, ctxOf, parse } from '../context'
import { ISSUE_PRIORITIES, ISSUE_STATUSES, issues, projects } from '../db/schema'
import {
  addIssueComment,
  addRelation,
  batchUpdate,
  createIssue,
  deleteIssue,
  deleteIssueComment,
  editIssueComment,
  getIssue,
  idempotent,
  issueDetail,
  duplicateIssue,
  setSubscribed,
  issueStats,
  issueTimeline,
  listIssues,
  moveIssue,
  removeRelation,
  statusCounts,
  timeline,
  toggleCheckbox,
  updateIssue,
} from '../services/issues'
import {
  access,
  addMember,
  createProject,
  deleteLabel,
  deleteProject,
  listLabels,
  listProjects,
  projectDto,
  deleteView,
  listSavedViews,
  renameView,
  saveView,
  removeMember,
  setMemberRole,
  setProjectState,
  updateProject,
  upsertLabel,
  visibleProjectIds,
} from '../services/projects'
import { refResolvers, slices } from './home'

export const projectRoutes = new Hono<AppEnv>()

const status = z.enum(ISSUE_STATUSES)
const priority = z.enum(ISSUE_PRIORITIES)
const role = z.enum(['viewer', 'member', 'owner'])
const opId = z.string().max(100).optional()

// ---------- projects ----------

projectRoutes.get('/projects', async (c) => c.json({ items: await listProjects(ctxOf(c)) }))

projectRoutes.post('/projects', async (c) => {
  const ctx = ctxOf(c)
  const input = await body(
    c,
    z.object({ key: z.string().trim().min(2).max(6), name: z.string().trim().min(1).max(80), description: z.string().max(5000).optional(), parentId: z.string().nullable().optional(), targetDate: z.number().int().nullable().optional(), operationId: opId }),
  )
  const p = await idempotent(ctx, input.operationId, () => createProject(ctx, input))
  return c.json({ project: await projectDto(ctx, p, 'owner') }, 201)
})

projectRoutes.get('/projects/:key', async (c) => {
  const ctx = ctxOf(c)
  const { project, role } = await access(ctx, { key: c.req.param('key') })
  return c.json({ project: await projectDto(ctx, project, role) })
})

projectRoutes.patch('/projects/:key', async (c) => {
  const ctx = ctxOf(c)
  const { version, ...patch } = await body(
    c,
    z.object({
      version: z.number().int().optional(),
      name: z.string().trim().min(1).max(80).optional(),
      description: z.string().max(5000).optional(),
      reviewerId: z.string().nullable().optional(),
      targetDate: z.number().int().nullable().optional(),
      hiddenFromAdmins: z.boolean().optional(),
      parentId: z.string().nullable().optional(),
      staleDays: z.union([z.literal(3), z.literal(7), z.literal(14), z.literal(30)]).optional(),
    }),
  )
  const p = await updateProject(ctx, c.req.param('key'), version, patch)
  return c.json({ project: await projectDto(ctx, p, (await access(ctx, { id: p.id })).role) })
})

projectRoutes.post('/projects/:key/state', async (c) => {
  const { action } = await body(c, z.object({ action: z.enum(['close', 'reopen', 'archive', 'restore']) }))
  return c.json({ project: await setProjectState(ctxOf(c), c.req.param('key'), action) })
})

projectRoutes.delete('/projects/:key', async (c) => {
  const { confirmKey } = await body(c, z.object({ confirmKey: z.string() }))
  await deleteProject(ctxOf(c), c.req.param('key'), confirmKey)
  return c.json({ ok: true })
})

projectRoutes.post('/projects/:key/members', async (c) => {
  const input = await body(c, z.object({ userId: z.string(), role: role.default('member') }))
  return c.json(await addMember(ctxOf(c), c.req.param('key'), input.userId, input.role))
})

projectRoutes.patch('/projects/:key/members/:userId', async (c) => {
  const input = await body(c, z.object({ role }))
  await setMemberRole(ctxOf(c), c.req.param('key'), c.req.param('userId'), input.role)
  return c.json({ ok: true })
})

projectRoutes.delete('/projects/:key/members/:userId', async (c) => {
  await removeMember(ctxOf(c), c.req.param('key'), c.req.param('userId'))
  return c.json({ ok: true })
})

projectRoutes.get('/projects/:key/labels', async (c) => c.json({ items: await listLabels(ctxOf(c), c.req.param('key')) }))
projectRoutes.post('/projects/:key/labels', async (c) => {
  const input = await body(c, z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(40), color: z.number().int().min(1).max(8) }))
  return c.json({ label: await upsertLabel(ctxOf(c), c.req.param('key'), input) })
})
projectRoutes.delete('/projects/:key/labels/:id', async (c) => {
  await deleteLabel(ctxOf(c), c.req.param('key'), c.req.param('id'))
  return c.json({ ok: true })
})

// ---------- issues ----------

const filter = z.object({
  status: status.optional(),
  assigneeId: z.string().optional(),
  priority: priority.optional(),
  labelId: z.string().optional(),
  q: z.string().max(100).optional(),
  sort: z.enum(['manual', 'created', 'updated', 'priority', 'due']).optional(),
  doneSince: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(0).max(200).default(50),
})

projectRoutes.get('/projects/:key/issues', async (c) => c.json(await listIssues(ctxOf(c), { key: c.req.param('key') }, parse(filter, c.req.query()))))
projectRoutes.get('/projects/:key/counts', async (c) => {
  const { status: _s, offset: _o, limit: _l, ...f } = parse(filter, c.req.query())
  return c.json(await statusCounts(ctxOf(c), { key: c.req.param('key') }, f))
})
projectRoutes.get('/projects/:key/stats', async (c) => c.json(await issueStats(ctxOf(c), c.req.param('key'))))

projectRoutes.get('/saved-views', async (c) => c.json({ items: await listSavedViews(ctxOf(c)) }))
projectRoutes.post('/saved-views', async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(60), url: z.string().min(1).max(2000) }))
  return c.json({ view: await saveView(ctxOf(c), input.name, input.url) }, 201)
})
projectRoutes.patch('/saved-views/:id', async (c) => {
  const { name } = await body(c, z.object({ name: z.string().trim().min(1).max(60) }))
  await renameView(ctxOf(c), c.req.param('id'), name)
  return c.json({ ok: true })
})
projectRoutes.delete('/saved-views/:id', async (c) => {
  await deleteView(ctxOf(c), c.req.param('id'))
  return c.json({ ok: true })
})

projectRoutes.get('/timeline', async (c) => {
  const q = parse(filter.omit({ status: true, sort: true, offset: true, limit: true }).extend({ key: z.string().optional() }), c.req.query())
  return c.json(await issueTimeline(ctxOf(c), { key: q.key }, q))
})
projectRoutes.get('/my-issues', async (c) => c.json(await listIssues(ctxOf(c), { mine: true }, parse(filter, c.req.query()))))
projectRoutes.get('/my-issues/counts', async (c) => {
  const { status: _s, offset: _o, limit: _l, ...f } = parse(filter, c.req.query())
  return c.json(await statusCounts(ctxOf(c), { mine: true }, f))
})

const issueFields = {
  title: z.string().trim().min(1).max(300),
  description: z.string().max(100_000).optional(),
  status: status.optional(),
  priority: priority.optional(),
  assigneeIds: z.array(z.string()).max(20).optional(),
  labelIds: z.array(z.string()).max(20).optional(),
  parentRef: z.string().nullable().optional(),
  dueAt: z.number().int().nullable().optional(),
}

projectRoutes.post('/projects/:key/issues', async (c) => {
  const ctx = ctxOf(c)
  const { operationId, ...input } = await body(c, z.object({ ...issueFields, operationId: opId }))
  return c.json({ issue: await idempotent(ctx, operationId, () => createIssue(ctx, c.req.param('key'), input)) }, 201)
})

projectRoutes.get('/issues/:ref', async (c) => c.json(await issueDetail(ctxOf(c), c.req.param('ref'))))

projectRoutes.put('/issues/:ref/subscription', async (c) => {
  const { on } = await body(c, z.object({ on: z.boolean() }))
  return c.json(await setSubscribed(ctxOf(c), c.req.param('ref'), on))
})

projectRoutes.post('/issues/:ref/duplicate', async (c) => {
  const ctx = ctxOf(c)
  const { operationId, ...o } = await body(
    c,
    z.object({ title: issueFields.title, key: z.string().min(2).max(6), children: z.boolean(), attachments: z.boolean(), labels: z.boolean(), assignees: z.boolean(), operationId: opId }),
  )
  return c.json(await idempotent(ctx, operationId, () => duplicateIssue(ctx, c.req.param('ref'), o)), 201)
})

const patchFields = z.object({
  version: z.number().int(),
  operationId: opId,
  ...Object.fromEntries(Object.entries(issueFields).map(([k, v]) => [k, v.optional()])),
})

projectRoutes.patch('/issues/:ref', async (c) => {
  const ctx = ctxOf(c)
  const { version, operationId, ...patch } = await body(c, patchFields)
  return c.json({ issue: await idempotent(ctx, operationId as string | undefined, () => updateIssue(ctx, c.req.param('ref'), version as number, patch)) })
})

projectRoutes.post('/issues/:ref/move', async (c) => {
  const input = await body(c, z.object({ version: z.number().int(), status: status.optional(), beforeRef: z.string().nullable().optional(), afterRef: z.string().nullable().optional() }))
  return c.json({ issue: await moveIssue(ctxOf(c), c.req.param('ref'), input.version, input) })
})

projectRoutes.post('/issues/batch', async (c) => {
  const ctx = ctxOf(c)
  const input = await body(
    c,
    z.object({
      items: z.array(z.object({ ref: z.string(), version: z.number().int() })).min(1).max(50),
      patch: z.object({ status: status.optional(), priority: priority.optional(), assigneeIds: z.array(z.string()).max(20).optional(), labelIds: z.array(z.string()).max(20).optional(), dueAt: z.number().int().nullable().optional() }),
      operationId: opId,
    }),
  )
  return c.json({ results: await idempotent(ctx, input.operationId, () => batchUpdate(ctx, input.items, input.patch)) })
})

projectRoutes.delete('/issues/:ref', async (c) => {
  await deleteIssue(ctxOf(c), c.req.param('ref'))
  return c.json({ ok: true })
})

projectRoutes.post('/issues/:ref/checkbox', async (c) => {
  const input = await body(c, z.object({ version: z.number().int(), index: z.number().int().min(0), line: z.string().max(2000), checked: z.boolean() }))
  return c.json({ issue: await toggleCheckbox(ctxOf(c), c.req.param('ref'), input.version, input.index, input.line, input.checked) })
})

const relType = z.enum(['blocks', 'blocked_by', 'relates', 'duplicate_of'])
projectRoutes.post('/issues/:ref/relations', async (c) => {
  const input = await body(c, z.object({ type: relType, target: z.string() }))
  await addRelation(ctxOf(c), c.req.param('ref'), input.type, input.target)
  return c.json({ ok: true })
})
projectRoutes.delete('/issues/:ref/relations', async (c) => {
  const input = await body(c, z.object({ type: z.enum(['blocks', 'blocked_by', 'relates', 'duplicate_of', 'duplicated_by']), target: z.string() }))
  await removeRelation(ctxOf(c), c.req.param('ref'), input.type, input.target)
  return c.json({ ok: true })
})

projectRoutes.get('/issues/:ref/timeline', async (c) => {
  const q = parse(
    z.object({ kind: z.enum(['all', 'comments', 'changes']).default('all'), order: z.enum(['asc', 'desc']).default('asc'), before: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }),
    c.req.query(),
  )
  return c.json(await timeline(ctxOf(c), c.req.param('ref'), q))
})

projectRoutes.post('/issues/:ref/comments', async (c) => {
  const input = await body(c, z.object({ body: z.string().trim().min(1).max(20_000), parentId: z.string().optional(), operationId: opId }))
  const ctx = ctxOf(c)
  return c.json({ comment: await idempotent(ctx, input.operationId, () => addIssueComment(ctx, c.req.param('ref'), input.body, input.parentId)) }, 201)
})
projectRoutes.patch('/issues/:ref/comments/:id', async (c) => {
  const input = await body(c, z.object({ body: z.string().trim().min(1).max(20_000), version: z.number().int() }))
  return c.json({ comment: await editIssueComment(ctxOf(c), c.req.param('ref'), c.req.param('id'), input.version, input.body) })
})
projectRoutes.delete('/issues/:ref/comments/:id', async (c) => {
  await deleteIssueComment(ctxOf(c), c.req.param('ref'), c.req.param('id'))
  return c.json({ ok: true })
})

// ---------- dashboard, search, #[issue:KEY-N] pills ----------

slices.push({
  async home(ctx) {
    const r = await listIssues(ctx, { mine: true }, { offset: 0, limit: 8, sort: 'priority', q: undefined })
    return { issues: r.items.filter((i) => i.status !== 'done' && i.status !== 'canceled').slice(0, 6) }
  },
  async search(ctx, q) {
    const ids = await visibleProjectIds(ctx)
    if (!ids.length) return []
    const m = /^([A-Za-z]{2,6})-(\d+)$/.exec(q.trim())
    const rows = await ctx.db
      .select()
      .from(issues)
      .innerJoin(projects, eq(projects.id, issues.projectId))
      .where(
        and(
          inArray(issues.projectId, ids),
          isNull(issues.deletedAt),
          m ? and(eq(projects.key, m[1]!.toUpperCase()), eq(issues.number, Number(m[2]))) : or(like(issues.title, `%${q}%`), sql`(${projects.key} || '-' || ${issues.number}) like ${`%${q.toUpperCase()}%`}`),
        ),
      )
      .orderBy(desc(issues.updatedAt))
      .limit(8)
      .all()
    return rows.map((r) => ({ type: 'issue' as const, id: `${r.projects.key}-${r.issues.number}`, title: r.issues.title, subtitle: `${r.projects.key}-${r.issues.number}`, href: `/projects/${r.projects.key}/${r.projects.key}-${r.issues.number}` }))
  },
})

refResolvers.issue = async (ctx, ref) => {
  const { issue, project } = await getIssue(ctx, ref)
  const r = `${project.key}-${issue.number}`
  return { title: issue.title, href: `/projects/${project.key}/${r}`, status: issue.status, ref: r }
}

