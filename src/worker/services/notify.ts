import type { Ctx } from '../context'
import { notifications } from '../db/schema'
import { newId } from '../lib/crypto'
import { errorFields, log } from '../lib/log'

export type Notice = {
  type: string
  entityType: string
  entityId: string
  data?: Record<string, unknown>
}

/**
 * Fan-out to recipients after the main write has committed. Never throws: a failed
 * notification must not fail the action that caused it, and recipients are isolated.
 */
export function notify(ctx: Ctx, recipients: Iterable<string>, n: Notice) {
  const to = [...new Set(recipients)].filter((id) => id && id !== ctx.user.id)
  if (!to.length) return
  const now = Date.now()
  ctx.waitUntil(
    Promise.all(
      to.map((userId) =>
        ctx.db
          .insert(notifications)
          .values({ id: newId(), userId, actorId: ctx.user.id, type: n.type, entityType: n.entityType, entityId: n.entityId, data: n.data ?? {}, createdAt: now })
          .run()
          .catch((err) => log('warn', 'notification failed', { userId, type: n.type, ...errorFields(err) })),
      ),
    ),
  )
}

/** `@[user:id]` mentions in a Markdown body. */
export function mentionedUserIds(body: string) {
  return [...body.matchAll(/@\[user:([\w-]+)\]/g)].map((m) => m[1]!)
}
