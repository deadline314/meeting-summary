import { DurableObject } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { getDb } from '../db'
import { activities, noteVersions, notes } from '../db/schema'
import { newId } from '../lib/crypto'
import { errorFields, log } from '../lib/log'

const MSG_SYNC = 0
const MSG_AWARENESS = 1
const SESSION_IDLE_MS = 5 * 60_000
const CONTENT_SYNC_MS = 20_000
const COMPACT_AFTER = 300
/** Keystroke updates are merged and persisted at most this often (keeps DO row writes low). */
const PERSIST_MS = 2000
/** Reserved Yjs client id for text that existed before collaboration started (the template). */
export const SYSTEM_CLIENT = 1

type Attachment = { userId: string; canEdit: boolean; clientIds: number[]; awarenessIds: number[] }
type EditSession = { userId: string; startedAt: number; lastAt: number; inserted: number; deleted: number }

/**
 * One instance per meeting note. Holds the Yjs document, speaks the y-websocket
 * protocol over hibernatable WebSockets, binds every Yjs client id to the signed-in
 * account (so authorship cannot be forged), and folds edits into per-user sessions
 * that become history versions in D1.
 */
export class DocRoom extends DurableObject<Env> {
  private doc!: Y.Doc
  private text!: Y.Text
  private awareness!: awarenessProtocol.Awareness
  private noteId = ''
  private clients = new Map<number, string>()
  private clientLastAt = new Map<number, number>()
  private pending: Uint8Array[] = []
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private sessions = new Map<string, EditSession>()
  private contentDirty = false
  private updatesSinceCompact = 0

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(() => this.load())
  }

  private sql<T extends Record<string, SqlStorageValue>>(q: string, ...args: SqlStorageValue[]) {
    return this.ctx.storage.sql.exec<T>(q, ...args)
  }

  private async load() {
    this.sql(`create table if not exists updates (id integer primary key autoincrement, data blob not null)`)
    this.sql(`create table if not exists clients (client_id integer primary key, user_id text not null, last_at integer not null default 0)`)
    this.sql(`create table if not exists meta (key text primary key, value text not null)`)
    this.sql(`create table if not exists edit_sessions (user_id text primary key, data text not null)`)
    this.noteId = this.sql<{ value: string }>(`select value from meta where key = 'noteId'`).toArray()[0]?.value ?? ''
    for (const r of this.sql<{ client_id: number; user_id: string; last_at: number }>(`select client_id, user_id, last_at from clients`)) {
      this.clients.set(r.client_id, r.user_id)
      this.clientLastAt.set(r.client_id, r.last_at)
    }
    for (const r of this.sql<{ user_id: string; data: string }>(`select user_id, data from edit_sessions`)) this.sessions.set(r.user_id, JSON.parse(r.data))

    this.doc = new Y.Doc({ gc: false })
    this.text = this.doc.getText('content')
    const rows = this.sql<{ data: ArrayBuffer }>(`select data from updates order by id`).toArray()
    Y.transact(this.doc, () => rows.forEach((r) => Y.applyUpdate(this.doc, new Uint8Array(r.data))), 'load')
    this.updatesSinceCompact = rows.length
    this.awareness = new awarenessProtocol.Awareness(this.doc)
    this.awareness.setLocalState(null)

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'load') return
      this.pending.push(update)
      this.persistTimer ??= setTimeout(() => this.persist(), PERSIST_MS)
      this.broadcast(syncMessage((e) => syncProtocol.writeUpdate(e, update)), origin)
      this.contentDirty = true
      this.schedule()
    })
    this.text.observe((event) => {
      const origin = event.transaction.origin
      const userId = origin instanceof WebSocket ? this.attachment(origin).userId : typeof origin === 'string' && origin.startsWith('user:') ? origin.slice(5) : null
      if (!userId) return
      let ins = 0
      let del = 0
      for (const d of event.changes.delta) {
        if (typeof d.insert === 'string') ins += d.insert.length
        if (d.delete) del += d.delete
      }
      this.track(userId, ins, del)
    })
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = [...added, ...updated, ...removed]
      if (origin instanceof WebSocket) {
        const a = this.attachment(origin)
        const ids = new Set(a.awarenessIds)
        added.forEach((id) => ids.add(id))
        removed.forEach((id) => ids.delete(id))
        origin.serializeAttachment({ ...a, awarenessIds: [...ids] })
      }
      const msg = encoding.createEncoder()
      encoding.writeVarUint(msg, MSG_AWARENESS)
      encoding.writeVarUint8Array(msg, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed))
      this.broadcast(encoding.toUint8Array(msg), null)
    })
  }

  /** Writes buffered updates as one merged row. A crash loses at most PERSIST_MS server-side; clients resend on reconnect. */
  private persist() {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = null
    if (!this.pending.length) return
    const merged = Y.mergeUpdates(this.pending)
    this.pending = []
    this.ctx.storage.transactionSync(() => {
      this.sql(`insert into updates (data) values (?)`, toBuffer(merged))
      for (const [c, at] of this.clientLastAt) this.sql(`update clients set last_at = ? where client_id = ? and last_at < ?`, at, c, at)
    })
    if (++this.updatesSinceCompact > COMPACT_AFTER) this.compact()
  }

  private compact() {
    const state = Y.encodeStateAsUpdate(this.doc)
    this.ctx.storage.transactionSync(() => {
      this.sql(`delete from updates`)
      this.sql(`insert into updates (data) values (?)`, toBuffer(state))
    })
    this.updatesSinceCompact = 1
  }

  private attachment(ws: WebSocket) {
    return ws.deserializeAttachment() as Attachment
  }

  private broadcast(msg: Uint8Array, except: unknown) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue
      try {
        ws.send(msg)
      } catch {
        /* socket closing */
      }
    }
  }

  // ---------- HTTP / WebSocket entry ----------

  async fetch(req: Request) {
    const url = new URL(req.url)
    const noteId = req.headers.get('x-note-id') ?? ''
    if (noteId && !this.noteId) await this.init(noteId)
    if (url.pathname.endsWith('/clients'))
      return Response.json(Object.fromEntries([...this.clients].map(([c, u]) => [c, { userId: u, lastAt: this.clientLastAt.get(c) ?? 0 }])))
    if (url.pathname.endsWith('/restore') && req.method === 'POST') {
      const { content, userId } = (await req.json()) as { content: string; userId: string }
      this.restore(content, userId)
      await this.flush(true)
      return Response.json({ ok: true })
    }
    if (url.pathname.endsWith('/text')) return new Response(this.text.toString())
    if (req.headers.get('upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })

    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({
      userId: req.headers.get('x-user-id')!,
      canEdit: req.headers.get('x-can-edit') === '1',
      clientIds: [],
      awarenessIds: [],
    } satisfies Attachment)
    // Ask the client for anything we lack, and send our awareness snapshot.
    server.send(syncMessage((e) => syncProtocol.writeSyncStep1(e, this.doc)))
    const states = [...this.awareness.getStates().keys()]
    if (states.length) {
      const e = encoding.createEncoder()
      encoding.writeVarUint(e, MSG_AWARENESS)
      encoding.writeVarUint8Array(e, awarenessProtocol.encodeAwarenessUpdate(this.awareness, states))
      server.send(encoding.toUint8Array(e))
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  /** First touch: remember which note this is and seed the document from D1 (the template). */
  private async init(noteId: string) {
    this.noteId = noteId
    this.sql(`insert or replace into meta (key, value) values ('noteId', ?)`, noteId)
    if (this.text.length > 0) return
    const row = await getDb(this.env.DB).select({ content: notes.content }).from(notes).where(eq(notes.id, noteId)).get()
    if (!row?.content) return
    const seed = new Y.Doc()
    seed.clientID = SYSTEM_CLIENT
    seed.getText('content').insert(0, row.content)
    Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(seed), 'seed')
  }

  async webSocketMessage(ws: WebSocket, data: ArrayBuffer | string) {
    if (typeof data === 'string') return
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data))
      const type = decoding.readVarUint(decoder)
      if (type === MSG_SYNC) this.onSync(ws, decoder)
      else if (type === MSG_AWARENESS) awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), ws)
    } catch (err) {
      log('warn', 'doc message rejected', { noteId: this.noteId, ...errorFields(err) })
    }
  }

  private onSync(ws: WebSocket, decoder: decoding.Decoder) {
    const kind = decoding.readVarUint(decoder)
    if (kind === syncProtocol.messageYjsSyncStep1) {
      const sv = decoding.readVarUint8Array(decoder)
      ws.send(syncMessage((e) => syncProtocol.writeSyncStep2(e, this.doc, sv)))
      return
    }
    const update = decoding.readVarUint8Array(decoder)
    const a = this.attachment(ws)
    if (!a.canEdit) return
    if (!this.authorize(ws, a, update)) {
      log('warn', 'forged yjs client id rejected', { noteId: this.noteId, userId: a.userId })
      ws.close(4403, 'forbidden')
      return
    }
    const now = Date.now()
    for (const c of this.attachment(ws).clientIds) this.clientLastAt.set(c, now)
    Y.applyUpdate(this.doc, update, ws)
  }

  /** Every new Yjs client id in an update must belong to the connection's account. */
  private authorize(ws: WebSocket, a: Attachment, update: Uint8Array) {
    const { structs } = Y.decodeUpdate(update)
    const fresh: number[] = []
    for (const s of structs) {
      const client = s.id.client
      const owner = this.clients.get(client)
      if (owner === a.userId) continue
      if (owner || client === SYSTEM_CLIENT) {
        // Re-sent history from another author is fine only if we already have it.
        if (Y.getState(this.doc.store, client) >= s.id.clock + s.length) continue
        return false
      }
      if (!fresh.includes(client)) fresh.push(client)
    }
    for (const c of fresh) {
      this.clients.set(c, a.userId)
      this.sql(`insert or ignore into clients (client_id, user_id) values (?, ?)`, c, a.userId)
    }
    if (fresh.length) ws.serializeAttachment({ ...a, clientIds: [...a.clientIds, ...fresh] })
    return true
  }

  async webSocketClose(ws: WebSocket) {
    const a = this.attachment(ws)
    if (a.awarenessIds.length) awarenessProtocol.removeAwarenessStates(this.awareness, a.awarenessIds, null)
    // Leaving the document ends that person's edit session (unless they have another tab open).
    const stillHere = this.ctx.getWebSockets().some((o) => o !== ws && this.attachment(o).userId === a.userId)
    await this.flush(stillHere ? new Set() : new Set([a.userId]))
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws)
  }

  // ---------- history ----------

  private track(userId: string, inserted: number, deleted: number) {
    const now = Date.now()
    const s = this.sessions.get(userId) ?? { userId, startedAt: now, lastAt: now, inserted: 0, deleted: 0 }
    s.lastAt = now
    s.inserted += inserted
    s.deleted += deleted
    this.sessions.set(userId, s)
    this.sql(`insert or replace into edit_sessions (user_id, data) values (?, ?)`, userId, JSON.stringify(s))
  }

  private restore(content: string, userId: string) {
    // Edits made by the server on someone's behalf get a fresh client id bound to them.
    const clientId = Math.floor(Math.random() * 2 ** 31) + 2
    this.clients.set(clientId, userId)
    this.clientLastAt.set(clientId, Date.now())
    this.sql(`insert or ignore into clients (client_id, user_id, last_at) values (?, ?, ?)`, clientId, userId, Date.now())
    const prev = this.doc.clientID
    this.doc.clientID = clientId
    this.doc.transact(() => {
      this.text.delete(0, this.text.length)
      this.text.insert(0, content)
    }, `user:${userId}`)
    this.doc.clientID = prev
  }

  private schedule() {
    const now = Date.now()
    let next = this.contentDirty ? now + CONTENT_SYNC_MS : Infinity
    for (const s of this.sessions.values()) next = Math.min(next, s.lastAt + SESSION_IDLE_MS)
    if (next !== Infinity) this.ctx.storage.setAlarm(next)
  }

  async alarm() {
    await this.flush(new Set())
  }

  /**
   * Writes the current text to D1 and turns idle edit sessions into versions.
   * `close` ends sessions regardless of idleness: `true` for all, or a set of user ids.
   */
  private async flush(close: boolean | Set<string>) {
    this.persist()
    if (!this.noteId) return
    const db = getDb(this.env.DB)
    const now = Date.now()
    const content = this.text.toString()
    const ops = []
    if (this.contentDirty) {
      ops.push(db.update(notes).set({ content, updatedAt: now }).where(eq(notes.id, this.noteId)))
      this.contentDirty = false
    }
    for (const s of [...this.sessions.values()]) {
      const idle = now - s.lastAt >= SESSION_IDLE_MS
      const forced = close === true || (close instanceof Set && close.has(s.userId))
      if (!forced && !idle) continue
      this.sessions.delete(s.userId)
      this.sql(`delete from edit_sessions where user_id = ?`, s.userId)
      if (s.inserted === 0 && s.deleted === 0) continue
      const versionId = newId()
      ops.push(
        db.insert(noteVersions).values({
          id: versionId,
          noteId: this.noteId,
          authorId: s.userId,
          startedAt: s.startedAt,
          endedAt: s.lastAt,
          inserted: s.inserted,
          deleted: s.deleted,
          content,
        }),
        db.insert(activities).values({
          id: newId(),
          actorId: s.userId,
          entityType: 'note',
          entityId: this.noteId,
          action: 'edited',
          data: { inserted: s.inserted, deleted: s.deleted, versionId },
          source: 'web',
          createdAt: s.lastAt,
        }),
      )
    }
    if (ops.length) {
      try {
        await db.batch(ops as [(typeof ops)[number], ...typeof ops])
      } catch (err) {
        log('error', 'doc flush failed', { noteId: this.noteId, ...errorFields(err) })
        this.contentDirty = true
      }
    }
    this.schedule()
  }
}

function syncMessage(write: (e: encoding.Encoder) => void) {
  const e = encoding.createEncoder()
  encoding.writeVarUint(e, MSG_SYNC)
  write(e)
  return encoding.toUint8Array(e)
}

const toBuffer = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
