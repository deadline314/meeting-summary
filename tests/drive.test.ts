import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { login, uniq } from './helpers'

describe('Drive links', () => {
  it('store owner and type, refuse non-Drive URLs, and deleting only drops the pointer', async () => {
    const a = await login(uniq('dr'))
    const note = (await a.call<{ note: { id: string } }>('/api/notes', { method: 'POST', body: { title: 'd', startsAt: Date.now() } })).body.note
    const bad = await a.call('/api/files/drive', { method: 'POST', body: { parentType: 'note', parentId: note.id, name: 'x', url: 'https://evil.example/doc' } })
    expect(bad.status).toBe(400)
    const url = 'https://docs.google.com/presentation/d/abc/edit'
    const ok = await a.call<{ file: { id: string; kind: string; driveOwner: string; size: number } }>('/api/files/drive', {
      method: 'POST',
      body: { parentType: 'note', parentId: note.id, name: '期中簡報', mime: 'application/vnd.google-apps.presentation', url, owner: '王老師' },
    })
    expect(ok.status).toBe(201)
    expect([ok.body.file.kind, ok.body.file.driveOwner, ok.body.file.size]).toEqual(['drive', '王老師', 0])
    // Opening it redirects to Drive, where Google applies the file's own sharing.
    const open = await SELF.fetch(`http://localhost/files/${ok.body.file.id}`, { headers: { cookie: a.cookie }, redirect: 'manual' })
    expect([open.status, open.headers.get('location')]).toEqual([302, url])
    expect((await a.call(`/api/files/${ok.body.file.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await a.call<{ items: unknown[] }>(`/api/files?parentType=note&parentId=${note.id}`)).body.items).toHaveLength(0)
    // No picker keys in this environment → the client falls back to pasting links.
    expect((await (await SELF.fetch('http://localhost/api/config')).json<{ drivePicker: unknown }>()).drivePicker).toBeNull()
  })
})
