import { DurableObject } from 'cloudflare:workers'
import { errorFields, log } from '../lib/log'
import { sendDigests } from '../services/email'

/**
 * Single instance that times email digests with an alarm, so mail goes out on time even
 * when nobody is using the site (the request-driven sweep only runs while there is traffic).
 */
export class Outbox extends DurableObject<Env> {
  /** Make sure a run happens no later than `at`. */
  async wake(at: number) {
    const current = await this.ctx.storage.getAlarm()
    if (current == null || current > at) await this.ctx.storage.setAlarm(at)
  }

  async alarm() {
    const next = await sendDigests(this.env).catch((err) => {
      log('error', 'email digests failed', errorFields(err))
      return Date.now() + 15 * 60_000
    })
    if (next) await this.wake(next)
  }
}

export const outbox = (env: Env) => env.OUTBOX.get(env.OUTBOX.idFromName('outbox'))
