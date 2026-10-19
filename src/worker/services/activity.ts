import { and, desc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm'
import type { Ctx } from '../context'
import { activities } from '../db/schema'
import { newId } from '../lib/crypto'

type Activity = {
  entityType: string
  entityId: string
  action: string
  data?: Record<string, unknown>
  projectId?: string | null
}

/** Returns an insert to put in the same `db.batch` as the change it records (D1 batches are atomic). */
export function activity(ctx: Pick<Ctx, 'db' | 'user' | 'source'>, a: Activity, at = Date.now()) {
  return ctx.db.insert(activities).values({
    id: newId(),
    actorId: ctx.user.id,
    entityType: a.entityType,
    entityId: a.entityId,
    action: a.action,
    data: a.data ?? {},
    source: ctx.source,
    projectId: a.projectId ?? null,
    createdAt: at,
  })
}

export type ActivityQuery = { actorId?: string; entityType?: string; from?: number; to?: number; before?: number; limit: number }

/** Newest-first activity stream. Rows tied to a project are only returned for projects in `visibleProjectIds`. */
export async function listActivity(ctx: Ctx, q: ActivityQuery, visibleProjectIds: string[]) {
  const rows = await ctx.db
    .select()
    .from(activities)
    .where(
      and(
        q.actorId ? eq(activities.actorId, q.actorId) : undefined,
        q.entityType ? eq(activities.entityType, q.entityType) : undefined,
        q.before ? lt(activities.createdAt, q.before) : undefined,
        q.from ? gte(activities.createdAt, q.from) : undefined,
        q.to ? lt(activities.createdAt, q.to) : undefined,
        visibleProjectIds.length ? or(isNull(activities.projectId), inArray(activities.projectId, visibleProjectIds)) : isNull(activities.projectId),
      ),
    )
    .orderBy(desc(activities.createdAt))
    .limit(q.limit + 1)
    .all()
  const more = rows.length > q.limit
  const items = rows.slice(0, q.limit)
  return { items, nextBefore: more ? items[items.length - 1]!.createdAt : null }
}
