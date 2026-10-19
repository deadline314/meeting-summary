import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { login, uniq } from './helpers'

describe('auth & accounts', () => {
  it('rejects unauthenticated api calls with the unified error shape', async () => {
    const r = await SELF.fetch('http://localhost/api/me')
    expect(r.status).toBe(401)
    const body = (await r.json()) as { error: { code: string; requestId: string } }
    expect(body.error.code).toBe('unauthenticated')
    expect(body.error.requestId).toBeTruthy()
  })

  it('new accounts are students; owner emails become teachers', async () => {
    const s = await login(uniq('s'))
    expect((await s.call<{ user: { role: string } }>('/api/me')).body.user.role).toBe('student')
    const o = await login('teacher@example.com')
    expect((await o.call<{ user: { role: string } }>('/api/me')).body.user.role).toBe('owner')
  })

  it('rename shows up in the directory immediately', async () => {
    const s = await login(uniq('r'), 'Old')
    const me = (await s.call<{ user: { id: string } }>('/api/me')).body.user
    await s.call('/api/me', { method: 'PATCH', body: { name: 'New Name' } })
    const dir = await s.call<{ items: { id: string; name: string }[] }>('/api/users')
    expect(dir.body.items.find((u) => u.id === me.id)?.name).toBe('New Name')
  })

  it('admin key: wrong 5 times locks, owner rotates, right key upgrades', async () => {
    const owner = await login('teacher@example.com')
    const { key } = (await owner.call<{ key: string }>('/api/admin/admin-key/rotate', { method: 'POST' })).body
    const s = await login(uniq('k'))
    for (let i = 0; i < 5; i++) expect((await s.call('/api/me/admin-key', { method: 'POST', body: { key: 'nope' } })).status).toBe(400)
    const locked = await s.call<{ error: { code: string } }>('/api/me/admin-key', { method: 'POST', body: { key } })
    expect(locked.body.error.code).toBe('admin_key_locked')
    const s2 = await login(uniq('k2'))
    const ok = await s2.call<{ user: { role: string } }>('/api/me/admin-key', { method: 'POST', body: { key } })
    expect(ok.body.user.role).toBe('admin')
  })

  it('students cannot reach admin APIs (404, not 403)', async () => {
    const s = await login(uniq('x'))
    expect((await s.call('/api/admin/members')).status).toBe(404)
  })

  it('disabling a member kills their session at once', async () => {
    const owner = await login('teacher@example.com')
    const s = await login(uniq('d'))
    const id = (await s.call<{ user: { id: string } }>('/api/me')).body.user.id
    await owner.call(`/api/admin/members/${id}`, { method: 'PATCH', body: { status: 'disabled' } })
    expect((await s.call('/api/me')).status).toBe(401)
  })

  it('the last teacher cannot be demoted', async () => {
    const owner = await login('teacher@example.com')
    const id = (await owner.call<{ user: { id: string } }>('/api/me')).body.user.id
    const r = await owner.call<{ error: { code: string } }>(`/api/admin/members/${id}`, { method: 'PATCH', body: { role: 'student' } })
    expect(r.body.error.code).toBe('last_owner')
  })
})
