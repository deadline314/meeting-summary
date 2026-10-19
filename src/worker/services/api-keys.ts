import { and, desc, eq, isNull } from 'drizzle-orm'
import type { ApiKeyGrant, Ctx, User } from '../context'
import type { DB } from '../db'
import { apiKeys, users } from '../db/schema'
import { newId, randomToken, sha256 } from '../lib/crypto'
import { AppError, notFound } from '../lib/errors'
import { activity } from './activity'
import { visibleProjectIds } from './projects'

export const KEY_PREFIX = 'msk_'
const MAX_KEYS = 20

export async function createApiKey(ctx: Ctx, input: { name: string; scope: 'read' | 'write' | 'manage'; projectIds?: string[] | null; expiresAt?: number | null }) {
  if (ctx.apiKey) throw notFound() // keys cannot mint keys
  const mine = await ctx.db.select({ id: apiKeys.id }).from(apiKeys).where(and(eq(apiKeys.userId, ctx.user.id), isNull(apiKeys.revokedAt))).all()
  if (mine.length >= MAX_KEYS) throw new AppError('rate_limited', 429, `At most ${MAX_KEYS} active keys`)
  if (input.projectIds?.length) {
    const visible = new Set(await visibleProjectIds(ctx))
    if (input.projectIds.some((id) => !visible.has(id))) throw notFound()
  }
  const secret = `${KEY_PREFIX}${randomToken(24)}`
  const row = {
    id: newId(),
    userId: ctx.user.id,
    name: input.name,
    hash: await sha256(secret),
    prefix: secret.slice(0, 10),
    scope: input.scope,
    projectIds: input.projectIds?.length ? input.projectIds : null,
    expiresAt: input.expiresAt ?? null,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: Date.now(),
  }
  await ctx.db.batch([ctx.db.insert(apiKeys).values(row), activity(ctx, { entityType: 'api_key', entityId: row.id, action: 'created', data: { name: row.name, scope: row.scope } })])
  const { hash: _h, ...dto } = row
  return { key: dto, secret }
}

export async function listApiKeys(ctx: Ctx) {
  const rows = await ctx.db.select().from(apiKeys).where(eq(apiKeys.userId, ctx.user.id)).orderBy(desc(apiKeys.createdAt)).all()
  return rows.map(({ hash: _h, ...r }) => r)
}

export async function revokeApiKey(ctx: Ctx, id: string) {
  if (ctx.apiKey) throw notFound()
  const k = await ctx.db.select().from(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, ctx.user.id))).get()
  if (!k) throw notFound()
  await ctx.db.batch([
    ctx.db.update(apiKeys).set({ revokedAt: Date.now() }).where(eq(apiKeys.id, id)),
    activity(ctx, { entityType: 'api_key', entityId: id, action: 'revoked', data: { name: k.name } }),
  ])
}

// ponytail: per-isolate token bucket; swap for the Workers Rate Limiting binding if keys get abused across isolates.
const buckets = new Map<string, { tokens: number; at: number }>()
const RATE = 120 // requests per minute per key

function allow(keyId: string) {
  const now = Date.now()
  const b = buckets.get(keyId) ?? { tokens: RATE, at: now }
  b.tokens = Math.min(RATE, b.tokens + ((now - b.at) / 60_000) * RATE)
  b.at = now
  if (b.tokens < 1) return false
  b.tokens -= 1
  buckets.set(keyId, b)
  if (buckets.size > 5000) buckets.clear()
  return true
}

/**
 * Resolves a secret to its account. Re-read on every call (never cached), so revoking a
 * key or disabling the account takes effect immediately.
 */
export async function authenticateKey(db: DB, secret: string, waitUntil: (p: Promise<unknown>) => void): Promise<{ user: User; grant: ApiKeyGrant } | null> {
  if (!secret.startsWith(KEY_PREFIX)) return null
  const row = await db
    .select({ key: apiKeys, user: users })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(eq(apiKeys.hash, await sha256(secret)))
    .get()
  if (!row || row.key.revokedAt || (row.key.expiresAt && row.key.expiresAt < Date.now()) || row.user.status !== 'active') return null
  if (!allow(row.key.id)) throw new AppError('rate_limited', 429, 'Too many requests for this API key')
  // Touch last-used at most once a minute to save writes.
  if (!row.key.lastUsedAt || Date.now() - row.key.lastUsedAt > 60_000) {
    waitUntil(db.update(apiKeys).set({ lastUsedAt: Date.now() }).where(eq(apiKeys.id, row.key.id)).run().catch(() => undefined))
  }
  return { user: row.user, grant: { scope: row.key.scope, projectIds: row.key.projectIds } }
}
