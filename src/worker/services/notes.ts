import { and, desc, eq, gte, inArray, isNull, like, lt, lte, or, sql } from 'drizzle-orm'
import type { Ctx } from '../context'
import { isAdmin, requireScope } from '../context'
import { noteComments, noteVersions, notes, settings, type Absentee } from '../db/schema'
import { newId } from '../lib/crypto'
import { conflict, notFound } from '../lib/errors'
import { errorFields, log } from '../lib/log'
import { activity } from './activity'
import { defaultBody, parseActionItems, type Locale } from './note-template'
import { visibleProjectIds } from './projects'

export type Note = typeof notes.$inferSelect

/** Notes whose text contains `token` (e.g. `#[task:id]`), newest first, only those the caller can see. */
export async function notesMentioning(ctx: Ctx, token: string) {
  const visible = new Set(await visibleProjectIds(ctx))
  const rows = await ctx.db
    .select({ id: notes.id, title: notes.title, startsAt: notes.startsAt, visibility: notes.visibility, projectId: notes.projectId })
    .from(notes)
    .where(and(isNull(notes.deletedAt), like(notes.content, `%${token}%`)))
    .orderBy(desc(notes.startsAt))
    .limit(20)
    .all()
  return rows.filter((n) => n.visibility === 'site' || !n.projectId || visible.has(n.projectId) || isAdmin(ctx.user)).map(({ id, title, startsAt }) => ({ id, title, startsAt }))
}

export type NoteInput = {
  title: string
  startsAt: number
  endsAt?: number | null
  location?: string
  recorderId?: string
  attendeeIds?: string[]
  absentees?: Absentee[]
  projectId?: string | null
  visibility?: 'site' | 'project'
}

export function canEditNote(ctx: Pick<Ctx, 'user'>, n: Note) {
  const u = ctx.user
  return isAdmin(u) || n.createdBy === u.id || n.recorderId === u.id || n.attendeeIds.includes(u.id)
}

async function canReadNote(ctx: Ctx, n: Note) {
  if (n.deletedAt) return false
  if (n.visibility === 'site' || !n.projectId) return true
  return (await visibleProjectIds(ctx)).includes(n.projectId)
}

/** Loads a note the caller may read, or throws 404 (never reveals that it exists). */
export async function getNote(ctx: Ctx, id: string) {
  const n = await ctx.db.select().from(notes).where(eq(notes.id, id)).get()
  if (!n || !(await canReadNote(ctx, n))) throw notFound()
  return n
}

export async function noteDto(ctx: Ctx, n: Note) {
  const open = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(noteComments)
    .where(and(eq(noteComments.noteId, n.id), isNull(noteComments.parentId), isNull(noteComments.resolvedAt), isNull(noteComments.deletedAt)))
    .get()
  return { ...n, canEdit: canEditNote(ctx, n), openComments: open?.n ?? 0 }
}

export async function createNote(ctx: Ctx, input: NoteInput, locale: Locale) {
  requireScope(ctx, 'write')
  if (input.projectId && !(await visibleProjectIds(ctx)).includes(input.projectId)) throw notFound()
  const prev = await ctx.db
    .select({ content: notes.content })
    .from(notes)
    .where(
      and(
        isNull(notes.deletedAt),
        lt(notes.startsAt, input.startsAt),
        input.projectId ? eq(notes.projectId, input.projectId) : eq(notes.title, input.title),
      ),
    )
    .orderBy(desc(notes.startsAt))
    .get()
  const tpl = await ctx.db.select().from(settings).where(eq(settings.key, `note_template_${locale}`)).get()
  const now = Date.now()
  const note: Note = {
    id: newId(),
    title: input.title,
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? null,
    location: input.location ?? '',
    recorderId: input.recorderId ?? ctx.user.id,
    attendeeIds: input.attendeeIds ?? [ctx.user.id],
    absentees: input.absentees ?? [],
    projectId: input.projectId ?? null,
    visibility: input.projectId ? (input.visibility ?? 'site') : 'site',
    content: defaultBody(locale, prev ? parseActionItems(prev.content) : [], typeof tpl?.value === 'string' ? tpl.value : null),
    createdBy: ctx.user.id,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
  }
  await ctx.db.batch([
    ctx.db.insert(notes).values(note),
    // Baseline version, so the first real edit diffs against the template rather than nothing.
    ctx.db.insert(noteVersions).values({
      id: newId(),
      noteId: note.id,
      authorId: ctx.user.id,
      startedAt: now,
      endedAt: now,
      inserted: 0,
      deleted: 0,
      content: note.content,
      restoredFrom: 'created',
    }),
    activity(ctx, { entityType: 'note', entityId: note.id, action: 'created', data: { title: note.title }, projectId: note.projectId }),
  ])
  return note
}

