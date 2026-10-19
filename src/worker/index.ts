import { app, scheduled } from './app'
import { errorFields, log } from './lib/log'

export { DocRoom } from './do/doc-room'

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(scheduled(env).catch((err) => log('error', 'scheduled job failed', errorFields(err))))
  },
} satisfies ExportedHandler<Env>
