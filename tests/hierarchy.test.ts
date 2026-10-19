import { describe, expect, it } from 'vitest'
import { login, projectKey, uniq } from './helpers'

type Me = { user: { id: string } }
type Detail = { project: { id: string; key: string; members: { userId: string; role: string }[]; ancestors: { key: string }[]; children: { key: string }[] } }
type Row = { ref: string; version: number; status: string; blockedBy: { ref: string }[]; hiddenBlockers: number; blocks: { ref: string }[] }
const wait = () => new Promise((r) => setTimeout(r, 50))

async function person(p: string) {
  const s = await login(uniq(p))
  return { ...s, id: (await s.call<Me>('/api/me')).body.user.id }
}

describe('project tree, members and blocking', () => {
  it('sub-projects copy members on request, refuse cycles and depth over 5, and do not inherit access', async () => {
    const a = await person('ha')
    const b = await person('hb')
    const c = await person('hc')
    const root = projectKey('R')
    await a.call('/api/projects', { method: 'POST', body: { key: root, name: 'root', members: [{ userId: b.id, role: 'member' }] } })
    const rootId = (await a.call<Detail>(`/api/projects/${root}`)).body.project.id
    // Copy the parent's members; the picked role wins over the copied one.
    const kid = projectKey('K')
    const r = await a.call<Detail>('/api/projects', { method: 'POST', body: { key: kid, name: 'kid', parentId: rootId, copyParentMembers: true, members: [{ userId: c.id, role: 'viewer' }] } })
    expect(r.status).toBe(201)
    const kidD = (await a.call<Detail>(`/api/projects/${kid}`)).body.project
    expect(kidD.members.map((m) => `${m.userId === a.id ? 'a' : m.userId === b.id ? 'b' : 'c'}:${m.role}`).sort()).toEqual(['a:owner', 'b:member', 'c:viewer'])
    expect(kidD.ancestors.map((x) => x.key)).toEqual([root])
    // c sees the child but not the root: no breadcrumb, and the root's page lists no hidden things.
    expect((await c.call(`/api/projects/${root}`)).status).toBe(404)
    expect((await c.call<Detail>(`/api/projects/${kid}`)).body.project.ancestors).toEqual([])
    expect((await a.call<Detail>(`/api/projects/${root}`)).body.project.children.map((x) => x.key)).toEqual([kid])
    // A viewer can't hang a project under one they only read.
    const cOwn = projectKey('C')
    await c.call('/api/projects', { method: 'POST', body: { key: cOwn, name: 'c' } })
    expect((await c.call(`/api/projects/${cOwn}`, { method: 'PATCH', body: { parentId: kidD.id } })).status).toBe(404)
    // Cycle: root under its own child.
    const cyc = await a.call<{ error: { code: string } }>(`/api/projects/${root}`, { method: 'PATCH', body: { parentId: kidD.id } })
    expect(cyc.body.error.code).toBe('cycle')
    // Depth: root(1) > kid(2) > 3 > 4 > 5 is fine, a sixth level is not.
    let parent = kidD.id
    for (let i = 3; i <= 5; i++) {
      const k = projectKey('D')
      await a.call('/api/projects', { method: 'POST', body: { key: k, name: `l${i}`, parentId: parent } })
      parent = (await a.call<Detail>(`/api/projects/${k}`)).body.project.id
    }
    const deep = await a.call<{ error: { code: string } }>('/api/projects', { method: 'POST', body: { key: projectKey('X'), name: 'too deep', parentId: parent } })
    expect(deep.body.error.code).toBe('depth_exceeded')
    // Deleting a parent moves its children to the top level.
    await a.call(`/api/projects/${root}/state`, { method: 'POST', body: { action: 'archive' } })
    await a.call(`/api/projects/${root}`, { method: 'DELETE', body: { confirmKey: root } })
    expect((await a.call<{ project: { parentId: string | null } }>(`/api/projects/${kid}`)).body.project.parentId).toBeNull()
  })

  it('adds several members at once and keeps existing roles', async () => {
    const a = await person('ma')
    const b = await person('mb')
    const c = await person('mc')
    const k = projectKey('M')
    await a.call('/api/projects', { method: 'POST', body: { key: k, name: 'm', members: [{ userId: b.id, role: 'owner' }] } })
    const r = await a.call<{ added: string[] }>(`/api/projects/${k}/members`, { method: 'POST', body: { userIds: [b.id, c.id], role: 'viewer' } })
    expect(r.body.added).toEqual([c.id])
    const roles = Object.fromEntries((await a.call<Detail>(`/api/projects/${k}`)).body.project.members.map((m) => [m.userId, m.role]))
    expect(roles[b.id]).toBe('owner')
    expect(roles[c.id]).toBe('viewer')
    // A viewer gets 404 on writes.
    expect((await c.call(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'nope' } })).status).toBe(404)
  })

  it('blocking: both directions, no cycles, hidden projects stay hidden, filters and the unblocked notice', async () => {
    const a = await person('ba')
    const b = await person('bb')
    const k = projectKey('B')
    await a.call('/api/projects', { method: 'POST', body: { key: k, name: 'b', members: [{ userId: b.id, role: 'member' }] } })
    const mk = async (title: string, extra: Record<string, unknown> = {}) => (await a.call<{ issue: Row }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title, ...extra } })).body.issue
    const x = await mk('x')
    const y = await mk('y', { assigneeIds: [b.id] })
    const z = await mk('z')
    await a.call(`/api/issues/${x.ref}/relations`, { method: 'POST', body: { type: 'blocks', target: y.ref } })
    await a.call(`/api/issues/${z.ref}/relations`, { method: 'POST', body: { type: 'blocked_by', target: y.ref } })
    const cyc = await a.call<{ error: { code: string } }>(`/api/issues/${z.ref}/relations`, { method: 'POST', body: { type: 'blocks', target: x.ref } })
    expect(cyc.body.error.code).toBe('cycle')
    const list = async (q = '') => (await a.call<{ items: Row[] }>(`/api/projects/${k}/issues?status=todo${q}`)).body.items
    const rowY = (await list()).find((r) => r.ref === y.ref)!
    expect(rowY.blockedBy.map((r) => r.ref)).toEqual([x.ref])
    expect(rowY.blocks.map((r) => r.ref)).toEqual([z.ref])
    expect((await list('&blocking=blocked')).map((r) => r.ref).sort()).toEqual([y.ref, z.ref].sort())
    expect((await list('&blocking=blocking')).map((r) => r.ref).sort()).toEqual([x.ref, y.ref].sort())

    // A blocker in a project b can't see: counted, never named.
    const secret = projectKey('S')
    await a.call('/api/projects', { method: 'POST', body: { key: secret, name: 'secret' } })
    const s = (await a.call<{ issue: Row }>(`/api/projects/${secret}/issues`, { method: 'POST', body: { title: 'classified' } })).body.issue
    await a.call(`/api/issues/${s.ref}/relations`, { method: 'POST', body: { type: 'blocks', target: z.ref } })
    const zForB = (await b.call<{ items: Row[] }>(`/api/projects/${k}/issues?status=todo`)).body.items.find((r) => r.ref === z.ref)!
    expect(zForB.blockedBy.map((r) => r.ref)).toEqual([y.ref])
    expect(zForB.hiddenBlockers).toBe(1)
    expect(JSON.stringify(zForB)).not.toContain('classified')
    const zForA = (await list()).find((r) => r.ref === z.ref)!
    expect(zForA.blockedBy.map((r) => r.ref).sort()).toEqual([s.ref, y.ref].sort())

    // Finishing the only blocker of y tells y's assignee; z still has blockers, so nobody hears about it.
    const xNow = (await list()).find((r) => r.ref === x.ref)!
    await a.call(`/api/issues/${x.ref}`, { method: 'PATCH', body: { version: xNow.version, status: 'done' } })
    await wait()
    const nb = (await b.call<{ items: { type: string; data: { ref: string } }[] }>('/api/notifications')).body.items
    expect(nb.filter((n) => n.type === 'issue_unblocked').map((n) => n.data.ref)).toEqual([y.ref])
    expect((await list()).find((r) => r.ref === y.ref)!.blockedBy).toEqual([])
    // Removing a relation is in both issues' history.
    await a.call(`/api/issues/${y.ref}/relations`, { method: 'DELETE', body: { type: 'blocks', target: z.ref } })
    const hist = (await a.call<{ items: { kind: string; change?: { action: string } }[] }>(`/api/issues/${z.ref}/timeline?kind=changes`)).body.items
    expect(hist.some((h) => h.change?.action === 'unrelated')).toBe(true)
  })
})