export async function updateNote(ctx: Ctx, id: string, version: number, patch: Partial<NoteInput>) {
  requireScope(ctx, 'write')
  const n = await getNote(ctx, id)
  if (!canEditNote(ctx, n)) throw notFound()
  if (patch.projectId && !(await visibleProjectIds(ctx)).includes(patch.projectId)) throw notFound()
  const res = await ctx.db.batch([
    ctx.db
      .update(notes)
      .set({ ...patch, updatedAt: Date.now(), version: n.version + 1 })
      .where(and(eq(notes.id, id), eq(notes.version, version))),
    activity(ctx, { entityType: 'note', entityId: id, action: 'updated', data: { fields: Object.keys(patch).join(',') }, projectId: n.projectId }),
  ])
  if (res[0].meta.changes === 0) throw conflict()
  // Who may edit changed: open editors reconnect so the live document re-checks everyone.
  if (patch.attendeeIds || patch.recorderId)
    ctx.waitUntil(docRoom(ctx.env, id).fetch('https://doc/permissions', { method: 'POST', headers: { 'x-note-id': id } }).catch((err) => log('warn', 'doc permission refresh failed', { noteId: id, ...errorFields(err) })))
  return { ...n, ...patch, version: n.version + 1 }
}

export async function deleteNote(ctx: Ctx, id: string) {
  requireScope(ctx, 'write')
  const n = await getNote(ctx, id)
  if (!(isAdmin(ctx.user) || n.createdBy === ctx.user.id)) throw notFound()
  await ctx.db.batch([
    ctx.db.update(notes).set({ deletedAt: Date.now() }).where(eq(notes.id, id)),
    activity(ctx, { entityType: 'note', entityId: id, action: 'deleted', data: { title: n.title }, projectId: n.projectId }),
  ])
}

export type NoteQuery = {
  q?: string
  from?: number
  to?: number
  projectId?: string
  recorderId?: string
  attendeeId?: string
  openComments?: boolean
  offset: number
  limit: number
}

export async function listNotes(ctx: Ctx, q: NoteQuery) {
  const visible = await visibleProjectIds(ctx)
  const term = q.q?.trim()
  const where = and(
    isNull(notes.deletedAt),
    or(eq(notes.visibility, 'site'), isNull(notes.projectId), visible.length ? inArray(notes.projectId, visible) : sql`0`),
    q.from ? gte(notes.startsAt, q.from) : undefined,
    q.to ? lte(notes.startsAt, q.to) : undefined,
    q.projectId ? eq(notes.projectId, q.projectId) : undefined,
    q.recorderId ? eq(notes.recorderId, q.recorderId) : undefined,
    q.attendeeId ? sql`exists (select 1 from json_each(${notes.attendeeIds}) where value = ${q.attendeeId})` : undefined,
    q.openComments
      ? sql`exists (select 1 from note_comments c where c.note_id = ${notes.id} and c.parent_id is null and c.resolved_at is null and c.deleted_at is null)`
      : undefined,
    // ponytail: LIKE scan; move to a D1 FTS5 table if notes grow past ~50k.
    term ? or(like(notes.title, `%${term}%`), like(notes.content, `%${term}%`)) : undefined,
  )
  const [rows, total] = await Promise.all([
    ctx.db.select().from(notes).where(where).orderBy(desc(notes.startsAt)).limit(q.limit).offset(q.offset).all(),
    ctx.db.select({ n: sql<number>`count(*)` }).from(notes).where(where).get(),
  ])
  const ids = rows.map((r) => r.id)
  const counts = ids.length
    ? await ctx.db
        .select({ noteId: noteComments.noteId, n: sql<number>`count(*)` })
        .from(noteComments)
        .where(and(inArray(noteComments.noteId, ids), isNull(noteComments.parentId), isNull(noteComments.resolvedAt), isNull(noteComments.deletedAt)))
        .groupBy(noteComments.noteId)
        .all()
    : []
  const open = new Map(counts.map((c) => [c.noteId, c.n]))
  return {
    total: total?.n ?? 0,
    items: rows.map(({ content, ...r }) => ({
      ...r,
      openComments: open.get(r.id) ?? 0,
      snippet: term ? snippet(content, term) : null,
    })),
  }
}

function snippet(text: string, term: string) {
  const i = text.toLowerCase().indexOf(term.toLowerCase())
  if (i < 0) return null
  const start = Math.max(0, i - 40)
  return (start > 0 ? '…' : '') + text.slice(start, i + term.length + 60).replace(/\s+/g, ' ') + '…'
}

// ---------- history ----------

