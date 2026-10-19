import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import type { AppEnv, C } from '../context'
import { body } from '../context'
import { randomToken } from '../lib/crypto'
import { AppError } from '../lib/errors'
import { log } from '../lib/log'
import {
  LAST_LOGIN_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  exchangeGoogleCode,
  googleAuthUrl,
  pkcePair,
  revokeSession,
  upsertUser,
} from '../services/auth'

const OAUTH_COOKIE = 'ms_oauth'
const YEAR_S = 365 * 86400

const secure = (c: C) => new URL(c.req.url).protocol === 'https:'
const isLocalHost = (c: C) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname)
export const devLoginEnabled = (c: C) => c.env.DEV_LOGIN === 'true' && isLocalHost(c)

/** Only same-origin relative paths; anything else falls back to home. */
const safeNext = (next: string | undefined) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/')

export async function startSession(c: C, userId: string, email: string) {
  const token = await createSession(c.get('db'), userId, c.req.header('user-agent') ?? null)
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secure(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
  setCookie(c, LAST_LOGIN_COOKIE, email, { httpOnly: true, secure: secure(c), sameSite: 'Lax', path: '/', maxAge: YEAR_S })
}

export const authRoutes = new Hono<AppEnv>()

authRoutes.get('/google', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) throw new AppError('bad_request', 400, 'Google login is not configured')
  const state = randomToken(16)
  const { verifier, challenge } = await pkcePair()
  const next = safeNext(c.req.query('next'))
  setCookie(c, OAUTH_COOKIE, JSON.stringify({ state, verifier, next }), {
    httpOnly: true,
    secure: secure(c),
    sameSite: 'Lax',
    path: '/auth',
    maxAge: 600,
  })
  const switchAccount = c.req.query('switch') === '1'
  return c.redirect(
    googleAuthUrl(c.env, {
      redirectUri: new URL('/auth/google/callback', c.req.url).toString(),
      state,
      challenge,
      loginHint: getCookie(c, LAST_LOGIN_COOKIE),
      selectAccount: switchAccount,
    }),
  )
})

authRoutes.get('/google/callback', async (c) => {
  const raw = getCookie(c, OAUTH_COOKIE)
  deleteCookie(c, OAUTH_COOKIE, { path: '/auth' })
  if (c.req.query('error')) return c.redirect('/login?cancelled=1')
  let saved: { state: string; verifier: string; next: string } | null
  try {
    saved = raw ? JSON.parse(raw) : null
  } catch {
    saved = null
  }
  if (!saved || saved.state !== c.req.query('state') || !c.req.query('code')) {
    log('warn', 'oauth state mismatch', { requestId: c.get('requestId') })
    return c.redirect('/login?error=state')
  }
  try {
    const profile = await exchangeGoogleCode(c.env, {
      code: c.req.query('code')!,
      verifier: saved.verifier,
      redirectUri: new URL('/auth/google/callback', c.req.url).toString(),
    })
    const { user } = await upsertUser(c.get('db'), c.env, profile)
    await startSession(c, user.id, user.email)
    return c.redirect(user.onboardedAt ? safeNext(saved.next) : `/welcome?next=${encodeURIComponent(safeNext(saved.next))}`)
  } catch (err) {
    if (err instanceof AppError && err.code === 'account_disabled') return c.redirect('/login?error=disabled')
    log('error', 'oauth callback failed', { requestId: c.get('requestId'), error: String(err) })
    return c.redirect('/login?error=failed')
  }
})

/** Local-only login so the app can be tested without Google credentials. */
authRoutes.post('/dev', async (c) => {
  if (!devLoginEnabled(c)) throw new AppError('not_found', 404, 'Not found')
  const input = await body(c, z.object({ email: z.email(), name: z.string().trim().min(1).max(40) }))
  const { user } = await upsertUser(c.get('db'), c.env, { email: input.email, sub: null, name: input.name, picture: null })
  await startSession(c, user.id, user.email)
  return c.json({ ok: true, onboarded: !!user.onboardedAt })
})

authRoutes.post('/logout', async (c) => {
  const sessionId = c.get('sessionId')
  if (sessionId) await revokeSession(c.get('db'), sessionId)
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  if (c.req.query('forget') === '1') deleteCookie(c, LAST_LOGIN_COOKIE, { path: '/' })
  return c.json({ ok: true })
})
