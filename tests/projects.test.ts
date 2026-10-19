import { describe, expect, it } from 'vitest'
import { login, uniq } from './helpers'

const key = () => `P${crypto.randomUUID().replace(/[^a-z]/g, '').slice(0, 4).toUpperCase().padEnd(4, 'X')}`
type Issue = { ref: string; version: number; status: string; blockedBy: { ref: string }[]; assigneeIds: string[] }

async function setup() {
  const a = await login(uniq('pa'))
  const aId = (await a.call<{ user: { id: string } }>('/api/me')).body.user.id
  const k = key()
  const r = await a.call('/api/projects', { method: 'POST', body: { key: k, name: 'Proj' } })
  expect(r.status).toBe(201)
  return { a, aId, k }
}

describe('projects & issues', () => {
  it('non-members get 404; private projects are hidden from admins until shared', async () => {
    const { a, k } = await setup()
    const out = await login(uniq('out'))
    expect((await out.call(`/api/projects/${k}`)).status).toBe(404)
    expect((await out.call(`/api/projects/${k}/issues`)).status).toBe(404)
    const owner = await login('teacher@example.com')
    expect((await owner.call(`/api/projects/${k}`)).status).toBe(404) // private: invisible to admins
    const b = await login(uniq('pb'))
    const bId = (await b.call<{ user: { id: string } }>('/api/me')).body.user.id
    const add = await a.call<{ becameShared: boolean }>(`/api/projects/${k}/members`, { method: 'POST', body: { userId: bId } })
    expect(add.body.becameShared).toBe(true)
    expect((await owner.call(`/api/projects/${k}`)).status).toBe(200) // shared now
    await a.call(`/api/projects/${k}`, { method: 'PATCH', body: { hiddenFromAdmins: true } })
    expect((await owner.call(`/api/projects/${k}`)).status).toBe(404)
  })

  it('numbers issues KEY-1..N without gaps under concurrency', async () => {
    const { a, k } = await setup()
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => a.call<{ issue: Issue }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: `t${i}` } })))
    const nums = rs.map((r) => Number(r.body.issue.ref.split('-')[1])).sort((x, y) => x - y)
    expect(nums).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
  })

  it('optimistic lock, batch partial failure and idempotent retries', async () => {
    const { a, k } = await setup()
    const i1 = (await a.call<{ issue: Issue }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'one' } })).body.issue
    const i2 = (await a.call<{ issue: Issue }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'two' } })).body.issue
    expect((await a.call(`/api/issues/${i1.ref}`, { method: 'PATCH', body: { version: i1.version, status: 'in_progress' } })).status).toBe(200)
    expect((await a.call(`/api/issues/${i1.ref}`, { method: 'PATCH', body: { version: i1.version, priority: 'high' } })).status).toBe(409)
    const batch = await a.call<{ results: { ok: boolean }[] }>('/api/issues/batch', { method: 'POST', body: { items: [i1, i2].map((i) => ({ ref: i.ref, version: i.version })), patch: { priority: 'low' } } })
    expect(batch.body.results.map((r) => r.ok)).toEqual([false, true])
    const op = crypto.randomUUID()
    const c1 = await a.call<{ issue: Issue }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'once', operationId: op } })
    const c2 = await a.call<{ issue: Issue }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'once', operationId: op } })
    expect(c2.body.issue.ref).toBe(c1.body.issue.ref)
  })

  it('assignees must see the project; closed projects refuse new issues', async () => {
    const { a, aId, k } = await setup()
    const out = await login(uniq('o2'))
    const outId = (await out.call<{ user: { id: string } }>('/api/me')).body.user.id
    const bad = await a.call<{ error: { code: string } }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'x', assigneeIds: [outId] } })
    expect(bad.body.error.code).toBe('not_visible')
    expect((await a.call(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'x', assigneeIds: [aId] } })).status).toBe(201)
    await a.call(`/api/projects/${k}/state`, { method: 'POST', body: { action: 'close' } })
    const closed = await a.call<{ error: { code: string } }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'y' } })
    expect(closed.body.error.code).toBe('project_inactive')
  })

  it('blocked-by is derived and ignores finished blockers; parent cycles are refused', async () => {
    const { a, k } = await setup()
    const mk = async (title: string) => (await a.call<{ issue: Issue }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title } })).body.issue
    const x = await mk('blocker')
    const y = await mk('blocked')
    await a.call(`/api/issues/${x.ref}/relations`, { method: 'POST', body: { type: 'blocks', target: y.ref } })
    let d = (await a.call<{ issue: Issue }>(`/api/issues/${y.ref}`)).body.issue
    expect(d.blockedBy.map((b) => b.ref)).toEqual([x.ref])
    await a.call(`/api/issues/${x.ref}`, { method: 'PATCH', body: { version: x.version, status: 'done' } })
    d = (await a.call<{ issue: Issue }>(`/api/issues/${y.ref}`)).body.issue
    expect(d.blockedBy).toEqual([])
    const child = (await a.call<{ issue: Issue }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'child', parentRef: y.ref } })).body.issue
    const cyc = await a.call<{ error: { code: string } }>(`/api/issues/${y.ref}`, { method: 'PATCH', body: { version: d.version, parentRef: child.ref } })
    expect(cyc.body.error.code).toBe('cycle')
  })

  it('last owner stays; removing a member clears their assignments', async () => {
    const { a, aId, k } = await setup()
    const last = await a.call<{ error: { code: string } }>(`/api/projects/${k}/members/${aId}`, { method: 'PATCH', body: { role: 'member' } })
    expect(last.body.error.code).toBe('last_owner')
    const b = await login(uniq('pc'))
    const bId = (await b.call<{ user: { id: string } }>('/api/me')).body.user.id
    await a.call(`/api/projects/${k}/members`, { method: 'POST', body: { userId: bId } })
    const i = (await a.call<{ issue: Issue }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'z', assigneeIds: [bId] } })).body.issue
    await a.call(`/api/projects/${k}/members/${bId}`, { method: 'DELETE' })
    expect((await a.call<{ issue: Issue }>(`/api/issues/${i.ref}`)).body.issue.assigneeIds).toEqual([])
    expect((await b.call(`/api/issues/${i.ref}`)).status).toBe(404)
  })

  it('checkbox toggle refuses when the line changed', async () => {
    const { a, k } = await setup()
    const i = (await a.call<{ issue: Issue }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'c', description: '- [ ] one\n- [ ] two' } })).body.issue
    const ok = await a.call<{ issue: Issue & { description: string } }>(`/api/issues/${i.ref}/checkbox`, { method: 'POST', body: { version: i.version, index: 1, line: '- [ ] two', checked: true } })
    expect(ok.body.issue.description).toBe('- [ ] one\n- [x] two')
    const stale = await a.call(`/api/issues/${i.ref}/checkbox`, { method: 'POST', body: { version: ok.body.issue.version, index: 0, line: '- [ ] something else', checked: true } })
    expect(stale.status).toBe(409)
  })

  it('lifecycle: delete requires archive and the typed key', async () => {
    const { a, k } = await setup()
    expect((await a.call(`/api/projects/${k}`, { method: 'DELETE', body: { confirmKey: k } })).status).toBe(422)
    await a.call(`/api/projects/${k}/state`, { method: 'POST', body: { action: 'archive' } })
    expect((await a.call(`/api/projects/${k}`, { method: 'DELETE', body: { confirmKey: 'NOPE' } })).status).toBe(400)
    expect((await a.call(`/api/projects/${k}`, { method: 'DELETE', body: { confirmKey: k } })).status).toBe(200)
    expect((await a.call(`/api/projects/${k}`)).status).toBe(404)
  })
})
