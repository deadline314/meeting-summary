import { and, eq, gt, inArray, isNull } from 'drizzle-orm'
import type { Ctx } from '../context'
import { notifications, users } from '../db/schema'
import { newId } from '../lib/crypto'
import { errorFields, log } from '../lib/log'

/** Actor id for notifications the platform sends on its own (e.g. grading results). */
export const SYSTEM_ACTOR = 'system'

export type Notice = {
  type: string
  entityType: string
  entityId: string
  data?: Record<string, unknown>
  /** Set for project events so recipients' "project × event" preferences apply. */
  projectId?: string
}

const MERGE_MS = 60_000
// Several changes to one issue within a minute become one notification. Mentions always stand alone.
const MERGEABLE = new Set(['issue_assigned', 'issue_status', 'issue_comment'])

/**
 * Fan-out to recipients after the main write has committed. Never throws: a failed
 * notification must not fail the action that caused it, and recipients are isolated.
 * The actor is never notified about their own action.
 */
export function notify(ctx: Ctx, recipients: Iterable<string>, n: Notice) {
  let to = [...new Set(recipients)].filter((id) => id && id !== ctx.user.id && id !== SYSTEM_ACTOR)
  if (!to.length) return
  const now = Date.now()
  const actorId = ctx.user.id === SYSTEM_ACTOR ? null : ctx.user.id
  const deliver = async (userId: string) => {
    if (MERGEABLE.has(n.type)) {
      const prev = await ctx.db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, userId), eq(notifications.entityType, n.entityType), eq(notifications.entityId, n.entityId), isNull(notifications.readAt), gt(notifications.createdAt, now - MERGE_MS)))
        .get()
      if (prev && MERGEABLE.has(prev.type)) {
        const count = Number(prev.data.count ?? 1) + 1
        await ctx.db.update(notifications).set({ type: n.type, actorId, data: { ...prev.data, ...n.data, count }, createdAt: now }).where(eq(notifications.id, prev.id))
        return
      }
    }
    await ctx.db.insert(notifications).values({ id: newId(), userId, actorId, type: n.type, entityType: n.entityType, entityId: n.entityId, data: n.data ?? {}, createdAt: now })
  }
  ctx.waitUntil(
    (async () => {
      if (n.projectId) {
        const off = `${n.projectId}:${n.type}`
        const rows = await ctx.db.select({ id: users.id, prefs: users.prefs }).from(users).where(inArray(users.id, to)).all()
        const muted = new Set(rows.filter((r) => r.prefs.notifyOff?.includes(off)).map((r) => r.id))
        to = to.filter((id) => !muted.has(id))
      }
      await Promise.all(to.map((userId) => deliver(userId).catch((err) => log('warn', 'notification failed', { userId, type: n.type, ...errorFields(err) }))))
    })().catch((err) => log('warn', 'notification fan-out failed', { type: n.type, ...errorFields(err) })),
  )
}

/** `@[user:id]` mentions in a Markdown body. */
export function mentionedUserIds(body: string) {
  return [...body.matchAll(/@\[user:([\w-]+)\]/g)].map((m) => m[1]!)
}
