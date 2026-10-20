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
  // A deleted first comment keeps its slot (without its body) while live replies hang under it;
  // deleted replies, and threads with nothing left, drop out.
  const live = new Set(rows.filter((r) => r.parentId && !r.deletedAt).map((r) => r.parentId))
  return rows.filter((r) => !r.deletedAt || (!r.parentId && live.has(r.id))).map((r) => (r.deletedAt ? { ...r, body: '' } : r))
}

/** A thread's first comment, as long as the thread is still on show (see listComments). */
async function thread(ctx: Ctx, noteId: string, id: string) {
  const root = await ctx.db
    .select()
    .from(noteComments)
    .where(and(eq(noteComments.id, id), eq(noteComments.noteId, noteId)))
    .get()
  if (!root) throw notFound()
  if (root.parentId) throw badRequest('Replies are one level deep')
  if (root.deletedAt) {
    const reply = await ctx.db
      .select({ id: noteComments.id })
      .from(noteComments)
      .where(and(eq(noteComments.parentId, id), isNull(noteComments.deletedAt)))
      .get()
    if (!reply) throw notFound()
  }
  return root
}

export async function addComment(ctx: Ctx, noteId: string, input: { body: string; parentId?: string; anchor?: Anchor; quote?: string }) {
  requireScope(ctx, 'write')
  const note = await getNote(ctx, noteId)
  let parent: typeof noteComments.$inferSelect | undefined
  if (input.parentId) {
    parent = await thread(ctx, noteId, input.parentId)
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
  const threadAuthors = parent && !parent.deletedAt ? [parent.authorId] : []
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
  await getNote(ctx, noteId)
  const c = await thread(ctx, noteId, id)
  const patch = resolved ? { resolvedAt: Date.now(), resolvedBy: ctx.user.id } : { resolvedAt: null, resolvedBy: null }
  await ctx.db.batch([
    ctx.db.update(noteComments).set(patch).where(eq(noteComments.id, id)),
    activity(ctx, { entityType: 'note', entityId: noteId, action: resolved ? 'comment_resolved' : 'comment_reopened', data: { commentId: id } }),
  ])
  return { ...c, ...patch, body: c.deletedAt ? '' : c.body }
}
