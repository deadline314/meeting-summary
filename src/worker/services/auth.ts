import { and, eq, gt, ne } from 'drizzle-orm'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { DB } from '../db'
import { sessions, users } from '../db/schema'
import type { User } from '../context'
import { newId, randomToken, sha256 } from '../lib/crypto'
import { AppError } from '../lib/errors'
import { activities } from '../db/schema'

export const SESSION_COOKIE = 'ms_session'
export const LAST_LOGIN_COOKIE = 'ms_last'
export const SESSION_TTL_MS = 30 * 86400_000
const SLIDE_AFTER_MS = 86400_000

export async function createSession(db: DB, userId: string, userAgent: string | null) {
  const token = randomToken()
  const now = Date.now()
  await db.insert(sessions).values({
    id: await sha256(token),
    userId,
    userAgent: userAgent?.slice(0, 300) ?? null,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: now + SESSION_TTL_MS,
  })
  return token
}

/** Resolves a cookie token; slides the expiry once per day. Returns null for expired/unknown/inactive. */
export async function resolveSession(db: DB, token: string) {
  const id = await sha256(token)
  const now = Date.now()
  const row = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .get()
  if (!row) return null
  if (row.user.status !== 'active') {
    await db.delete(sessions).where(eq(sessions.userId, row.user.id))
    return { kind: 'disabled' as const }
  }
  let slid = false
  if (now - row.session.lastUsedAt > SLIDE_AFTER_MS) {
    slid = true
    await db.batch([
      db.update(sessions).set({ lastUsedAt: now, expiresAt: now + SESSION_TTL_MS }).where(eq(sessions.id, id)),
      db.update(users).set({ lastSeenAt: now }).where(eq(users.id, row.user.id)),
    ])
  }
  return { kind: 'ok' as const, user: row.user, sessionId: id, slid }
}

export async function revokeSession(db: DB, sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId))
}

export async function revokeOtherSessions(db: DB, userId: string, keep: string) {
  await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keep)))
}

type Profile = { email: string; sub: string | null; name: string; picture: string | null }

/** Find or create the account for a verified identity. New accounts start as students. */
export async function upsertUser(db: DB, env: Env, p: Profile): Promise<{ user: User; isNew: boolean }> {
  const email = p.email.toLowerCase()
  const owners = env.OWNER_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const isOwnerEmail = owners.includes(email)
  const existing = await db.select().from(users).where(eq(users.email, email)).get()
  const now = Date.now()
  if (existing) {
    if (existing.status !== 'active') throw new AppError('account_disabled', 403, 'Account disabled')
    const patch: Partial<User> = { googleName: p.name, lastSeenAt: now }
    if (p.sub && !existing.googleSub) patch.googleSub = p.sub
    if (p.picture && !existing.avatarUrl) patch.avatarUrl = p.picture
    if (isOwnerEmail && existing.role !== 'owner') patch.role = 'owner'
    await db.update(users).set(patch).where(eq(users.id, existing.id))
    return { user: { ...existing, ...patch }, isNew: false }
  }
  const user: User = {
    id: newId(),
    email,
    googleSub: p.sub,
    name: p.name || email.split('@')[0]!,
    googleName: p.name || email.split('@')[0]!,
    avatarUrl: p.picture,
    role: isOwnerEmail ? 'owner' : 'student',
    status: 'active',
    prefs: {},
    onboardedAt: null,
    createdAt: now,
    lastSeenAt: now,
  }
  await db.batch([
    db.insert(users).values(user),
    db.insert(activities).values({
      id: newId(),
      actorId: user.id,
      entityType: 'user',
      entityId: user.id,
      action: 'joined',
      data: { role: user.role },
      source: 'web',
      createdAt: now,
    }),
  ])
  return { user, isNew: true }
}

// ---------- Google OIDC ----------

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

export async function pkcePair() {
  const verifier = randomToken(48)
  const challenge = await sha256(verifier)
  return { verifier, challenge }
}

export function googleAuthUrl(env: Env, o: { redirectUri: string; state: string; challenge: string; loginHint?: string; selectAccount?: boolean }) {
  const u = new URL(GOOGLE_AUTH)
  u.searchParams.set('client_id', env.GOOGLE_CLIENT_ID)
  u.searchParams.set('redirect_uri', o.redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', 'openid email profile')
  u.searchParams.set('state', o.state)
  u.searchParams.set('code_challenge', o.challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  if (o.selectAccount) u.searchParams.set('prompt', 'select_account')
  else if (o.loginHint) u.searchParams.set('login_hint', o.loginHint)
  return u.toString()
}

export async function exchangeGoogleCode(env: Env, o: { code: string; verifier: string; redirectUri: string }): Promise<Profile> {
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: o.code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: o.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: o.verifier,
    }),
  })
  if (!res.ok) throw new AppError('unauthenticated', 401, `Google token exchange failed (${res.status})`)
  const { id_token } = (await res.json()) as { id_token?: string }
  if (!id_token) throw new AppError('unauthenticated', 401, 'Google returned no id_token')
  const { payload } = await jwtVerify(id_token, googleJwks, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: env.GOOGLE_CLIENT_ID,
  })
  if (typeof payload.email !== 'string' || payload.email_verified !== true) {
    throw new AppError('unauthenticated', 401, 'Google account email not verified')
  }
  return {
    email: payload.email,
    sub: payload.sub ?? null,
    name: typeof payload.name === 'string' ? payload.name : '',
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  }
}
