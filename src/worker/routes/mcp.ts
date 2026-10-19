import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, C, Ctx } from '../context'
import { requireScope } from '../context'
import { ISSUE_PRIORITIES, ISSUE_STATUSES, users } from '../db/schema'
import { AppError } from '../lib/errors'
import { errorFields, log } from '../lib/log'
import { authenticateKey } from '../services/api-keys'
import { addIssueComment, batchUpdate, createIssue, duplicateIssue, getIssue, idempotent, issueDetail, listIssues, updateIssue } from '../services/issues'
import { createNote, getNote, listNotes, noteMarkdown } from '../services/notes'
import { access, addMembers, createProject, listProjects, projectDto, setProjectState } from '../services/projects'
import { directory } from '../services/users'
import { listSubmissions, listTasks } from '../services/tasks'

/*
 * Model Context Protocol over Streamable HTTP, stateless: every POST is one JSON-RPC
 * request answered with JSON (no SSE). Tools call the same services as the web UI, so
 * permissions and activity logging are identical; writes are tagged source = "mcp".
 */

type Tool = { name: string; description: string; input: z.ZodObject; run(ctx: Ctx, args: never): Promise<unknown> }

const status = z.enum(ISSUE_STATUSES)
const priority = z.enum(ISSUE_PRIORITIES)
const operationId = z.string().max(100).optional().describe('Idempotency key: retries with the same id do not repeat the write')

const tool = <T extends z.ZodObject>(name: string, description: string, input: T, run: (ctx: Ctx, args: z.infer<T>) => Promise<unknown>): Tool => ({ name, description, input, run: run as Tool['run'] })

