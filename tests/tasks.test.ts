import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { login, uniq } from './helpers'

const BASE = 'http://localhost'
const RUNNER = { authorization: 'Bearer dev-runner-token', 'content-type': 'application/json' }

async function put(cookie: string, path: string, name: string, body: string) {
  const r = await SELF.fetch(`${BASE}${path}`, {
    method: path.includes('/submissions') ? 'POST' : 'PUT',
    headers: { cookie, 'x-file-name': encodeURIComponent(name), 'content-type': 'text/plain', 'content-length': String(new TextEncoder().encode(body).length) },
    body,
  })
  return { status: r.status, body: (await r.json()) as Record<string, { id: string; status?: string }> }
}

async function claimAndReport(id: string, result: Record<string, unknown>) {
  const c = await SELF.fetch(`${BASE}/api/grader/claim`, { method: 'POST', headers: RUNNER, body: JSON.stringify({ job: id }) })
  expect(c.status).toBe(200)
  const sub = await SELF.fetch(`${BASE}/api/grader/jobs/${id}/submission`, { headers: RUNNER })
  expect(sub.status).toBe(200)
  const r = await SELF.fetch(`${BASE}/api/grader/jobs/${id}/result`, { method: 'POST', headers: RUNNER, body: JSON.stringify(result) })
  expect(r.status).toBe(200)
}

describe('tasks & grading', () => {
  it('full flow: trial → publish → submit → graded → leaderboard', async () => {
    const owner = await login('teacher@example.com')
    const { task } = (await owner.call<{ task: { id: string; version: number } }>('/api/tasks', { method: 'POST', body: { title: `T ${uniq('t')}`, dailyLimit: 2 } })).body
    const g = await put(owner.cookie, `/api/files?parentType=task&parentId=${task.id}`, 'grade.py', 'print("hi")')
    expect(g.status).toBe(201)
    let v = (await owner.call<{ task: { version: number } }>(`/api/tasks/${task.id}`, { method: 'PATCH', body: { version: task.version, graderFileId: g.body.file!.id } })).body.task.version

    // Publishing without a passing trial is refused.
    const early = await owner.call<{ error: { code: string } }>(`/api/tasks/${task.id}`, { method: 'PATCH', body: { version: v, status: 'published' } })
    expect(early.body.error.code).toBe('trial_required')

    const trial = await put(owner.cookie, `/api/tasks/${task.id}/submissions?trial=1`, 'sample.py', 'x=1')
    await claimAndReport(trial.body.submission!.id, { status: 'passed', score: 1, message: 'ok' })
    v = (await owner.call<{ task: { version: number } }>(`/api/tasks/${task.id}`)).body.task.version
    expect((await owner.call(`/api/tasks/${task.id}`, { method: 'PATCH', body: { version: v, status: 'published' } })).status).toBe(200)

    const a = await login(uniq('sa'))
    const b = await login(uniq('sb'))
    // Students never see grader ids and cannot read grader files.
    const seen = (await a.call<{ task: Record<string, unknown> }>(`/api/tasks/${task.id}`)).body.task
    expect(seen.graderFileId).toBeUndefined()
    expect((await SELF.fetch(`${BASE}/files/${g.body.file!.id}`, { headers: { cookie: a.cookie } })).status).toBe(404)

    const s1 = await put(a.cookie, `/api/tasks/${task.id}/submissions`, 'a.py', 'print(1)')
    expect(s1.status).toBe(201)
    await claimAndReport(s1.body.submission!.id, { status: 'failed', score: 0.4, message: '準確率 40%，未達 60%' })
    const s2 = await put(a.cookie, `/api/tasks/${task.id}/submissions`, 'a.py', 'print(2)')
    await claimAndReport(s2.body.submission!.id, { status: 'passed', score: 0.9, message: 'ok' })
    // Third within 24h exceeds dailyLimit=2.
    const s3 = await put(a.cookie, `/api/tasks/${task.id}/submissions`, 'a.py', 'print(3)')
    expect(s3.status).toBe(429)

    const sb = await put(b.cookie, `/api/tasks/${task.id}/submissions`, 'b.py', 'print(1)')
    await claimAndReport(sb.body.submission!.id, { status: 'passed', score: 0.95 })

    const mine = await a.call<{ items: { status: string; message: string }[] }>(`/api/tasks/${task.id}/submissions`)
    expect(mine.body.items.map((x) => x.status)).toEqual(['passed', 'failed'])
    expect(mine.body.items[1]!.message).toContain('未達')

    const lb = await a.call<{ items: { rank: number; score: number }[] }>(`/api/tasks/${task.id}/leaderboard`)
    expect(lb.body.items.map((x) => x.score)).toEqual([0.95, 0.9])
    // Paged: one row per page, total and the caller's own row come along.
    const page = await a.call<{ items: { score: number }[]; total: number; mine: { rank: number } | null }>(`/api/tasks/${task.id}/leaderboard?limit=1&offset=1`)
    expect([page.body.items.length, page.body.total, page.body.items[0]!.score]).toEqual([1, 2, 0.9])
    expect(page.body.mine?.rank).toBeGreaterThan(0)
    const one = await a.call<{ items: unknown[]; total: number }>(`/api/tasks/${task.id}/submissions?limit=1`)
    expect([one.body.items.length, one.body.total]).toEqual([1, 2])
    // B cannot see A's submissions.
    expect((await b.call<{ items: unknown[] }>(`/api/tasks/${task.id}/submissions`)).body.items).toHaveLength(1)
  })

  it('rejects forged or unauthenticated grading reports', async () => {
    const r1 = await SELF.fetch(`${BASE}/api/grader/jobs/x/result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"status":"passed"}' })
    expect(r1.status).toBe(401)
    const r2 = await SELF.fetch(`${BASE}/api/grader/jobs/x/result`, {
      method: 'POST',
      headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.sig', 'content-type': 'application/json' },
      body: '{"status":"passed"}',
    })
    expect(r2.status).toBe(401)
  })

  it('students cannot create tasks', async () => {
    const s = await login(uniq('st'))
    expect((await s.call('/api/tasks', { method: 'POST', body: { title: 'x' } })).status).toBe(404)
  })
})
