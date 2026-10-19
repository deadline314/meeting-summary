import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { login, uniq, projectKey } from './helpers'

describe('admin: settings, usage, activity export, member page', () => {
  it('settings are validated, logged and enforced; students are kept out', async () => {
    const owner = await login('teacher@example.com')
    const s = await login(uniq('adm'))
    expect((await s.call('/api/admin/settings')).status).toBe(404)
    expect((await s.call('/api/admin/usage')).status).toBe(404)
    expect((await owner.call('/api/admin/settings/file_limits', { method: 'PUT', body: { value: { maxFileBytes: 1, quotaBytes: 1 } } })).status).toBe(400)
    expect((await owner.call('/api/admin/settings/nope', { method: 'PUT', body: { value: 1 } })).status).toBe(404)
    const MB = 1024 * 1024
    expect((await owner.call('/api/admin/settings/file_limits', { method: 'PUT', body: { value: { maxFileBytes: 2 * MB, quotaBytes: 100 * MB } } })).status).toBe(200)
    const note = (await s.call<{ note: { id: string } }>('/api/notes', { method: 'POST', body: { title: 'x', startsAt: Date.now() } })).body.note
    const big = await SELF.fetch(`http://localhost/api/files?parentType=note&parentId=${note.id}`, {
      method: 'PUT',
      headers: { cookie: s.cookie, 'x-file-name': 'big.bin', 'content-type': 'application/octet-stream', 'content-length': String(3 * MB) },
      body: new Uint8Array(3 * MB),
    })
    expect(big.status).toBe(413)
    await owner.call('/api/admin/settings/file_limits', { method: 'PUT', body: { value: { maxFileBytes: 50 * MB, quotaBytes: 1024 * MB } } })
    // Grading defaults feed new tasks.
    await owner.call('/api/admin/settings/grading_defaults', { method: 'PUT', body: { value: { timeoutSec: 120, memoryMb: 1024, dailyLimit: 3, maxBytes: 5 * MB } } })
    const task = (await owner.call<{ task: { timeoutSec: number; dailyLimit: number } }>('/api/tasks', { method: 'POST', body: { title: 'defaults' } })).body.task
    expect([task.timeoutSec, task.dailyLimit]).toEqual([120, 3])
    await owner.call('/api/admin/settings/grading_defaults', { method: 'PUT', body: { value: { timeoutSec: 300, memoryMb: 2048, dailyLimit: 10, maxBytes: 10 * MB } } })
    // Site name shows up in the public config.
    await owner.call('/api/admin/settings/site', { method: 'PUT', body: { value: { name: '影像實驗室', icon: 'atom' } } })
    const cfg = await (await SELF.fetch('http://localhost/api/config')).json<{ siteName: string; siteIcon: string }>()
    expect([cfg.siteName, cfg.siteIcon]).toEqual(['影像實驗室', 'atom'])
    await owner.call('/api/admin/settings/site', { method: 'PUT', body: { value: { name: '', icon: 'doc' } } })
    const acts = (await owner.call<{ items: { action: string }[] }>('/api/admin/activity?type=site')).body.items
    expect(acts.filter((a) => a.action === 'settings_changed').length).toBeGreaterThanOrEqual(4)
    const u = (await owner.call<{ storage: { pct: number }; database: { used: number }; warn: string[] }>('/api/admin/usage')).body
    expect(u.database.used).toBeGreaterThan(0)
    expect(u.warn).toEqual([])
  })

  it('CSV follows the filters; member page has notes, issues and a heatmap', async () => {
    const owner = await login('teacher@example.com')
    const s = await login(uniq('adm2'))
    const sid = (await s.call<{ user: { id: string } }>('/api/me')).body.user.id
    await s.call('/api/notes', { method: 'POST', body: { title: '週會, "第一次"', startsAt: Date.now() } })
    const key = projectKey('AV')
    await s.call('/api/projects', { method: 'POST', body: { key, name: 'p' } })
    const ownerId = (await owner.call<{ user: { id: string } }>('/api/me')).body.user.id
    await s.call(`/api/projects/${key}/members`, { method: 'POST', body: { userId: ownerId, role: 'member' } })
    await s.call(`/api/projects/${key}/issues`, { method: 'POST', body: { title: 'mine', assigneeIds: [sid] } })
    const r = await SELF.fetch(`http://localhost/api/admin/activity.csv?actor=${sid}&type=note`, { headers: { cookie: owner.cookie } })
    expect(r.headers.get('content-type')).toContain('text/csv')
    const lines = (await r.text()).trim().split('\n')
    expect(lines[0]).toContain('time,actor,email,module,action,target,source,details')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('"週會, ""第一次"""')
    const future = Date.now() + 86400_000
    expect((await owner.call<{ items: unknown[] }>(`/api/admin/activity?actor=${sid}&from=${future}`)).body.items).toHaveLength(0)
    const o = (await owner.call<{ notes: unknown[]; issues: { ref: string }[]; heatmap: { n: number }[] }>(`/api/admin/members/${sid}/overview?tz=480`)).body
    expect(o.notes).toHaveLength(1)
    expect(o.issues[0]!.ref).toBe(`${key}-1`)
    expect(o.heatmap.reduce((a, h) => a + h.n, 0)).toBeGreaterThanOrEqual(3)
  })
  it('a custom note template is used for new notes, with carried-over action items', async () => {
    const owner = await login('teacher@example.com')
    await owner.call('/api/admin/settings/note_template_zh', { method: 'PUT', body: { value: ['## 自訂開頭', '{{carryover}}', '## 五、待辦事項', '| # | 待辦事項 | 負責人 | 期限 |', '|---|---|---|---|', '| 1 | 交報告 | 小明 | 10/30 |'].join('\n') } })
    const title = `tpl-${crypto.randomUUID().slice(0, 6)}`
    const a = (await owner.call<{ note: { content: string } }>('/api/notes', { method: 'POST', body: { title, startsAt: Date.now() - 86400_000 } })).body.note
    expect(a.content.startsWith('## 自訂開頭')).toBe(true)
    const b = (await owner.call<{ note: { content: string } }>('/api/notes', { method: 'POST', body: { title, startsAt: Date.now() } })).body.note
    expect(b.content).toContain('| 交報告 | 小明 |')
    await owner.call('/api/admin/settings/note_template_zh', { method: 'PUT', body: { value: '' } })
  })
})
