#!/usr/bin/env node
// Grading runner. Same protocol in two places:
//   GitHub Actions:  node scripts/grade.mjs --job <submissionId> --site <https://…>   (OIDC auth)
//   Local dev:       node scripts/grade.mjs --local [--site http://localhost:5173]   (polls, LOCAL_RUNNER_TOKEN)
//   Local, no Docker: add --no-docker to run the grader with the host's python. DEV ONLY: there is
//                    no network or filesystem isolation; never use it for real student code.
// Student code runs in Docker with no network, no secrets, and CPU/memory/time limits.
// This runner never prints student code, output or scores: GitHub logs of a public repo are public.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true)]] : acc), []),
)
const local = !!args.local
const noDocker = local && !!args['no-docker']
const PY = process.platform === 'win32' ? 'python' : 'python3'
const site = String(args.site && args.site !== true ? args.site : 'http://localhost:5173').replace(/\/$/, '')
if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(site)) throw new Error('site must be https (or localhost)')
const AUDIENCE = 'meeting-summary-grader'
const LOG_TAIL = 20_000

async function token() {
  if (local) return process.env.LOCAL_RUNNER_TOKEN || 'dev-runner-token'
  const url = `${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${AUDIENCE}`
  const r = await fetch(url, { headers: { authorization: `bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } })
  if (!r.ok) throw new Error(`OIDC token request failed: ${r.status}`)
  return (await r.json()).value
}

async function api(path, init = {}) {
  const r = await fetch(`${site}/api/grader${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!r.ok && r.status !== 404) throw new Error(`${path} → ${r.status}`)
  return r
}

function run(cmd, argv, { timeoutMs, name } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    p.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)))
    let timedOut = false
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true
          if (name) spawn('docker', ['kill', name], { stdio: 'ignore' })
          p.kill('SIGKILL')
        }, timeoutMs)
      : null
    p.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code, timedOut, stderr })
    })
  })
}

async function download(jobId, kind, dir) {
  const r = await api(`/jobs/${jobId}/${kind}`)
  if (r.status === 404) return null
  const name = decodeURIComponent(r.headers.get('x-file-name') ?? kind).replace(/[\\/]/g, '_')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, name), Buffer.from(await r.arrayBuffer()))
  return name
}

