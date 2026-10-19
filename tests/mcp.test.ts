import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { login, uniq } from './helpers'

const BASE = 'http://localhost'

async function rpc(auth: { header?: string; path?: string }, method: string, params?: unknown, id = 1) {
  const r = await SELF.fetch(`${BASE}${auth.path ?? '/mcp'}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth.header && { authorization: `Bearer ${auth.header}` }) },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  return { status: r.status, body: (await r.json().catch(() => null)) as { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] }; error?: { message: string } } }
}

const text = (r: Awaited<ReturnType<typeof rpc>>) => JSON.parse(r.body.result!.content![0]!.text)

describe('API keys & MCP', () => {
  it('initialize, list tools, create and comment on issues with a write key', async () => {
    const a = await login(uniq('m'))
    const key = 'MC' + crypto.randomUUID().replace(/[^a-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'Q')
    await a.call('/api/projects', { method: 'POST', body: { key, name: 'MCP' } })
    const k = (await a.call<{ secret: string }>('/api/me/api-keys', { method: 'POST', body: { name: 'claude', scope: 'write' } })).body.secret
    expect(k.startsWith('msk_')).toBe(true)
    const init = await rpc({ header: k }, 'initialize', { protocolVersion: '2025-06-18' })
    expect(init.status).toBe(200)
    const tools = await rpc({ header: k }, 'tools/list')
    expect(tools.body.result!.tools!.map((t) => t.name)).toContain('issue_create')
    const created = text(await rpc({ header: k }, 'tools/call', { name: 'issue_create', arguments: { key, title: 'from mcp' } }))
    expect(created.ref).toBe(`${key}-1`)
    const commented = await rpc({ header: k }, 'tools/call', { name: 'issue_comment', arguments: { ref: created.ref, body: 'hello' } })
    expect(commented.body.result!.isError).toBeUndefined()
    // Activity is tagged with the mcp source.
    const tl = await a.call<{ items: { kind: string; change?: { source: string } }[] }>(`/api/issues/${created.ref}/timeline?kind=changes`)
    expect(tl.body.items[0]!.change!.source).toBe('mcp')
    // URL-embedded key works too.
    const viaUrl = await rpc({ path: `/mcp/k/${k}` }, 'tools/call', { name: 'projects_list', arguments: {} })
    expect(text(viaUrl).map((p: { key: string }) => p.key)).toContain(key)
  })

  it('scopes, project limits and revocation are enforced on every call', async () => {
    const a = await login(uniq('m2'))
    const k1 = 'MA' + crypto.randomUUID().replace(/[^a-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'R')
    const k2 = 'MB' + crypto.randomUUID().replace(/[^a-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'S')
    const p1 = (await a.call<{ project: { id: string } }>('/api/projects', { method: 'POST', body: { key: k1, name: 'one' } })).body.project
    await a.call('/api/projects', { method: 'POST', body: { key: k2, name: 'two' } })
    const read = (await a.call<{ secret: string; key: { id: string } }>('/api/me/api-keys', { method: 'POST', body: { name: 'ro', scope: 'read' } })).body
    const denied = await rpc({ header: read.secret }, 'tools/call', { name: 'issue_create', arguments: { key: k1, title: 'x' } })
    expect(denied.body.result!.isError).toBe(true)
    expect(denied.body.result!.content![0]!.text).toContain('scope')
    // REST honours scopes too.
    const rest = await SELF.fetch(`${BASE}/api/projects/${k1}/issues`, { method: 'POST', headers: { authorization: `Bearer ${read.secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x' }) })
    expect(rest.status).toBe(403)
    const limited = (await a.call<{ secret: string }>('/api/me/api-keys', { method: 'POST', body: { name: 'one only', scope: 'write', projectIds: [p1.id] } })).body.secret
    const other = await rpc({ header: limited }, 'tools/call', { name: 'project_get', arguments: { key: k2 } })
    expect(other.body.result!.content![0]!.text).toContain('not_found')
    await a.call(`/api/me/api-keys/${read.key.id}`, { method: 'DELETE' })
    expect((await rpc({ header: read.secret }, 'tools/list')).status).toBe(401)
    expect((await rpc({}, 'tools/list')).status).toBe(401)
  })
})
