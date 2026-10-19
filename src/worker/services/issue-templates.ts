import { and, eq, isNull, or } from 'drizzle-orm'
import type { Ctx } from '../context'
import { isAdmin, requireScope } from '../context'
import { issueTemplates } from '../db/schema'
import { newId } from '../lib/crypto'
import { notFound } from '../lib/errors'
import { access, need } from './projects'

export type TemplateScope = 'user' | 'project' | 'global'
export type IssueTemplate = typeof issueTemplates.$inferSelect

/**
 * Templates usable when creating an issue in `key`: the caller's own, the project's and the
 * site-wide ones. `defaultId` follows personal > project > global.
 */
export async function listTemplates(ctx: Ctx, key?: string) {
  const projectId = key ? (await access(ctx, { key })).project.id : null
  const rows = await ctx.db
    .select()
    .from(issueTemplates)
    .where(
      or(
        and(eq(issueTemplates.scope, 'user'), eq(issueTemplates.ownerId, ctx.user.id)),
        projectId ? and(eq(issueTemplates.scope, 'project'), eq(issueTemplates.projectId, projectId)) : undefined,
        and(eq(issueTemplates.scope, 'global'), isNull(issueTemplates.projectId)),
      ),
    )
    .orderBy(issueTemplates.name)
    .all()
  const rank: Record<TemplateScope, number> = { user: 0, project: 1, global: 2 }
  const def = rows.filter((r) => r.isDefault).sort((a, b) => rank[a.scope] - rank[b.scope])[0]
  return { items: rows, defaultId: def?.id ?? null }
}

/** Who may change a template: its owner (personal), project owners (project), site admins (global). */
async function assertCanEdit(ctx: Ctx, t: Pick<IssueTemplate, 'scope' | 'ownerId' | 'projectId'>) {
  if (t.scope === 'user' && t.ownerId !== ctx.user.id) throw notFound()
  if (t.scope === 'global' && !isAdmin(ctx.user)) throw notFound()
  if (t.scope === 'project') need((await access(ctx, { id: t.projectId! })).role, 'owner')
}

export async function saveTemplate(ctx: Ctx, input: { id?: string; scope: TemplateScope; key?: string; name: string; body: string; isDefault: boolean }) {
  requireScope(ctx, 'write')
  const projectId = input.scope === 'project' ? (await access(ctx, { key: input.key ?? '' })).project.id : null
  const next = { scope: input.scope, ownerId: input.scope === 'user' ? ctx.user.id : null, projectId }
  await assertCanEdit(ctx, next)
  const id = input.id ?? newId()
  if (input.id) {
    const cur = await ctx.db.select().from(issueTemplates).where(eq(issueTemplates.id, input.id)).get()
    if (!cur) throw notFound()
    await assertCanEdit(ctx, cur)
  }
  // Only one default per owner/project/site.
  const sameGroup = and(
    eq(issueTemplates.scope, input.scope),
    input.scope === 'user' ? eq(issueTemplates.ownerId, ctx.user.id) : input.scope === 'project' ? eq(issueTemplates.projectId, projectId!) : isNull(issueTemplates.projectId),
  )
  const row = { id, ...next, name: input.name, body: input.body, isDefault: input.isDefault, createdAt: Date.now() }
  const write = input.id
    ? ctx.db.update(issueTemplates).set({ name: input.name, body: input.body, isDefault: input.isDefault }).where(eq(issueTemplates.id, id))
    : ctx.db.insert(issueTemplates).values(row)
  if (input.isDefault) await ctx.db.batch([ctx.db.update(issueTemplates).set({ isDefault: false }).where(sameGroup), write])
  else await write
  return row
}

export async function deleteTemplate(ctx: Ctx, id: string) {
  requireScope(ctx, 'write')
  const cur = await ctx.db.select().from(issueTemplates).where(eq(issueTemplates.id, id)).get()
  if (!cur) throw notFound()
  await assertCanEdit(ctx, cur)
  await ctx.db.delete(issueTemplates).where(eq(issueTemplates.id, id))
}
