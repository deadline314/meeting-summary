import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Ctx } from '../context'
import { activities, issueAssignees, issues, notes, projects, submissions, tasks, users } from '../db/schema'
import { notFound } from '../lib/errors'
import { visibleProjectIds } from './projects'
import { requireAdmin } from './site'
import { userDto } from './users'

const DAY = 86400_000

/**
 * Everything one member did, for the admin's member page: notes they edited, submissions with
 * scores, assigned issues and a 12-week activity heatmap. Private projects stay hidden exactly as
 * in the activity feed.
 */
export async function memberOverview(ctx: Ctx, userId: string, tzOffsetMin: number) {
  requireAdmin(ctx)
  const u = await ctx.db.select().from(users).where(eq(users.id, userId)).get()
  if (!u) throw notFound()
  const visible = await visibleProjectIds(ctx)
  const inVisible = (col: typeof activities.projectId | typeof notes.projectId) =>
    visible.length ? or(isNull(col), inArray(col, visible)) : isNull(col)
  const since = Date.now() - 84 * DAY
  const shift = tzOffsetMin * 60_000

  const [noteRows, subs, assigned, heat] = await Promise.all([
    ctx.db
      .select({ id: notes.id, title: notes.title, startsAt: notes.startsAt, edits: sql<number>`count(*)`, last: sql<number>`max(${activities.createdAt})` })
      .from(activities)
      .innerJoin(notes, eq(notes.id, activities.entityId))
      .where(and(eq(activities.actorId, userId), eq(activities.entityType, 'note'), isNull(notes.deletedAt), inVisible(notes.projectId)))
      .groupBy(notes.id)
      .orderBy(desc(sql`max(${activities.createdAt})`))
      .limit(20)
      .all(),
    ctx.db
      .select({ id: submissions.id, taskId: submissions.taskId, title: tasks.title, status: submissions.status, score: submissions.score, isTrial: submissions.isTrial, createdAt: submissions.createdAt })
      .from(submissions)
      .innerJoin(tasks, eq(tasks.id, submissions.taskId))
      .where(and(eq(submissions.userId, userId), eq(submissions.isTrial, false)))
      .orderBy(desc(submissions.createdAt))
      .limit(30)
      .all(),
    visible.length
      ? ctx.db
          .select({ number: issues.number, key: projects.key, title: issues.title, status: issues.status, updatedAt: issues.updatedAt })
          .from(issueAssignees)
          .innerJoin(issues, eq(issues.id, issueAssignees.issueId))
          .innerJoin(projects, eq(projects.id, issues.projectId))
          .where(and(eq(issueAssignees.userId, userId), isNull(issues.deletedAt), inArray(issues.projectId, visible)))
          .orderBy(desc(issues.updatedAt))
          .limit(30)
          .all()
      : [],
    ctx.db
      .select({ day: sql<number>`cast((${activities.createdAt} + ${shift}) / ${DAY} as integer)`, n: sql<number>`count(*)` })
      .from(activities)
      .where(and(eq(activities.actorId, userId), gte(activities.createdAt, since), inVisible(activities.projectId)))
      .groupBy(sql`1`)
      .all(),
  ])
  return {
    user: userDto(u),
    notes: noteRows,
    submissions: subs,
    issues: assigned.map(({ number, key, ...i }) => ({ ...i, ref: `${key}-${number}` })),
    // Day index = days since epoch in the viewer's time zone.
    heatmap: heat.map((h) => ({ day: Number(h.day), n: Number(h.n) })),
  }
}