export async function listVersions(ctx: Ctx, noteId: string, before: number | undefined, limit: number) {
  await getNote(ctx, noteId)
  const rows = await ctx.db
    .select({
      id: noteVersions.id,
      authorId: noteVersions.authorId,
      startedAt: noteVersions.startedAt,
      endedAt: noteVersions.endedAt,
      inserted: noteVersions.inserted,
      deleted: noteVersions.deleted,
      restoredFrom: noteVersions.restoredFrom,
    })
    .from(noteVersions)
    .where(and(eq(noteVersions.noteId, noteId), before ? lt(noteVersions.endedAt, before) : undefined))
    .orderBy(desc(noteVersions.endedAt))
    .limit(limit + 1)
    .all()
  const more = rows.length > limit
  const items = rows.slice(0, limit)
  return { items, nextBefore: more ? items[items.length - 1]!.endedAt : null }
}

/** A version plus the one right before it, for a diff. */
export async function getVersion(ctx: Ctx, noteId: string, versionId: string) {
  await getNote(ctx, noteId)
  const v = await ctx.db
    .select()
    .from(noteVersions)
    .where(and(eq(noteVersions.id, versionId), eq(noteVersions.noteId, noteId)))
    .get()
  if (!v) throw notFound()
  const prev = await ctx.db
    .select({ content: noteVersions.content })
    .from(noteVersions)
    .where(and(eq(noteVersions.noteId, noteId), lt(noteVersions.endedAt, v.endedAt)))
    .orderBy(desc(noteVersions.endedAt))
    .get()
  return { ...v, previous: prev?.content ?? '' }
}

export async function restoreVersion(ctx: Ctx, noteId: string, versionId: string) {
  requireScope(ctx, 'write')
  const n = await getNote(ctx, noteId)
  if (!canEditNote(ctx, n)) throw notFound()
  const v = await ctx.db
    .select()
    .from(noteVersions)
    .where(and(eq(noteVersions.id, versionId), eq(noteVersions.noteId, noteId)))
    .get()
  if (!v) throw notFound()
  await docRoom(ctx.env, noteId).fetch('https://doc/restore', {
    method: 'POST',
    headers: { 'x-note-id': noteId },
    body: JSON.stringify({ content: v.content, userId: ctx.user.id }),
  })
  // Mark the version the DO just wrote as a restore of `versionId`.
  const latest = await ctx.db
    .select({ id: noteVersions.id })
    .from(noteVersions)
    .where(and(eq(noteVersions.noteId, noteId), eq(noteVersions.authorId, ctx.user.id)))
    .orderBy(desc(noteVersions.endedAt))
    .get()
  if (latest) await ctx.db.update(noteVersions).set({ restoredFrom: versionId }).where(eq(noteVersions.id, latest.id))
  await activity(ctx, { entityType: 'note', entityId: noteId, action: 'restored', data: { versionId }, projectId: n.projectId })
}

export const docRoom = (env: Env, noteId: string) => env.DOC_ROOM.get(env.DOC_ROOM.idFromName(noteId))

/** Yjs client id → account id, for authorship colouring on the client. */
export async function noteAuthors(ctx: Ctx, noteId: string) {
  await getNote(ctx, noteId)
  const r = await docRoom(ctx.env, noteId).fetch('https://doc/clients', { headers: { 'x-note-id': noteId } })
  return (await r.json()) as Record<string, { userId: string; lastAt: number }>
}

/** Current Markdown, including the generated info header (for MCP / export). */
export async function noteMarkdown(ctx: Ctx, n: Note, names: Map<string, string>, locale: Locale) {
  const r = await docRoom(ctx.env, n.id).fetch('https://doc/text', { headers: { 'x-note-id': n.id } })
  const body = r.ok ? await r.text() : n.content
  const nm = (id: string) => names.get(id) ?? id
  const date = new Date(n.startsAt).toISOString().replace('T', ' ').slice(0, 16)
  const L = locale === 'zh'
    ? { title: '會議紀錄', item: '項目', val: '內容', when: '日期時間', where: '地點', rec: '記錄人', att: '出席', abs: '缺席' }
    : { title: 'Meeting notes', item: 'Item', val: 'Details', when: 'Date & time', where: 'Location', rec: 'Recorder', att: 'Attendees', abs: 'Absent' }
  const absent = n.absentees.map((a) => `${a.userId ? nm(a.userId) : (a.name ?? '')}${a.reason ? `（${a.reason}）` : ''}`).join('、')
  return `# ${L.title}：${n.title}

| ${L.item} | ${L.val} |
|------|------|
| ${L.when} | ${date} UTC |
| ${L.where} | ${n.location} |
| ${L.rec} | ${nm(n.recorderId)} |
| ${L.att} | ${n.attendeeIds.map(nm).join('、')} |
| ${L.abs} | ${absent} |

${body}`
}

