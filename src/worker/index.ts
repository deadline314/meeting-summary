import { app, scheduled } from './app'
import { getDb } from './db'
import { countRequest } from './services/site'
import { errorFields, log } from './lib/log'

export { DocRoom } from './do/doc-room'

const SWEEP_EVERY = 5 * 60_000
// ponytail: per-isolate throttle instead of a cron trigger (the free plan allows only 5 crons per account
// and they are taken). Sweeps only happen while there is traffic, which is when stuck jobs matter.
let lastSweep = 0

const runSweep = (env: Env, ctx: ExecutionContext) =>
  ctx.waitUntil(scheduled(env, (p) => ctx.waitUntil(p)).catch((err) => log('error', 'scheduled job failed', errorFields(err))))

export default {
  fetch(req, env, ctx) {
    const now = Date.now()
    if (now - lastSweep > SWEEP_EVERY) {
      lastSweep = now
      runSweep(env, ctx)
    }
    countRequest(getDb(env.DB), (p) => ctx.waitUntil(p), now)
    return app.fetch(req, env, ctx)
  },
  async scheduled(_event, env, ctx) {
    runSweep(env, ctx)
  },
} satisfies ExportedHandler<Env>
