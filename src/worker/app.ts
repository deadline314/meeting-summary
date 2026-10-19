import { lt, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { ApiErrorBody } from '@shared/errors'
import type { AppEnv } from './context'
import { getDb } from './db'
import { sessions } from './db/schema'
import { AppError } from './lib/errors'
import { errorFields, log } from './lib/log'
import { adminRoutes } from './routes/admin'
import { authRoutes } from './routes/auth'
import { fileRoutes, rawFileRoute } from './routes/files'
import { homeRoutes } from './routes/home'
import { meRoutes } from './routes/me'
import { noteRoutes, noteSocket } from './routes/notes'
import { graderRoutes, taskRoutes } from './routes/tasks'
import { projectRoutes } from './routes/projects'
import { sweepStuckJobs } from './services/grader'
import { alertUsage } from './services/site'
import { KEY_PREFIX, authenticateKey } from './services/api-keys'
import { mcpRoutes } from './routes/mcp'
import { notificationRoutes } from './routes/notifications'
import { SESSION_COOKIE, SESSION_TTL_MS, resolveSession } from './services/auth'

export const app = new Hono<AppEnv>()

app.use('*', async (c, next) => {
  const requestId = c.req.header('cf-ray') ?? crypto.randomUUID()
  c.set('requestId', requestId)
  c.set('db', getDb(c.env.DB))
  c.set('user', null)
  c.set('sessionId', null)
  const started = Date.now()
  await next()
  c.header('x-request-id', requestId)
  if (c.res.status >= 500) log('error', 'request failed', { requestId, method: c.req.method, path: c.req.path, status: c.res.status })
  else log('info', 'request', { requestId, method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - started })
})

// API key (Bearer msk_…) or session cookie → user. Unknown/expired credentials are ignored (routes decide).
app.use('*', async (c, next) => {
  const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (bearer?.startsWith(KEY_PREFIX) && !c.req.path.startsWith('/mcp')) {
    const auth = await authenticateKey(c.get('db'), bearer, (p) => c.executionCtx.waitUntil(p))
    if (auth) {
      c.set('user', auth.user)
      c.set('apiKey', auth.grant)
    }
    return next()
  }
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    const r = await resolveSession(c.get('db'), token)
    if (r?.kind === 'ok') {
      c.set('user', r.user)
      c.set('sessionId', r.sessionId)
      if (r.slid) {
        setCookie(c, SESSION_COOKIE, token, {
          httpOnly: true,
          secure: new URL(c.req.url).protocol === 'https:',
          sameSite: 'Lax',
          path: '/',
          maxAge: SESSION_TTL_MS / 1000,
        })
      }
    } else if (r?.kind === 'disabled') {
      throw new AppError('account_disabled', 403, 'Account disabled')
    }
  }
  await next()
})

// CSRF: cookie-authenticated writes must come from our own origin.
app.use('*', async (c, next) => {
  const m = c.req.method
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && !c.req.header('authorization')) {
    const origin = c.req.header('origin')
    if (origin && origin !== new URL(c.req.url).origin) throw new AppError('bad_request', 403, 'Cross-origin request blocked')
  }
  await next()
})

app.get('/api/health', async (c) => {
  const checks = await Promise.allSettled([c.env.DB.prepare('select 1').first(), c.env.FILES.head('__health__')])
  return c.json({
    version: c.env.APP_VERSION,
    d1: checks[0].status === 'fulfilled',
    r2: checks[1].status === 'fulfilled',
  })
})

app.route('/auth', authRoutes)
app.route('/api', meRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api', homeRoutes)
app.route('/api', noteRoutes)
app.route('/api', fileRoutes)
app.route('/api', taskRoutes)
app.route('/api', projectRoutes)
app.route('/api/grader', graderRoutes)
app.route('/mcp', mcpRoutes)
app.route('/api', notificationRoutes)
app.route('/files', rawFileRoute)
app.get('/ws/doc/:id', noteSocket)

app.notFound((c) => {
  const body: ApiErrorBody = { error: { code: 'not_found', message: 'Not found', requestId: c.get('requestId') } }
  return c.json(body, 404)
})

app.onError((err, c) => {
  const requestId = c.get('requestId') ?? 'unknown'
  if (err instanceof AppError) {
    if (err.status >= 500) log('error', err.message, { requestId, code: err.code })
    const body: ApiErrorBody = { error: { code: err.code, message: err.message, requestId, params: err.params } }
    return c.json(body, err.status)
  }
  log('error', 'unhandled error', { requestId, path: c.req.path, ...errorFields(err) })
  const body: ApiErrorBody = { error: { code: 'internal', message: 'Something went wrong', requestId } }
  return c.json(body, 500)
})

export async function scheduled(env: Env, waitUntil: (p: Promise<unknown>) => void) {
  const db = getDb(env.DB)
  await sweepStuckJobs(env, waitUntil)
  await db.delete(sessions).where(lt(sessions.expiresAt, Date.now()))
  await db.run(sql`delete from rate_limits where reset_at < ${Date.now()}`)
  await alertUsage({ db, env, waitUntil })
}
