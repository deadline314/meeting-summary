import { SELF } from 'cloudflare:test'
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
  it('duplicates a sub-tree with contiguous numbers, files and name-matched labels', async () => {
    const { a, k } = await setup()
    const k2 = key()
    await a.call('/api/projects', { method: 'POST', body: { key: k2, name: 'Other' } })
    const l1 = (await a.call<{ label: { id: string } }>(`/api/projects/${k}/labels`, { method: 'POST', body: { name: 'Bug', color: 1 } })).body.label
    const l2 = (await a.call<{ label: { id: string } }>(`/api/projects/${k}/labels`, { method: 'POST', body: { name: 'OnlyHere', color: 2 } })).body.label
    await a.call(`/api/projects/${k2}/labels`, { method: 'POST', body: { name: 'bug', color: 3 } })
    const root = (await a.call<{ issue: Issue & { id: string } }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'root', labelIds: [l1.id, l2.id] } })).body.issue
    for (const t of ['c1', 'c2', 'c3']) await a.call(`/api/projects/${k}/issues`, { method: 'POST', body: { title: t, parentRef: root.ref } })
    const up = await SELF.fetch(`http://localhost/api/files?parentType=issue&parentId=${root.id}`, {
      method: 'PUT',
      headers: { cookie: a.cookie, 'x-file-name': 'a.txt', 'content-type': 'text/plain', 'content-length': '5' },
      body: 'hello',
    })
    expect(up.status).toBe(201)
    // Someone else creating at the same time must not split the copied numbers.
    const [dup] = await Promise.all([
      a.call<{ ref: string; count: number; skipped: { labels: string[] } }>(`/api/issues/${root.ref}/duplicate`, { method: 'POST', body: { title: 'copy', key: k2, children: true, attachments: true, labels: true, assignees: true } }),
      a.call(`/api/projects/${k2}/issues`, { method: 'POST', body: { title: 'concurrent' } }),
    ])
    expect(dup.status).toBe(201)
    expect(dup.body.count).toBe(4)
    expect(dup.body.skipped.labels).toEqual(['OnlyHere'])
    const d = (await a.call<{ issue: Issue & { id: string; title: string; labels: { name: string }[] }; children: { ref: string }[] }>(`/api/issues/${dup.body.ref}`)).body
    expect(d.issue.title).toBe('copy')
    expect(d.issue.labels.map((l) => l.name)).toEqual(['bug'])
    const nums = [dup.body.ref, ...d.children.map((c) => c.ref)].map((r) => Number(r.split('-')[1])).sort((x, y) => x - y)
    expect(nums[3]! - nums[0]!).toBe(3)
    const fl = (await a.call<{ items: { id: string }[] }>(`/api/files?parentType=issue&parentId=${d.issue.id}`)).body.items
    expect(fl).toHaveLength(1)
    expect(await (await SELF.fetch(`http://localhost/files/${fl[0]!.id}`, { headers: { cookie: a.cookie } })).text()).toBe('hello')
    const tl = (await a.call<{ items: { change?: { data: { copiedFrom?: string } } }[] }>(`/api/issues/${dup.body.ref}/timeline?kind=changes`)).body.items
    expect(tl[0]!.change!.data.copiedFrom).toBe(root.ref)
  })
  it('timeline segments come from status changes', async () => {
    const { a, k } = await setup()
    const i = (await a.call<{ issue: Issue }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'tl' } })).body.issue
    const v2 = (await a.call<{ issue: Issue }>(`/api/issues/${i.ref}`, { method: 'PATCH', body: { version: i.version, status: 'in_progress' } })).body.issue
    await a.call(`/api/issues/${i.ref}`, { method: 'PATCH', body: { version: v2.version, status: 'done' } })
    const tl = (await a.call<{ items: { ref: string; segments: { status: string; to: number | null }[] }[]; total: number }>(`/api/timeline?key=${k}`)).body
    expect(tl.total).toBe(1)
    expect(tl.items[0]!.segments.map((s) => s.status)).toEqual(['todo', 'in_progress', 'done'])
    expect(tl.items[0]!.segments.every((s) => s.to !== null)).toBe(true)
  })
  it('stats count finished issues; saved views are per user and capped', async () => {
    const { a, k } = await setup()
    const i = (await a.call<{ issue: Issue }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 's' } })).body.issue
    const v2 = (await a.call<{ issue: Issue }>(`/api/issues/${i.ref}`, { method: 'PATCH', body: { version: i.version, status: 'in_progress' } })).body.issue
    await a.call(`/api/issues/${i.ref}`, { method: 'PATCH', body: { version: v2.version, status: 'done' } })
    await a.call(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'open' } })
    const st = (await a.call<{ lead: { n: number } | null; cycle: { n: number } | null; weeks: { done: number }[] }>(`/api/projects/${k}/stats`)).body
    expect(st.lead!.n).toBe(1)
    expect(st.cycle!.n).toBe(1)
    expect(st.weeks).toHaveLength(12)
    expect(st.weeks[11]!.done).toBe(1)
    expect((await a.call(`/api/projects/${k}`, { method: 'PATCH', body: { staleDays: 5 } })).status).toBe(400)
    expect((await a.call(`/api/projects/${k}`, { method: 'PATCH', body: { staleDays: 14 } })).status).toBe(200)

    expect((await a.call('/api/saved-views', { method: 'POST', body: { name: 'x', url: 'https://evil.example/' } })).status).toBe(400)
    const v = (await a.call<{ view: { id: string } }>('/api/saved-views', { method: 'POST', body: { name: 'mine', url: `/projects/${k}?view=board` } })).body.view
    await a.call(`/api/saved-views/${v.id}`, { method: 'PATCH', body: { name: 'renamed' } })
    const b = await login(uniq('pv'))
    expect((await b.call<{ items: unknown[] }>('/api/saved-views')).body.items).toHaveLength(0)
    expect((await b.call(`/api/saved-views/${v.id}`, { method: 'PATCH', body: { name: 'hijack' } })).status).toBe(404)
    for (let n = 1; n < 30; n++) await a.call('/api/saved-views', { method: 'POST', body: { name: `v${n}`, url: '/projects' } })
    expect((await a.call('/api/saved-views', { method: 'POST', body: { name: 'one too many', url: '/projects' } })).status).toBe(422)
    expect((await a.call<{ items: { name: string }[] }>('/api/saved-views')).body.items[0]!.name).toBe('renamed')
  })
})
