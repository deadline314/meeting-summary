import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Ctx } from '../context'
import { requireScope } from '../context'
import { noteComments } from '../db/schema'
import { newId } from '../lib/crypto'
import { badRequest, notFound } from '../lib/errors'
import { activity } from './activity'
import { getNote } from './notes'
import { mentionedUserIds, notify } from './notify'

export type Anchor = { start: string; end: string }

export async function listComments(ctx: Ctx, noteId: string) {
  await getNote(ctx, noteId)
  const rows = await ctx.db
    .select()
    .from(noteComments)
    .where(eq(noteComments.noteId, noteId))
    .orderBy(asc(noteComments.createdAt))
    .all()
  // Deleted comments keep their slot so replies still make sense, but lose their body.
  return rows.map((r) => (r.deletedAt ? { ...r, body: '' } : r))
}

export async function addComment(ctx: Ctx, noteId: string, input: { body: string; parentId?: string; anchor?: Anchor; quote?: string }) {
  requireScope(ctx, 'write')
  const note = await getNote(ctx, noteId)
  let parent: typeof noteComments.$inferSelect | undefined
  if (input.parentId) {
    parent = await ctx.db
      .select()
      .from(noteComments)
      .where(and(eq(noteComments.id, input.parentId), eq(noteComments.noteId, noteId)))
      .get()
    if (!parent) throw notFound()
    if (parent.parentId) throw badRequest('Replies are one level deep')
  } else if (!input.anchor) {
    throw badRequest('A new thread needs a text anchor')
  }
  const row = {
    id: newId(),
    noteId,
    parentId: parent?.id ?? null,
    authorId: ctx.user.id,
    body: input.body,
    anchor: parent ? null : (input.anchor ?? null),
    quote: parent ? null : (input.quote?.slice(0, 500) ?? null),
    resolvedAt: null,
    resolvedBy: null,
    createdAt: Date.now(),
    editedAt: null,
    deletedAt: null,
  }
  await ctx.db.batch([
    ctx.db.insert(noteComments).values(row),
    activity(ctx, { entityType: 'note', entityId: noteId, action: parent ? 'replied' : 'commented', data: { commentId: row.id, quote: row.quote ?? '' }, projectId: note.projectId }),
  ])
  const threadAuthors = parent ? [parent.authorId] : []
  notify(ctx, [note.createdBy, note.recorderId, ...threadAuthors], {
    type: parent ? 'note_reply' : 'note_comment',
    entityType: 'note',
    entityId: noteId,
    data: { commentId: row.id, title: note.title },
  })
  notify(ctx, mentionedUserIds(input.body), { type: 'mention', entityType: 'note', entityId: noteId, data: { commentId: row.id, title: note.title } })
  return row
}

async function own(ctx: Ctx, noteId: string, id: string) {
  await getNote(ctx, noteId)
  const c = await ctx.db
    .select()
    .from(noteComments)
    .where(and(eq(noteComments.id, id), eq(noteComments.noteId, noteId), isNull(noteComments.deletedAt)))
    .get()
  if (!c) throw notFound()
  return c
}

export async function editComment(ctx: Ctx, noteId: string, id: string, body: string) {
  requireScope(ctx, 'write')
  const c = await own(ctx, noteId, id)
  if (c.authorId !== ctx.user.id) throw notFound()
  const editedAt = Date.now()
  await ctx.db.update(noteComments).set({ body, editedAt }).where(eq(noteComments.id, id))
  return { ...c, body, editedAt }
}

export async function deleteComment(ctx: Ctx, noteId: string, id: string) {
  requireScope(ctx, 'write')
  const c = await own(ctx, noteId, id)
  if (c.authorId !== ctx.user.id) throw notFound()
  await ctx.db.update(noteComments).set({ deletedAt: Date.now() }).where(eq(noteComments.id, id))
}

/** Anyone who can read the note may resolve / reopen a thread. */
export async function resolveComment(ctx: Ctx, noteId: string, id: string, resolved: boolean) {
  requireScope(ctx, 'write')
  const c = await own(ctx, noteId, id)
  if (c.parentId) throw badRequest('Only threads can be resolved')
  const patch = resolved ? { resolvedAt: Date.now(), resolvedBy: ctx.user.id } : { resolvedAt: null, resolvedBy: null }
  await ctx.db.batch([
    ctx.db.update(noteComments).set(patch).where(eq(noteComments.id, id)),
    activity(ctx, { entityType: 'note', entityId: noteId, action: resolved ? 'comment_resolved' : 'comment_reopened', data: { commentId: id } }),
  ])
  return { ...c, ...patch }
}
