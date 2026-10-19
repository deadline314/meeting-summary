import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Ctx } from '../context'
import { isAdmin, requireScope } from '../context'
import { files, settings } from '../db/schema'
import { newId } from '../lib/crypto'
import { AppError, notFound } from '../lib/errors'
import { getNote } from './notes'

export type FileRow = typeof files.$inferSelect
export type ParentType = FileRow['parentType']

const MB = 1024 * 1024
export const DEFAULT_LIMITS = { maxFileBytes: 50 * MB, quotaBytes: 1024 * MB }

export async function limits(ctx: Pick<Ctx, 'db'>) {
  const row = await ctx.db.select().from(settings).where(eq(settings.key, 'file_limits')).get()
  return { ...DEFAULT_LIMITS, ...((row?.value as Partial<typeof DEFAULT_LIMITS>) ?? {}) }
}

export async function usedBytes(ctx: Pick<Ctx, 'db'>, userId: string) {
  const r = await ctx.db
    .select({ n: sql<number>`coalesce(sum(${files.size}), 0)` })
    .from(files)
    .where(and(eq(files.ownerId, userId), isNull(files.deletedAt)))
    .get()
  return r?.n ?? 0
}

type ParentCheck = (ctx: Ctx, parentId: string, mode: 'read' | 'write') => Promise<void>

/** Each module registers how to authorize files attached to its objects. */
export const parentChecks: Partial<Record<ParentType, ParentCheck>> = {
  // Anyone who can read a note can attach (comment screenshots); editors use the same path for the body.
  note: async (ctx, id) => void (await getNote(ctx, id)),
  avatar: async (ctx, id, mode) => {
    if (mode === 'write' && id !== ctx.user.id) throw notFound()
  },
}

/** Permission is delegated to the parent object. Throws 404 when not allowed. */
export async function assertParent(ctx: Ctx, parentType: ParentType, parentId: string, mode: 'read' | 'write') {
  const check = parentChecks[parentType]
  if (!check) throw notFound()
  await check(ctx, parentId, mode)
}

const SAFE_INLINE = /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf|text\/plain|video\/(mp4|webm))$/

export async function uploadFile(
  ctx: Ctx,
  o: { parentType: ParentType; parentId: string; name: string; mime: string; size: number; body: ReadableStream },
) {
  requireScope(ctx, 'write')
  await assertParent(ctx, o.parentType, o.parentId, 'write')
  const lim = await limits(ctx)
  if (o.size > lim.maxFileBytes) throw new AppError('payload_too_large', 413, 'File too large', { limit: `${Math.round(lim.maxFileBytes / MB)} MB` })
  const used = await usedBytes(ctx, ctx.user.id)
  if (used + o.size > lim.quotaBytes && !isAdmin(ctx.user)) {
    throw new AppError('quota_exceeded', 413, 'Storage quota exceeded', { used: `${Math.round(used / MB)} MB`, total: `${Math.round(lim.quotaBytes / MB)} MB` })
  }
  const id = newId()
  const r2Key = `${o.parentType}/${o.parentId}/${id}`
  // Upload first, record after: an interrupted upload never leaves a dangling row.
  await ctx.env.FILES.put(r2Key, o.body.pipeThrough(new FixedLengthStream(o.size)), {
    httpMetadata: { contentType: o.mime },
    customMetadata: { name: o.name, owner: ctx.user.id },
  })
  const row: FileRow = {
    id,
    ownerId: ctx.user.id,
    r2Key,
    name: o.name.slice(0, 200),
    mime: o.mime,
    size: o.size,
    kind: o.mime.startsWith('image/') ? 'image' : 'file',
    parentType: o.parentType,
    parentId: o.parentId,
    driveUrl: null,
    driveOwner: null,
    status: 'ready',
    createdAt: Date.now(),
    deletedAt: null,
  }
  try {
    await ctx.db.insert(files).values(row)
  } catch (err) {
    await ctx.env.FILES.delete(r2Key).catch(() => undefined)
    throw err
  }
  return row
}

export async function linkDriveFile(ctx: Ctx, o: { parentType: ParentType; parentId: string; name: string; mime: string; url: string; owner?: string | null }) {
  requireScope(ctx, 'write')
  await assertParent(ctx, o.parentType, o.parentId, 'write')
  const row: FileRow = {
    id: newId(),
    ownerId: ctx.user.id,
    r2Key: '',
    name: o.name.slice(0, 200),
    mime: o.mime,
    size: 0,
    kind: 'drive',
    parentType: o.parentType,
    parentId: o.parentId,
    driveUrl: o.url,
    driveOwner: o.owner ?? null,
    status: 'ready',
    createdAt: Date.now(),
    deletedAt: null,
  }
  await ctx.db.insert(files).values(row)
  return row
}

export async function listFiles(ctx: Ctx, parentType: ParentType, parentId: string) {
  await assertParent(ctx, parentType, parentId, 'read')
  return ctx.db
    .select()
    .from(files)
    .where(and(eq(files.parentType, parentType), eq(files.parentId, parentId), isNull(files.deletedAt)))
    .all()
}

export async function getFile(ctx: Ctx, id: string) {
  const f = await ctx.db.select().from(files).where(eq(files.id, id)).get()
  if (!f || f.deletedAt) throw notFound()
  await assertParent(ctx, f.parentType, f.parentId, 'read')
  return f
}

/** Streams a stored object. Unsafe types are forced to download so they can't run as HTML on our origin. */
export async function serveFile(ctx: Ctx, id: string, download: boolean) {
  const f = await getFile(ctx, id)
  if (f.kind === 'drive') return Response.redirect(f.driveUrl!, 302)
  const obj = await ctx.env.FILES.get(f.r2Key)
  if (!obj) throw notFound()
  const inline = !download && SAFE_INLINE.test(f.mime)
  return new Response(obj.body, {
    headers: {
      'content-type': inline ? f.mime : 'application/octet-stream',
      'content-length': String(obj.size),
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'cache-control': 'private, max-age=86400, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      etag: obj.httpEtag,
    },
  })
}

export async function readFileText(ctx: Pick<Ctx, 'env'>, f: FileRow, maxBytes = 2 * MB) {
  const obj = await ctx.env.FILES.get(f.r2Key, { range: { offset: 0, length: maxBytes } })
  return obj ? await obj.text() : ''
}

export async function deleteFile(ctx: Ctx, id: string) {
  requireScope(ctx, 'write')
  const f = await getFile(ctx, id)
  if (f.ownerId !== ctx.user.id && !isAdmin(ctx.user)) throw notFound()
  await ctx.db.update(files).set({ deletedAt: Date.now() }).where(eq(files.id, id))
  // Drive links only drop our pointer; the user's Drive file is never touched.
  if (f.kind !== 'drive') ctx.waitUntil(ctx.env.FILES.delete(f.r2Key).catch(() => undefined))
}