const TOOLS: Tool[] = [
  tool('users_list', 'List members of the site (id, name, role). Use ids for assignees and mentions.', z.object({}), async (ctx) => directory(ctx)),
  tool('projects_list', 'List projects you can see, with your role and open issue counts.', z.object({}), async (ctx) => listProjects(ctx)),
  tool('project_get', 'Get one project with its members.', z.object({ key: z.string().describe('Project key, e.g. CATS') }), async (ctx, a) => {
    const { project, role } = await access(ctx, { key: a.key })
    return projectDto(ctx, project, role)
  }),
  tool(
    'project_create',
    'Create a project (you become its owner). Needs a "manage" key.',
    z.object({ key: z.string().regex(/^[A-Za-z]{2,6}$/), name: z.string().min(1).max(80), description: z.string().max(5000).optional(), operationId }),
    async (ctx, a) => idempotent(ctx, a.operationId, () => createProject(ctx, a)),
  ),
  tool(
    'project_member_add',
    'Add a member to a project you own. Needs a "manage" key.',
    z.object({ key: z.string(), userId: z.string(), role: z.enum(['viewer', 'member', 'owner']).default('member') }),
    async (ctx, a) => addMembers(ctx, a.key, [a.userId], a.role),
  ),
  tool('project_close', 'Close (or reopen) a project.', z.object({ key: z.string(), reopen: z.boolean().default(false) }), async (ctx, a) => setProjectState(ctx, a.key, a.reopen ? 'reopen' : 'close')),
  tool(
    'issues_query',
    'Search issues. Give `key` for one project, or `mine: true` for issues assigned to you across projects. One status per call keeps paging exact.',
    z.object({
      key: z.string().optional(),
      mine: z.boolean().optional(),
      status: status.optional(),
      priority: priority.optional(),
      assigneeId: z.string().optional(),
      q: z.string().max(100).optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(30),
    }),
    async (ctx, a) => {
      const r = await listIssues(ctx, { key: a.key, mine: a.mine ?? !a.key }, { status: a.status, priority: a.priority, assigneeId: a.assigneeId, q: a.q, offset: a.offset, limit: a.limit })
      return { total: r.total, items: r.items.map(({ description: _d, ...i }) => i) }
    },
  ),
  tool('issue_get', 'Get an issue by its ref (e.g. CATS-12): description, relations, sub-issues.', z.object({ ref: z.string() }), async (ctx, a) => issueDetail(ctx, a.ref)),
  tool(
    'issue_create',
    'Create an issue in a project.',
    z.object({
      key: z.string(),
      title: z.string().min(1).max(300),
      description: z.string().max(100_000).optional(),
      status: status.optional(),
      priority: priority.optional(),
      assigneeIds: z.array(z.string()).max(20).optional(),
      labelIds: z.array(z.string()).max(20).optional(),
      parentRef: z.string().optional(),
      dueAt: z.number().int().optional().describe('Unix ms'),
      operationId,
    }),
    async (ctx, { key, operationId: op, ...input }) => idempotent(ctx, op, () => createIssue(ctx, key, input)),
  ),
  tool(
    'issue_update',
    'Update fields of an issue. Pass `version` from issue_get to avoid overwriting someone else; omitted means "latest".',
    z.object({
      ref: z.string(),
      version: z.number().int().optional(),
      title: z.string().min(1).max(300).optional(),
      description: z.string().max(100_000).optional(),
      status: status.optional(),
      priority: priority.optional(),
      assigneeIds: z.array(z.string()).max(20).optional(),
      labelIds: z.array(z.string()).max(20).optional(),
      parentRef: z.string().nullable().optional(),
      dueAt: z.number().int().nullable().optional(),
      operationId,
    }),
    async (ctx, { ref, version, operationId: op, ...patch }) =>
      idempotent(ctx, op, async () => updateIssue(ctx, ref, version ?? (await getIssue(ctx, ref)).issue.version, patch)),
  ),
  tool(
    'issue_batch_update',
    'Apply one change to 1–50 issues. Each issue succeeds or fails on its own.',
    z.object({
      refs: z.array(z.string()).min(1).max(50),
      status: status.optional(),
      priority: priority.optional(),
      assigneeIds: z.array(z.string()).max(20).optional(),
      operationId,
    }),
    async (ctx, { refs, operationId: op, ...patch }) =>
      idempotent(ctx, op, async () => batchUpdate(ctx, await Promise.all(refs.map(async (ref) => ({ ref, version: (await getIssue(ctx, ref)).issue.version }))), patch)),
  ),
  tool(
    'issue_comment',
    'Comment on an issue (Markdown). Mention people as @[user:<id>], reference issues as #[issue:KEY-N].',
    z.object({ ref: z.string(), body: z.string().min(1).max(20_000), operationId }),
    async (ctx, a) => idempotent(ctx, a.operationId, () => addIssueComment(ctx, a.ref, a.body)),
  ),
  tool(
    'issue_duplicate',
    'Copy an issue into a project (same or another). Optionally copies the whole sub-tree, attachments, labels (matched by name) and assignees (only those who can see the target).',
    z.object({ ref: z.string(), key: z.string().describe('Target project key'), title: z.string().min(1).max(300).optional(), children: z.boolean().default(false), attachments: z.boolean().default(false), labels: z.boolean().default(true), assignees: z.boolean().default(false), operationId }),
    async (ctx, { ref, operationId: op, title, ...o }) => idempotent(ctx, op, async () => duplicateIssue(ctx, ref, { ...o, title: title ?? (await getIssue(ctx, ref)).issue.title })),
  ),
  tool(
    'notes_list',
    'List meeting notes (newest first), optionally searching title and text.',
    z.object({ q: z.string().max(100).optional(), from: z.number().int().optional(), to: z.number().int().optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(20) }),
    async (ctx, a) => listNotes(ctx, a),
  ),
  tool('note_get', 'Read a meeting note as Markdown (live content, including the info header).', z.object({ id: z.string() }), async (ctx, a) => {
    const n = await getNote(ctx, a.id)
    const names = new Map((await ctx.db.select({ id: users.id, name: users.name }).from(users).all()).map((u) => [u.id, u.name]))
    return { id: n.id, title: n.title, startsAt: n.startsAt, markdown: await noteMarkdown(ctx, n, names, 'zh') }
  }),
  tool(
    'note_create',
    'Create a meeting note from the default template.',
    z.object({ title: z.string().min(1).max(120), startsAt: z.number().int().describe('Unix ms'), endsAt: z.number().int().optional(), location: z.string().max(500).optional(), attendeeIds: z.array(z.string()).max(100).optional(), operationId }),
    async (ctx, { operationId: op, ...input }) => idempotent(ctx, op, () => createNote(ctx, input, 'zh')),
  ),
  tool('tasks_list', 'List tasks you can see with your best result.', z.object({}), async (ctx) => (await listTasks(ctx)).map(({ description: _d, ...t }) => t)),
  tool('task_my_submissions', 'Your submissions for a task, with status, score and failure reason.', z.object({ taskId: z.string() }), async (ctx, a) =>
    (await listSubmissions(ctx, a.taskId, { all: false, trial: false })).items.map(({ log: _l, ...s }) => s),
  ),
]

