import type { Context } from 'hono'
import type { z } from 'zod'
import type { DB } from './db'
import type { users } from './db/schema'
import { AppError, unauthenticated } from './lib/errors'

export type User = typeof users.$inferSelect
export type Source = 'web' | 'mcp' | 'system'
export type ApiKeyGrant = { scope: 'read' | 'write' | 'manage'; projectIds: string[] | null }

/** Everything a service needs: one shape for REST, MCP and system callers. */
export type Ctx = {
  db: DB
  env: Env
  user: User
  source: Source
  requestId: string
  apiKey?: ApiKeyGrant
  waitUntil(p: Promise<unknown>): void
}

export type AppEnv = {
  Bindings: Env
  Variables: { requestId: string; db: DB; user: User | null; sessionId: string | null; apiKey?: ApiKeyGrant }
}
export type C = Context<AppEnv>

export function ctxOf(c: C, source: Source = 'web'): Ctx {
  const user = c.get('user')
  if (!user) throw unauthenticated()
  return {
    db: c.get('db'),
    env: c.env,
    user,
    source: c.get('apiKey') ? 'mcp' : source,
    requestId: c.get('requestId'),
    apiKey: c.get('apiKey'),
    waitUntil: (p) => c.executionCtx.waitUntil(p),
  }
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data)
  if (!r.success) {
    const first = r.error.issues[0]
    throw new AppError('validation', 400, first ? `${first.path.join('.')}: ${first.message}` : 'Invalid input', {
      field: first?.path.join('.') ?? '',
    })
  }
  return r.data
}

export async function body<T extends z.ZodType>(c: C, schema: T): Promise<z.infer<T>> {
  let json: unknown
  try {
    json = await c.req.json()
  } catch {
    throw new AppError('bad_request', 400, 'Body must be JSON')
  }
  return parse(schema, json)
}

export const isAdmin = (u: User) => u.role === 'admin' || u.role === 'owner'
export const isOwner = (u: User) => u.role === 'owner'

/** Writes through an API key need at least this scope. */
export function requireScope(ctx: Ctx, need: 'read' | 'write' | 'manage') {
  if (!ctx.apiKey) return
  const rank = { read: 0, write: 1, manage: 2 }
  if (rank[ctx.apiKey.scope] < rank[need]) throw new AppError('scope', 403, `API key scope "${need}" required`)
}