async function grade(job) {
  const started = Date.now()
  const work = await mkdtemp(join(tmpdir(), 'grade-'))
  const result = { status: 'error', score: null, message: null, details: null, log: null }
  try {
    const graderName = await download(job.id, 'grader', join(work, 'grader'))
    if (!graderName) {
      result.message = '@grader.noGrader'
      return result
    }
    const subName = await download(job.id, 'submission', join(work, 'submission'))
    const dataName = job.hasData ? await download(job.id, 'data', join(work, 'data')) : null
    await mkdir(join(work, 'out'), { recursive: true })
    await mkdir(join(work, 'data'), { recursive: true })
    await writeFile(join(work, 'requirements.txt'), job.requirements ?? '')
    const entry = graderName.endsWith('.zip') ? 'grader/grade.py' : `grader/${graderName}`
    const unzip = (dir, file) => (file?.endsWith('.zip') ? `python -m zipfile -e "${dir}/${file}" "${dir}" && rm "${dir}/${file}"; ` : '')

    // Phase 1 (network on, no student code executes): unpack archives, install the teacher's requirements.
    const setup = `set -e; cd /work; ${unzip('grader', graderName)}${unzip('submission', subName)}${unzip('data', dataName)}if [ -s requirements.txt ]; then pip install -q --disable-pip-version-check --target /work/.deps -r requirements.txt; fi`
    const p1 = noDocker
      ? await hostSetup(work, { graderName, subName, dataName }, job.requirements)
      : await run('docker', ['run', '--rm', '-v', `${work}:/work`, job.image, 'sh', '-c', setup], { timeoutMs: 10 * 60_000 })
    if (p1.code !== 0) {
      result.message = '@grader.setupFailed'
      result.log = p1.stderr
      return result
    }

    // Phase 2 (no network, limits): run the grader against the submission.
    const name = `grade-${randomUUID().slice(0, 12)}`
    const p2 = noDocker
      ? await hostRun(work, entry, job.timeoutSec * 1000)
      : await run(
      'docker',
      [
        'run', '--rm', '--name', name, '--network', 'none',
        '--memory', `${job.memoryMb}m`, '--memory-swap', `${job.memoryMb}m`, '--cpus', '2', '--pids-limit', '256',
        '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL',
        '-e', 'PYTHONPATH=/work/.deps', '-e', 'PYTHONDONTWRITEBYTECODE=1', '-e', 'PYTHONUTF8=1', '-v', `${work}:/work`, '-w', '/work',
        job.image, 'sh', '-c', `python ${entry} /work/submission /work/data /work/out > /work/out/log.txt 2>&1`,
      ],
      { timeoutMs: job.timeoutSec * 1000, name },
    )
    result.log = await readFile(join(work, 'out', 'log.txt'), 'utf8').then((s) => s.slice(-LOG_TAIL)).catch(() => null)
    if (p2.timedOut) {
      result.status = 'timeout'
      result.message = `@grader.timeout:${job.timeoutSec}`
      return result
    }
    if (p2.code === 137) {
      result.message = `@grader.oom:${job.memoryMb}`
      return result
    }
    let parsed
    try {
      await stat(join(work, 'out', 'result.json'))
      parsed = JSON.parse(await readFile(join(work, 'out', 'result.json'), 'utf8'))
    } catch (err) {
      result.message = err?.code === 'ENOENT' ? `@grader.noResultFile:${p2.code}` : '@grader.badResult'
      return result
    }
    if (typeof parsed?.passed !== 'boolean') {
      result.message = '@grader.badResult'
      return result
    }
    result.status = parsed.passed ? 'passed' : 'failed'
    result.score = typeof parsed.score === 'number' && Number.isFinite(parsed.score) ? parsed.score : null
    result.message = typeof parsed.message === 'string' ? parsed.message : parsed.passed ? null : '@grader.failedNoMessage'
    result.details = Array.isArray(parsed.details)
      ? parsed.details.slice(0, 500).map((d) => ({ name: String(d?.name ?? ''), passed: !!d?.passed, message: d?.message ? String(d.message) : undefined }))
      : null
    return result
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
    console.log(`job ${job.id}: finished in ${Math.round((Date.now() - started) / 1000)}s`)
  }
}

// ---------- --no-docker (dev only) ----------

async function hostSetup(work, names, requirements) {
  for (const [dir, file] of [['grader', names.graderName], ['submission', names.subName], ['data', names.dataName]]) {
    if (!file?.endsWith('.zip')) continue
    const r = await run(PY, ['-m', 'zipfile', '-e', join(work, dir, file), join(work, dir)])
    if (r.code !== 0) return r
    await rm(join(work, dir, file))
  }
  if (requirements?.trim()) return run(PY, ['-m', 'pip', 'install', '-q', '--target', join(work, '.deps'), '-r', join(work, 'requirements.txt')], { timeoutMs: 10 * 60_000 })
  return { code: 0, timedOut: false, stderr: '' }
}

async function hostRun(work, entry, timeoutMs) {
  const { openSync, closeSync } = await import('node:fs')
  const out = openSync(join(work, 'out', 'log.txt'), 'w')
  return new Promise((resolve) => {
    const p = spawn(PY, [join(work, entry), join(work, 'submission'), join(work, 'data'), join(work, 'out')], {
      cwd: work,
      stdio: ['ignore', out, out],
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, PYTHONPATH: join(work, '.deps'), PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      p.kill('SIGKILL')
    }, timeoutMs)
    p.on('close', (code) => {
      clearTimeout(timer)
      closeSync(out)
      resolve({ code, timedOut, stderr: '' })
    })
  })
}

async function once(jobId) {
  const r = await api('/claim', { method: 'POST', body: JSON.stringify({ job: jobId ?? null }) })
  const { job } = await r.json()
  if (!job) return false
  const result = await grade(job)
  await api(`/jobs/${job.id}/result`, { method: 'POST', body: JSON.stringify(result) })
  return true
}

if (local) {
  console.log(`local grader polling ${site}${noDocker ? ' (no Docker: dev only, not isolated)' : ''}`)
  for (;;) {
    try {
      if (!(await once(null))) await new Promise((r) => setTimeout(r, 2000))
    } catch (err) {
      console.error(String(err.message ?? err))
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
} else {
  if (!args.job || args.job === true) throw new Error('--job is required')
  await once(String(args.job))
}