const WRITE_TOOLS = new Set(['project_create', 'project_member_add', 'project_close', 'issue_create', 'issue_update', 'issue_batch_update', 'issue_comment', 'issue_duplicate', 'note_create'])
const MANAGE_TOOLS = new Set(['project_create', 'project_member_add', 'project_close'])

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> }

const ok = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result })
const fail = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

async function handle(c: C, ctx: Ctx, msg: Rpc) {
  switch (msg.method) {
    case 'initialize':
      return ok(msg.id, {
        protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'lab-notes', version: c.env.APP_VERSION },
        instructions: 'Lab Notes: meeting notes, tasks and Linear-style issues. Issue refs look like KEY-12. Your access matches the website exactly.',
      })
    case 'ping':
      return ok(msg.id, {})
    case 'tools/list':
      return ok(msg.id, {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.input, { io: 'input' }) })),
      })
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      const t = TOOLS.find((x) => x.name === name)
      if (!t) return fail(msg.id, -32602, `Unknown tool ${name}`)
      try {
        if (MANAGE_TOOLS.has(name)) requireScope(ctx, 'manage')
        else if (WRITE_TOOLS.has(name)) requireScope(ctx, 'write')
        const args = t.input.safeParse(msg.params?.arguments ?? {})
        if (!args.success) return ok(msg.id, { isError: true, content: [{ type: 'text', text: `Invalid arguments: ${args.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` }] })
        const out = await t.run(ctx, args.data as never)
        return ok(msg.id, { content: [{ type: 'text', text: JSON.stringify(out ?? { ok: true }) }] })
      } catch (err) {
        const text = err instanceof AppError ? `${err.code}: ${err.message}` : 'internal error'
        if (!(err instanceof AppError)) log('error', 'mcp tool failed', { tool: name, requestId: ctx.requestId, ...errorFields(err) })
        return ok(msg.id, { isError: true, content: [{ type: 'text', text }] })
      }
    }
    default:
      return msg.id === undefined ? null : fail(msg.id, -32601, `Method not found: ${msg.method}`)
  }
}

export const mcpRoutes = new Hono<AppEnv>()

async function serve(c: C, secret: string | undefined) {
  const auth = secret ? await authenticateKey(c.get('db'), secret, (p) => c.executionCtx.waitUntil(p)) : null
  if (!auth) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Missing or invalid API key' } }, 401, { 'www-authenticate': 'Bearer' })
  const ctx: Ctx = {
    db: c.get('db'),
    env: c.env,
    user: auth.user,
    source: 'mcp',
    requestId: c.get('requestId'),
    origin: new URL(c.req.url).origin,
    apiKey: auth.grant,
    waitUntil: (p) => c.executionCtx.waitUntil(p),
  }
  let body: Rpc | Rpc[]
  try {
    body = await c.req.json()
  } catch {
    return c.json(fail(null, -32700, 'Parse error'), 400)
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(c, ctx, m)))).filter(Boolean)
    return out.length ? c.json(out) : c.body(null, 202)
  }
  const out = await handle(c, ctx, body)
  return out ? c.json(out) : c.body(null, 202)
}

const bearer = (c: C) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
mcpRoutes.post('/', (c) => serve(c, bearer(c)))
/** URL-embedded key for clients that can only take a URL (keep it private, like a password). */
mcpRoutes.post('/k/:key', (c) => serve(c, c.req.param('key')))
mcpRoutes.get('/', (c) => c.body(null, 405, { allow: 'POST' }))
mcpRoutes.get('/k/:key', (c) => c.body(null, 405, { allow: 'POST' }))
mcpRoutes.delete('/', (c) => c.body(null, 405))
