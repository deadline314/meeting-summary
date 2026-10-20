import { SELF, runDurableObjectAlarm, env } from 'cloudflare:test'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import { login, uniq } from './helpers'

type NoteRes = { note: { id: string; content: string; version: number; canEdit: boolean } }

async function connect(cookie: string, noteId: string) {
  const res = await SELF.fetch(`http://localhost/ws/doc/${noteId}`, { headers: { upgrade: 'websocket', cookie } })
  const ws = res.webSocket!
  ws.accept()
  const doc = new Y.Doc()
  let closed: number | null = null
  ws.addEventListener('close', (e) => (closed = e.code))
  ws.addEventListener('message', async (e) => {
    const raw = e.data instanceof Blob ? await e.data.arrayBuffer() : (e.data as ArrayBuffer)
    const d = decoding.createDecoder(new Uint8Array(raw))
    if (decoding.readVarUint(d) !== 0) return
    const reply = encoding.createEncoder()
    encoding.writeVarUint(reply, 0)
    syncProtocol.readSyncMessage(d, reply, doc, 'remote')
    if (encoding.length(reply) > 1) ws.send(encoding.toUint8Array(reply))
  })
  doc.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, 0)
    syncProtocol.writeUpdate(e, u)
    ws.send(encoding.toUint8Array(e))
  })
  // initial handshake
  const e = encoding.createEncoder()
  encoding.writeVarUint(e, 0)
  syncProtocol.writeSyncStep1(e, doc)
  ws.send(encoding.toUint8Array(e))
  await sleep(150)
  return { ws, doc, text: doc.getText('content'), closed: () => closed }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('meeting notes', () => {
  it('creates a note from the template and carries over action items', async () => {
    const a = await login(uniq('n'))
    const title = `Weekly ${crypto.randomUUID().slice(0, 4)}`
    const first = await a.call<NoteRes>('/api/notes', { method: 'POST', body: { title, startsAt: Date.parse('2026-10-12T06:00:00Z') } })
    expect(first.status).toBe(201)
    expect(first.body.note.content).toContain('## 一、會議目的')
    // Put real action items in the first note, then create next week's.
    const withItems = first.body.note.content.replace('| 1 | [具體要做的事] | [姓名] | 10/25 |', '| 1 | 整理資料集 | 小明 | 10/18 |')
    await env.DB.prepare('update notes set content = ? where id = ?').bind(withItems, first.body.note.id).run()
    const second = await a.call<NoteRes>('/api/notes', { method: 'POST', body: { title, startsAt: Date.parse('2026-10-19T06:00:00Z') } })
    expect(second.body.note.content).toContain('| 整理資料集 | 小明 | 進行中 | 10/18 |')
  })

  it('syncs edits between two people and records who wrote what', async () => {
    const a = await login(uniq('a'))
    const b = await login(uniq('b'))
    const aId = (await a.call<{ user: { id: string } }>('/api/me')).body.user.id
    const bId = (await b.call<{ user: { id: string } }>('/api/me')).body.user.id
    const { note } = (await a.call<NoteRes>('/api/notes', { method: 'POST', body: { title: 'Sync', startsAt: Date.now(), attendeeIds: [aId, bId] } })).body
    const ca = await connect(a.cookie, note.id)
    const cb = await connect(b.cookie, note.id)
    expect(ca.text.toString()).toContain('會議目的')
    ca.text.insert(0, 'AAA ')
    await sleep(100)
    cb.text.insert(0, 'BBB ')
    await sleep(200)
    expect(ca.text.toString().startsWith('BBB AAA ') || ca.text.toString().startsWith('AAA BBB ')).toBe(true)
    expect(cb.text.toString()).toBe(ca.text.toString())
    const authors = (await a.call<{ clients: Record<string, { userId: string }> }>(`/api/notes/${note.id}/authors`)).body.clients
    expect(authors[String(ca.doc.clientID)]?.userId).toBe(aId)
    expect(authors[String(cb.doc.clientID)]?.userId).toBe(bId)
    ca.ws.close()
    cb.ws.close()
  })

  it('rejects an update that forges another account’s client id', async () => {
    const a = await login(uniq('fa'))
    const b = await login(uniq('fb'))
    const aId = (await a.call<{ user: { id: string } }>('/api/me')).body.user.id
    const bId = (await b.call<{ user: { id: string } }>('/api/me')).body.user.id
    const { note } = (await a.call<NoteRes>('/api/notes', { method: 'POST', body: { title: 'Forge', startsAt: Date.now(), attendeeIds: [aId, bId] } })).body
    const ca = await connect(a.cookie, note.id)
    ca.text.insert(0, 'mine ')
    await sleep(150)
    const cb = await connect(b.cookie, note.id)
    // B crafts an update with A's client id.
    const forged = new Y.Doc()
    Y.applyUpdate(forged, Y.encodeStateAsUpdate(ca.doc))
    forged.clientID = ca.doc.clientID // set after applying, or Yjs regenerates it
    const before = Y.encodeStateVector(forged)
    forged.getText('content').insert(0, 'fake ')
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, 0)
    syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(forged, before))
    cb.ws.send(encoding.toUint8Array(e))
    await sleep(200)
    expect(ca.text.toString().startsWith('fake')).toBe(false)
    expect(cb.closed()).toBe(4403)
    ca.ws.close()
  })

  it('read-only viewers cannot edit, and are told so instead of drifting apart', async () => {
    const a = await login(uniq('ra'))
    const v = await login(uniq('rv'))
    const { note } = (await a.call<NoteRes>('/api/notes', { method: 'POST', body: { title: 'RO', startsAt: Date.now() } })).body
    const cv = await connect(v.cookie, note.id)
    cv.text.insert(0, 'nope ')
    await sleep(150)
    const ca = await connect(a.cookie, note.id)
    expect(ca.text.toString().startsWith('nope')).toBe(false)
    expect(cv.closed()).toBe(4003)
    ca.ws.close()
  })

  it('a periodic resync fills in edits the server never received', async () => {
    const a = await login(uniq('ya'))
    const { note } = (await a.call<NoteRes>('/api/notes', { method: 'POST', body: { title: 'Resync', startsAt: Date.now() } })).body
    const c1 = await connect(a.cookie, note.id)
    const c2 = await connect(a.cookie, note.id)
    // An edit that stays local (as if the server lost it): applied with the "remote" origin, so not sent.
    const local = new Y.Doc()
    local.clientID = c1.doc.clientID
    Y.applyUpdate(local, Y.encodeStateAsUpdate(c1.doc))
    local.getText('content').insert(0, 'lost ')
    Y.applyUpdate(c1.doc, Y.encodeStateAsUpdate(local), 'remote')
    await sleep(100)
    expect(c2.text.toString().startsWith('lost ')).toBe(false)
    // What y-websocket does every resyncInterval: send step 1. The server answers and asks back.
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, 0)
    syncProtocol.writeSyncStep1(e, c1.doc)
    c1.ws.send(encoding.toUint8Array(e))
    await sleep(200)
    expect(c2.text.toString().startsWith('lost ')).toBe(true)
    c1.ws.close()
    c2.ws.close()
  })

  it('someone made an attendee while the note is open can edit, and everyone sees it', async () => {
    const a = await login(uniq('pa'))
    const b = await login(uniq('pb'))
    const c = await login(uniq('pc'))
    const id = async (s: typeof a) => (await s.call<{ user: { id: string } }>('/api/me')).body.user.id
    const [bId, cId] = [await id(b), await id(c)]
    const { note } = (await a.call<NoteRes>('/api/notes', { method: 'POST', body: { title: 'Perm', startsAt: Date.now() } })).body
    const ca = await connect(a.cookie, note.id)
    const cb = await connect(b.cookie, note.id)
    // Adding b through the app: every open connection is asked to reconnect with fresh rights.
    const v = (await a.call<NoteRes>(`/api/notes/${note.id}`)).body.note.version
    expect((await a.call(`/api/notes/${note.id}`, { method: 'PATCH', body: { version: v, attendeeIds: [bId] } })).status).toBe(200)
    await sleep(150)
    expect(cb.closed()).toBe(4000)
    expect(ca.closed()).toBeNull() // editors stay connected
    const cb2 = await connect(b.cookie, note.id)
    cb2.text.insert(0, 'from b ')
    await sleep(150)
    expect(ca.text.toString().startsWith('from b ')).toBe(true)
    // A connection opened before c was added (no push): the first edit re-checks instead of being dropped.
    const cc = await connect(c.cookie, note.id)
    await env.DB.prepare('update notes set attendee_ids = ? where id = ?').bind(JSON.stringify([bId, cId]), note.id).run()
    cc.text.insert(0, 'from c ')
    await sleep(200)
    expect(cc.closed()).toBeNull()
    expect(ca.text.toString().startsWith('from c ')).toBe(true)
    expect(cb2.text.toString()).toBe(ca.text.toString())
    for (const x of [ca, cb2, cc]) x.ws.close()
  })

  it('turns edit sessions into versions and restores', async () => {
    const a = await login(uniq('h'))
    const { note } = (await a.call<NoteRes>('/api/notes', { method: 'POST', body: { title: 'Hist', startsAt: Date.now() } })).body
    const ca = await connect(a.cookie, note.id)
    ca.text.insert(0, 'v1 ')
    await sleep(100)
    ca.ws.close()
    await sleep(100)
    const stub = env.DOC_ROOM.get(env.DOC_ROOM.idFromName(note.id))
    await runDurableObjectAlarm(stub)
    const list = await a.call<{ items: { id: string; inserted: number }[] }>(`/api/notes/${note.id}/versions`)
    expect(list.body.items[0]?.inserted).toBe(3)
    const first = list.body.items[0]!.id
    const cb = await connect(a.cookie, note.id)
    cb.text.insert(0, 'v2 ')
    await sleep(100)
    expect((await a.call(`/api/notes/${note.id}/versions/${first}/restore`, { method: 'POST' })).status).toBe(200)
    await sleep(100)
    expect(cb.text.toString().startsWith('v1 ')).toBe(true)
    cb.ws.close()
  })

  it('comments: thread, reply, resolve; outsiders get 404', async () => {
    const a = await login(uniq('c'))
    const { note } = (await a.call<NoteRes>('/api/notes', { method: 'POST', body: { title: 'C', startsAt: Date.now() } })).body
    const t = await a.call<{ comment: { id: string } }>(`/api/notes/${note.id}/comments`, {
      method: 'POST',
      body: { body: '日期不一致', anchor: { start: 'x', end: 'y' }, quote: '11/15' },
    })
    expect(t.status).toBe(201)
    const b = await login(uniq('c2'))
    expect((await b.call(`/api/notes/${note.id}/comments`, { method: 'POST', body: { body: 'ok', parentId: t.body.comment.id } })).status).toBe(201)
    const r = await b.call<{ comment: { resolvedAt: number } }>(`/api/notes/${note.id}/comments/${t.body.comment.id}`, { method: 'PATCH', body: { resolved: true } })
    expect(r.body.comment.resolvedAt).toBeTruthy()
    expect((await a.call('/api/notes/does-not-exist/comments')).status).toBe(404)
  })
  it('a thread whose first comment was deleted can still be replied to and resolved until nothing is left', async () => {
    const a = await login(uniq('dt'))
    const b = await login(uniq('dt2'))
    const { note } = (await a.call<NoteRes>('/api/notes', { method: 'POST', body: { title: 'D', startsAt: Date.now() } })).body
    const base = `/api/notes/${note.id}/comments`
    const root = (await a.call<{ comment: { id: string } }>(base, { method: 'POST', body: { body: '原本的問題', anchor: { start: 'x', end: 'y' }, quote: '背景' } })).body.comment.id
    const reply = (await b.call<{ comment: { id: string } }>(base, { method: 'POST', body: { body: '我的回覆', parentId: root } })).body.comment.id
    const gone = (await b.call<{ comment: { id: string } }>(base, { method: 'POST', body: { body: '刪掉的回覆', parentId: root } })).body.comment.id
    expect((await b.call(`${base}/${gone}`, { method: 'DELETE' })).status).toBe(200)
    expect((await a.call(`${base}/${root}`, { method: 'DELETE' })).status).toBe(200)

    type Row = { id: string; body: string; deletedAt: number | null }
    const list = async () => (await a.call<{ items: Row[] }>(base)).body.items
    const open = async () => (await a.call<{ note: { openComments: number } }>(`/api/notes/${note.id}`)).body.note.openComments
    // The placeholder stays (without its text) while a reply is left; the deleted reply is gone.
    expect((await list()).map((r) => [r.id, r.body])).toEqual([[root, ''], [reply, '我的回覆']])
    expect(await open()).toBe(1)
    const resolved = await b.call<{ comment: { resolvedAt: number; body: string } }>(`${base}/${root}`, { method: 'PATCH', body: { resolved: true } })
    expect(resolved.status).toBe(200)
    expect(resolved.body.comment.resolvedAt).toBeTruthy()
    expect(resolved.body.comment.body).toBe('')
    expect(await open()).toBe(0)
    expect((await b.call(`${base}/${root}`, { method: 'PATCH', body: { resolved: false } })).status).toBe(200)
    expect((await a.call(base, { method: 'POST', body: { body: '再補充', parentId: root } })).status).toBe(201)

    // Once every reply is deleted too, the thread disappears everywhere.
    for (const r of (await list()).filter((r) => r.id !== root)) {
      const who = r.body === '再補充' ? a : b
      expect((await who.call(`${base}/${r.id}`, { method: 'DELETE' })).status).toBe(200)
    }
    expect(await list()).toEqual([])
    expect(await open()).toBe(0)
    expect((await b.call(`${base}/${root}`, { method: 'PATCH', body: { resolved: true } })).status).toBe(404)
    expect((await b.call(base, { method: 'POST', body: { body: 'late', parentId: root } })).status).toBe(404)
  })
  it('note comments notify the creator, the recorder and anyone @-mentioned (not the author)', async () => {
    const a = await login(uniq('nc'))
    const rec = await login(uniq('nr'))
    const m = await login(uniq('nm'))
    const c = await login(uniq('nx'))
    const id = async (x: typeof a) => (await x.call<{ user: { id: string } }>('/api/me')).body.user.id
    const [recId, mId] = [await id(rec), await id(m)]
    const { note } = (await a.call<NoteRes>('/api/notes', { method: 'POST', body: { title: 'N', startsAt: Date.now(), recorderId: recId } })).body
    await c.call(`/api/notes/${note.id}/comments`, { method: 'POST', body: { body: `請 @[user:${mId}] 看一下`, anchor: { start: 'x', end: 'y' }, quote: 'q' } })
    await new Promise((r) => setTimeout(r, 50))
    const types = async (x: typeof a) => (await x.call<{ items: { type: string; entityId: string }[] }>('/api/notifications')).body.items.filter((n) => n.entityId === note.id).map((n) => n.type)
    expect((await types(a)).length).toBe(1)
    expect((await types(rec)).length).toBe(1)
    expect(await types(m)).toContain('mention')
    expect(await types(c)).toEqual([])
  })

  it('lists notes page by page with an exact total', async () => {
    const a = await login(uniq('pg'))
    const tag = `pg-${crypto.randomUUID().slice(0, 6)}`
    for (let i = 0; i < 45; i++) await a.call('/api/notes', { method: 'POST', body: { title: `${tag} ${i}`, startsAt: Date.now() - i * 60_000 } })
    const p0 = (await a.call<{ items: { title: string }[]; total: number }>(`/api/notes?q=${tag}&limit=20&offset=0`)).body
    const p2 = (await a.call<{ items: { title: string }[]; total: number }>(`/api/notes?q=${tag}&limit=20&offset=40`)).body
    expect([p0.total, p0.items.length, p2.items.length]).toEqual([45, 20, 5])
    expect(p0.items[0]!.title).toBe(`${tag} 0`)
  })
  it('live edits reach the list and search at the next content sync', async () => {
    const a = await login(uniq('sy'))
    const { note } = (await a.call<NoteRes>('/api/notes', { method: 'POST', body: { title: 'Search me', startsAt: Date.now() } })).body
    const ca = await connect(a.cookie, note.id)
    const word = `zx${crypto.randomUUID().slice(0, 6)}`
    ca.text.insert(0, `${word} `)
    await sleep(150)
    // The room writes content to the database on a 20 s alarm (well inside the 30 s promise); fire it now.
    await runDurableObjectAlarm(env.DOC_ROOM.get(env.DOC_ROOM.idFromName(note.id)))
    const hits = (await a.call<{ items: { id: string }[] }>(`/api/notes?q=${word}&limit=5&offset=0`)).body.items
    expect(hits.map((h) => h.id)).toEqual([note.id])
    ca.ws.close()
  })
  it('ten editors on a 20,000-character note: every keystroke reaches everyone quickly', async () => {
    const people = await Promise.all(Array.from({ length: 10 }, (_, i) => login(uniq(`ten${i}`))))
    const ids = await Promise.all(people.map(async (p) => (await p.call<{ user: { id: string } }>('/api/me')).body.user.id))
    const { note } = (await people[0]!.call<NoteRes>('/api/notes', { method: 'POST', body: { title: 'Big', startsAt: Date.now(), attendeeIds: ids } })).body
    const clients: Awaited<ReturnType<typeof connect>>[] = []
    for (const p of people) clients.push(await connect(p.cookie, note.id))
    clients[0]!.text.insert(0, 'x'.repeat(20_000))
    await sleep(400)
    expect(clients.every((c) => c.text.length >= 20_000)).toBe(true)
    // Each person types one character; time until all ten copies agree.
    const lags: number[] = []
    for (let i = 0; i < clients.length; i++) {
      const before = Date.now()
      clients[i]!.text.insert(0, String(i))
      const target: number = clients[i]!.text.length
      while (!clients.every((c) => c.text.length === target) && Date.now() - before < 2000) await sleep(5)
      lags.push(Date.now() - before)
    }
    expect(clients.every((c) => c.text.toString() === clients[0]!.text.toString())).toBe(true)
    // Generous for a shared CI box; locally this is ~10–40 ms.
    expect(Math.max(...lags)).toBeLessThan(500)
    clients.forEach((c) => c.ws.close())
  })
})
