import { describe, expect, it } from 'vitest'
import { login, uniq, projectKey } from './helpers'

type N = { items: { type: string; entityId: string; data: { count?: number } }[]; unread: number; unreadIssues: string[] }
const key = () => projectKey('N')
const wait = () => new Promise((r) => setTimeout(r, 50))

async function pair() {
  const a = await login(uniq('na'))
  const b = await login(uniq('nb'))
  const bId = (await b.call<{ user: { id: string } }>('/api/me')).body.user.id
  const k = key()
  const p = (await a.call<{ project: { id: string } }>('/api/projects', { method: 'POST', body: { key: k, name: 'n' } })).body.project
  await a.call(`/api/projects/${k}/members`, { method: 'POST', body: { userId: bId, role: 'member' } })
  return { a, b, bId, k, pid: p.id }
}

describe('notifications', () => {
  it('subscribers get merged updates within a minute; own actions and unsubscribed users get nothing', async () => {
    const { a, b, bId, k } = await pair()
    const i = (await a.call<{ issue: { ref: string; id: string; version: number } }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'x', assigneeIds: [bId] } })).body.issue
    let v = i.version
    for (const s of ['in_progress', 'in_review', 'done'] as const) v = (await a.call<{ issue: { version: number } }>(`/api/issues/${i.ref}`, { method: 'PATCH', body: { version: v, status: s } })).body.issue.version
    await wait()
    const nb = (await b.call<N>('/api/notifications')).body
    const mine = nb.items.filter((n) => n.entityId === i.id)
    expect(mine).toHaveLength(1)
    expect(mine[0]!.data.count).toBe(4)
    expect(nb.unreadIssues).toContain(i.id)
    // The actor never hears about their own changes.
    expect((await a.call<N>('/api/notifications')).body.items.filter((n) => n.entityId === i.id)).toHaveLength(0)
    // Opening the issue marks it read; unsubscribing stops further notices.
    await b.call('/api/notifications/read', { method: 'POST', body: { entityId: i.id } })
    await b.call(`/api/issues/${i.ref}/subscription`, { method: 'PUT', body: { on: false } })
    expect((await b.call<{ subscribed: boolean }>(`/api/issues/${i.ref}`)).body.subscribed).toBe(false)
    await a.call(`/api/issues/${i.ref}/comments`, { method: 'POST', body: { body: 'hello' } })
    await wait()
    expect((await b.call<N>('/api/notifications')).body.unread).toBe(0)
  })

  it('project × event preferences mute just that pair', async () => {
    const { a, b, bId, k, pid } = await pair()
    await b.call('/api/me', { method: 'PATCH', body: { prefs: { notifyOff: [`${pid}:issue_status`] } } })
    const i = (await a.call<{ issue: { ref: string; id: string; version: number } }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'y' } })).body.issue
    await b.call(`/api/issues/${i.ref}/subscription`, { method: 'PUT', body: { on: true } })
    await a.call(`/api/issues/${i.ref}`, { method: 'PATCH', body: { version: i.version, status: 'in_progress' } })
    await wait()
    expect((await b.call<N>('/api/notifications')).body.items.filter((n) => n.entityId === i.id)).toHaveLength(0)
    await a.call(`/api/issues/${i.ref}/comments`, { method: 'POST', body: { body: `hi @[user:${bId}]` } })
    await wait()
    expect((await b.call<N>('/api/notifications')).body.items.find((n) => n.entityId === i.id)?.type).toBe('mention')
  })
  it('citing an issue in a comment logs "referenced from" on the cited issue once', async () => {
    const { a, k } = await pair()
    const x = (await a.call<{ issue: { ref: string } }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'x' } })).body.issue
    const y = (await a.call<{ issue: { ref: string } }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title: 'y' } })).body.issue
    const c = (await a.call<{ comment: { id: string; version: number } }>(`/api/issues/${x.ref}/comments`, { method: 'POST', body: { body: `see #[issue:${y.ref}]` } })).body.comment
    expect((await a.call(`/api/issues/${x.ref}/comments/${c.id}`, { method: 'PATCH', body: { body: `still #[issue:${y.ref}]`, version: c.version } })).status).toBe(200)
    const tl = (await a.call<{ items: { change?: { action: string; data: { from?: string } } }[] }>(`/api/issues/${y.ref}/timeline?kind=changes`)).body.items
    const refs = tl.filter((i) => i.change?.action === 'referenced')
    expect(refs).toHaveLength(1)
    expect(refs[0]!.change!.data.from).toBe(x.ref)
  })
})
