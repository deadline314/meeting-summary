import { and, eq, lt, or } from 'drizzle-orm'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { getDb, type DB } from '../db'
import { files, submissions, tasks } from '../db/schema'
import { safeEqual } from '../lib/crypto'
import { AppError, notFound } from '../lib/errors'
import { errorFields, log } from '../lib/log'
import { recordResult, type GradeResult } from './tasks'

/*
 * Grading runs outside the Worker. The Worker only queues jobs, hands the runner
 * its inputs, and accepts results. Two runners speak the same protocol:
 *   - GitHub Actions (.github/workflows/grade.yml), authenticated by a GitHub OIDC token
 *     whose repository / workflow / run id must match;
 *   - a local runner for development (scripts/grade.mjs --local), authenticated by
 *     LOCAL_RUNNER_TOKEN and only accepted when GRADER_MODE=local.
 * Nothing secret or student-specific travels through workflow inputs (they are public).
 */

const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com'
const githubJwks = createRemoteJWKSet(new URL(`${GITHUB_ISSUER}/.well-known/jwks`))
export const OIDC_AUDIENCE = 'meeting-summary-grader'
const WORKFLOW_FILE = 'grade.yml'

export type RunnerIdentity = { kind: 'github'; runId: string } | { kind: 'local'; runId: string }

export async function authenticateRunner(env: Env, authorization: string | undefined): Promise<RunnerIdentity> {
  const token = authorization?.replace(/^Bearer\s+/i, '') ?? ''
  if (!token) throw new AppError('unauthenticated', 401, 'Runner token required')
  if (env.GRADER_MODE === 'local') {
    const expected = env.LOCAL_RUNNER_TOKEN ?? ''
    if (expected && safeEqual(token, expected)) return { kind: 'local', runId: 'local' }
  }
  try {
    const { payload } = await jwtVerify(token, githubJwks, { issuer: GITHUB_ISSUER, audience: OIDC_AUDIENCE })
    const repo = String(payload.repository ?? '')
    const workflowRef = String(payload.workflow_ref ?? '')
    if (repo !== env.GITHUB_REPO || !workflowRef.startsWith(`${repo}/.github/workflows/${WORKFLOW_FILE}@`) || payload.event_name !== 'workflow_dispatch') {
      throw new Error(`unexpected claims repo=${repo} workflow=${workflowRef}`)
    }
    return { kind: 'github', runId: String(payload.run_id) }
  } catch (err) {
    log('warn', 'grader token rejected', errorFields(err))
    throw new AppError('unauthenticated', 401, 'Invalid runner token')
  }
}

/** Asks GitHub to start a grading run. Failures leave the job queued; the cron sweep reports them. */
export async function dispatchGrading(env: Env, submissionId: string, origin: string) {
  if (env.GRADER_MODE !== 'github') return // local runner polls
  if (!env.GITHUB_TOKEN) {
    log('warn', 'GITHUB_TOKEN missing; submission stays queued', { submissionId })
    return
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'meeting-summary',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main', inputs: { job: submissionId, site: env.SITE_URL || origin } }),
    })
    if (!res.ok) log('error', 'grading dispatch failed', { submissionId, status: res.status, body: (await res.text()).slice(0, 300) })
  } catch (err) {
    log('error', 'grading dispatch failed', { submissionId, ...errorFields(err) })
  }
}

async function jobFor(db: DB, submissionId: string) {
  const s = await db.select().from(submissions).where(eq(submissions.id, submissionId)).get()
  if (!s) throw notFound()
  const t = await db.select().from(tasks).where(eq(tasks.id, s.taskId)).get()
  if (!t) throw notFound()
  return { s, t }
}

/** Runner claims a queued job (GitHub passes the id from its input; local takes the oldest). */
export async function claim(env: Env, who: RunnerIdentity, submissionId: string | null) {
  const db = getDb(env.DB)
  let id = submissionId
  if (!id) {
    if (who.kind !== 'local') throw new AppError('bad_request', 400, 'job id required')
    const next = await db.select({ id: submissions.id }).from(submissions).where(eq(submissions.status, 'queued')).orderBy(submissions.createdAt).get()
    if (!next) return null
    id = next.id
  }
  const res = await db
    .update(submissions)
    .set({ status: 'running', runId: who.runId, startedAt: Date.now() })
    .where(and(eq(submissions.id, id), eq(submissions.status, 'queued')))
  if (res.meta.changes === 0) throw new AppError('conflict', 409, 'Job is not queued')
  const { s, t } = await jobFor(db, id)
  return {
    id: s.id,
    image: t.image,
    requirements: t.requirements,
    timeoutSec: t.timeoutSec,
    memoryMb: t.memoryMb,
    hasData: !!t.dataFileId,
    hasGrader: !!t.graderFileId,
  }
}

async function assertRunnerOwns(db: DB, who: RunnerIdentity, submissionId: string) {
  const { s, t } = await jobFor(db, submissionId)
  if (s.status !== 'running' || s.runId !== who.runId) throw notFound()
  return { s, t }
}

/** Streams one input of a claimed job: the grader program, hidden data, or the submission. */
export async function jobFile(env: Env, who: RunnerIdentity, submissionId: string, kind: 'grader' | 'data' | 'submission') {
  const db = getDb(env.DB)
  const { s, t } = await assertRunnerOwns(db, who, submissionId)
  const fileId = kind === 'grader' ? t.graderFileId : kind === 'data' ? t.dataFileId : s.fileId
  if (!fileId) throw notFound()
  const f = await db.select().from(files).where(eq(files.id, fileId)).get()
  const obj = f && (await env.FILES.get(f.r2Key))
  if (!f || !obj) throw notFound()
  return new Response(obj.body, { headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(f.name) } })
}

export async function submitResult(env: Env, who: RunnerIdentity, submissionId: string, r: GradeResult, waitUntil: (p: Promise<unknown>) => void) {
  const db = getDb(env.DB)
  await assertRunnerOwns(db, who, submissionId)
  await recordResult({ db, env, waitUntil }, submissionId, r)
}

const QUEUE_LIMIT_MS = 30 * 60_000
const RUN_SLACK_MS = 10 * 60_000

/** Cron: jobs never picked up, or running past their limit, end as timeouts with a reason. */
export async function sweepStuckJobs(env: Env, waitUntil: (p: Promise<unknown>) => void) {
  const db = getDb(env.DB)
  const now = Date.now()
  const stuck = await db
    .select({ s: submissions, timeoutSec: tasks.timeoutSec })
    .from(submissions)
    .innerJoin(tasks, eq(tasks.id, submissions.taskId))
    .where(or(and(eq(submissions.status, 'queued'), lt(submissions.createdAt, now - QUEUE_LIMIT_MS)), eq(submissions.status, 'running')))
    .all()
  for (const { s, timeoutSec } of stuck) {
    const overdue = s.status === 'queued' || (s.startedAt ?? 0) + timeoutSec * 1000 + RUN_SLACK_MS < now
    if (!overdue) continue
    await recordResult({ db, env, waitUntil }, s.id, {
      status: 'timeout',
      score: null,
      details: null,
      log: null,
      message: s.status === 'queued' ? '@grader.neverStarted' : '@grader.noResult',
    })
  }
}
