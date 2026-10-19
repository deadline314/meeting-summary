import { and, asc, eq, like, ne, or, sql } from 'drizzle-orm'
import type { Ctx, User } from '../context'
import { isAdmin, isOwner } from '../context'
import { rateLimits, sessions, settings, users } from '../db/schema'
import { randomToken, safeEqual, sha256 } from '../lib/crypto'
import { AppError, notFound } from '../lib/errors'
import { activity } from './activity'

export type Prefs = User['prefs']

export function userDto(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    googleName: u.googleName,
    avatarUrl: u.avatarUrl,
    role: u.role,
    status: u.status,
    prefs: u.prefs,
    onboarded: !!u.onboardedAt,
    createdAt: u.createdAt,
    lastSeenAt: u.lastSeenAt,
  }
}

export async function updateMe(ctx: Ctx, input: { name?: string; avatarUrl?: string | null; prefs?: Prefs; onboarded?: boolean }) {
  const patch: Partial<User> = {}
  const ops = []
  if (input.name !== undefined && input.name !== ctx.user.name) {
    patch.name = input.name
    ops.push(activity(ctx, { entityType: 'user', entityId: ctx.user.id, action: 'renamed', data: { from: ctx.user.name, to: input.name } }))
  }
  if (input.avatarUrl !== undefined) patch.avatarUrl = input.avatarUrl
  if (input.prefs) patch.prefs = { ...ctx.user.prefs, ...input.prefs }
  if (input.onboarded && !ctx.user.onboardedAt) patch.onboardedAt = Date.now()
  if (Object.keys(patch).length === 0) return userDto(ctx.user)
  await ctx.db.batch([ctx.db.update(users).set(patch).where(eq(users.id, ctx.user.id)), ...ops])
  return userDto({ ...ctx.user, ...patch })
}

/** Every non-removed account, for resolving ids to names on the client. */
export async function directory(ctx: Ctx) {
  // ponytail: whole directory in one response; paginate once a site passes a few thousand users.
  return ctx.db
    .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl, role: users.role, status: users.status })
    .from(users)
    .where(ne(users.status, 'removed'))
    .orderBy(asc(users.name))
    .all()
}

// ---------- admin key ----------

const ADMIN_KEY = 'admin_key_hash'
const MAX_ATTEMPTS = 5
const LOCK_MS = 15 * 60_000

export async function redeemAdminKey(ctx: Ctx, key: string) {
  if (isAdmin(ctx.user)) return userDto(ctx.user)
  const now = Date.now()
  const rlKey = `admin-key:${ctx.user.id}`
  const rl = await ctx.db.select().from(rateLimits).where(eq(rateLimits.key, rlKey)).get()
  if (rl && rl.count >= MAX_ATTEMPTS && rl.resetAt > now) {
    throw new AppError('admin_key_locked', 429, 'Too many attempts', { minutes: Math.ceil((rl.resetAt - now) / 60_000) })
  }
  const stored = await ctx.db.select().from(settings).where(eq(settings.key, ADMIN_KEY)).get()
  const ok = typeof stored?.value === 'string' && safeEqual(stored.value, await sha256(key.trim()))
  if (!ok) {
    const fresh = !rl || rl.resetAt <= now
    await ctx.db
      .insert(rateLimits)
      .values({ key: rlKey, count: 1, resetAt: now + LOCK_MS })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: fresh ? { count: 1, resetAt: now + LOCK_MS } : { count: sql`${rateLimits.count} + 1`, resetAt: now + LOCK_MS },
      })
    throw new AppError('invalid_admin_key', 400, 'Admin key is incorrect')
  }
  await ctx.db.batch([
    ctx.db.update(users).set({ role: 'admin' }).where(eq(users.id, ctx.user.id)),
    ctx.db.delete(rateLimits).where(eq(rateLimits.key, rlKey)),
    activity(ctx, { entityType: 'user', entityId: ctx.user.id, action: 'role_changed', data: { from: ctx.user.role, to: 'admin', via: 'key' } }),
  ])
  return userDto({ ...ctx.user, role: 'admin' })
}

export async function rotateAdminKey(ctx: Ctx) {
  if (!isOwner(ctx.user)) throw notFound()
  const key = `adm_${randomToken(18)}`
  const hash = await sha256(key)
  await ctx.db.batch([
    ctx.db.insert(settings).values({ key: ADMIN_KEY, value: hash }).onConflictDoUpdate({ target: settings.key, set: { value: hash } }),
    activity(ctx, { entityType: 'site', entityId: 'admin_key', action: 'rotated' }),
  ])
  return key
}

export async function hasAdminKey(ctx: Ctx) {
  return !!(await ctx.db.select().from(settings).where(eq(settings.key, ADMIN_KEY)).get())
}

// ---------- member management ----------

export async function listMembers(ctx: Ctx, q: { search?: string; role?: User['role']; offset: number; limit: number }) {
  if (!isAdmin(ctx.user)) throw notFound()
  const where = and(
    ne(users.status, 'removed'),
    q.role ? eq(users.role, q.role) : undefined,
    q.search ? or(like(users.name, `%${q.search}%`), like(users.email, `%${q.search}%`)) : undefined,
  )
  const [rows, total] = await Promise.all([
    ctx.db.select().from(users).where(where).orderBy(asc(users.name)).limit(q.limit).offset(q.offset).all(),
    ctx.db.select({ n: sql<number>`count(*)` }).from(users).where(where).get(),
  ])
  return { items: rows.map(userDto), total: total?.n ?? 0 }
}

async function ownerCount(ctx: Ctx) {
  const r = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.role, 'owner'), eq(users.status, 'active')))
    .get()
  return r?.n ?? 0
}

export async function setMember(ctx: Ctx, targetId: string, input: { role?: User['role']; status?: User['status'] }) {
  if (!isAdmin(ctx.user)) throw notFound()
  const target = await ctx.db.select().from(users).where(eq(users.id, targetId)).get()
  if (!target || target.status === 'removed') throw notFound()
  // Only owners can touch owners or hand out the owner role.
  if ((target.role === 'owner' || input.role === 'owner') && !isOwner(ctx.user)) throw notFound()
  const losingOwner = target.role === 'owner' && ((input.role && input.role !== 'owner') || (input.status && input.status !== 'active'))
  if (losingOwner && (await ownerCount(ctx)) <= 1) throw new AppError('last_owner', 422, 'The last teacher cannot be demoted or removed')

  const patch: Partial<User> = {}
  const ops = []
  if (input.role && input.role !== target.role) {
    patch.role = input.role
    ops.push(activity(ctx, { entityType: 'user', entityId: target.id, action: 'role_changed', data: { from: target.role, to: input.role, via: 'admin' } }))
  }
  if (input.status && input.status !== target.status) {
    patch.status = input.status
    ops.push(activity(ctx, { entityType: 'user', entityId: target.id, action: 'status_changed', data: { from: target.status, to: input.status } }))
    if (input.status !== 'active') ops.push(ctx.db.delete(sessions).where(eq(sessions.userId, target.id)))
  }
  if (ops.length) await ctx.db.batch([ctx.db.update(users).set(patch).where(eq(users.id, target.id)), ...ops])
  return userDto({ ...target, ...patch })
}
