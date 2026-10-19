import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { Ctx } from '../context'
import { isAdmin, requireScope } from '../context'
import { issueAssignees, issues, labels, projectMembers, projects, users } from '../db/schema'
import { newId } from '../lib/crypto'
import { AppError, conflict, notFound } from '../lib/errors'
import { activity } from './activity'

export type Project = typeof projects.$inferSelect
export type ProjectRole = 'viewer' | 'member' | 'owner'
/** Effective role: membership, or `admin` for site admins viewing a shared project. */
export type Access = ProjectRole | 'admin'

/**
 * Projects the caller may see: their own memberships, plus — for site admins — every
 * shared project (≥ 2 members) not hidden from admins. Cross-project queries always
 * start from this set instead of filtering afterwards.
 */
export async function visibleProjectIds(ctx: Pick<Ctx, 'db' | 'user' | 'apiKey'>): Promise<string[]> {
  const admin = isAdmin(ctx.user) ? 1 : 0
  const rows = await ctx.db.all<{ id: string }>(sql`
    select p.id from projects p
    where exists (select 1 from project_members m where m.project_id = p.id and m.user_id = ${ctx.user.id})
       or (${admin} = 1 and p.hidden_from_admins = 0
           and (select count(*) from project_members m2 where m2.project_id = p.id) >= 2)`)
  const ids = rows.map((r) => r.id)
  const limit = ctx.apiKey?.projectIds
  return limit ? ids.filter((id) => limit.includes(id)) : ids
}

async function memberRole(ctx: Ctx, projectId: string) {
  const m = await ctx.db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, ctx.user.id)))
    .get()
  return m?.role ?? null
}

/** Loads a project with the caller's access, or 404 (never reveals existence). */
export async function access(ctx: Ctx, by: { key?: string; id?: string }): Promise<{ project: Project; role: Access }> {
  const p = await ctx.db
    .select()
    .from(projects)
    .where(by.key ? eq(projects.key, by.key.toUpperCase()) : eq(projects.id, by.id!))
    .get()
  if (!p) throw notFound()
  if (ctx.apiKey?.projectIds && !ctx.apiKey.projectIds.includes(p.id)) throw notFound()
  const role = await memberRole(ctx, p.id)
  if (role) return { project: p, role }
  if (isAdmin(ctx.user) && !p.hiddenFromAdmins && (await memberCount(ctx, p.id)) >= 2) return { project: p, role: 'admin' }
  throw notFound()
}

const RANK: Record<Access, number> = { viewer: 0, member: 1, owner: 2, admin: 2 }

/** Permission check after visibility: still 404 so a viewer can't probe for more. */
export function need(role: Access, min: ProjectRole) {
  if (RANK[role] < RANK[min]) throw notFound()
}

/** Writes to issues etc. are refused once a project is closed or archived. Check *after* permissions. */
export function requireActive(p: Project) {
  if (p.state !== 'active') throw new AppError('project_inactive', 422, 'Project is closed or archived')
}

async function memberCount(ctx: Ctx, projectId: string) {
  const r = await ctx.db.select({ n: sql<number>`count(*)` }).from(projectMembers).where(eq(projectMembers.projectId, projectId)).get()
  return r?.n ?? 0
}

export async function projectDto(ctx: Ctx, p: Project, role: Access) {
  const members = await ctx.db
    .select({ userId: projectMembers.userId, role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, p.id))
    .orderBy(asc(projectMembers.createdAt))
    .all()
  return { ...p, role, members, private: members.length <= 1 }
}

const KEY_RE = /^[A-Z]{2,6}$/

export async function createProject(ctx: Ctx, input: { key: string; name: string; description?: string; parentId?: string | null; targetDate?: number | null }) {
  requireScope(ctx, 'manage')
  const key = input.key.toUpperCase()
  if (!KEY_RE.test(key)) throw new AppError('validation', 400, 'Key must be 2–6 letters', { field: 'key' })
  if (input.parentId) await access(ctx, { id: input.parentId })
  const taken = await ctx.db.select({ id: projects.id }).from(projects).where(eq(projects.key, key)).get()
  if (taken) throw new AppError('key_taken', 409, 'Key already in use')
  const now = Date.now()
  const p: Project = {
    id: newId(),
    key,
    name: input.name,
    description: input.description ?? '',
    parentId: input.parentId ?? null,
    reviewerId: null,
    targetDate: input.targetDate ?? null,
    state: 'active',
    hiddenFromAdmins: false,
    issueSeq: 0,
    createdBy: ctx.user.id,
    createdAt: now,
    updatedAt: now,
    version: 1,
  }
  await ctx.db.batch([
    ctx.db.insert(projects).values(p),
    ctx.db.insert(projectMembers).values({ projectId: p.id, userId: ctx.user.id, role: 'owner', createdAt: now }),
    activity(ctx, { entityType: 'project', entityId: p.id, action: 'created', data: { key, name: p.name }, projectId: p.id }),
  ])
  return p
}

/** Sidebar listing: my projects, other shared projects (admins), closed, archived. */
export async function listProjects(ctx: Ctx) {
  const ids = await visibleProjectIds(ctx)
  if (!ids.length) return []
  const rows = await ctx.db.select().from(projects).where(inArray(projects.id, ids)).orderBy(asc(projects.key)).all()
  const members = await ctx.db.select().from(projectMembers).where(inArray(projectMembers.projectId, ids)).all()
  const open = await ctx.db
    .select({ projectId: issues.projectId, n: sql<number>`count(*)` })
    .from(issues)
    .where(and(inArray(issues.projectId, ids), sql`${issues.status} not in ('done','canceled')`, sql`${issues.deletedAt} is null`))
    .groupBy(issues.projectId)
    .all()
  const openBy = new Map(open.map((o) => [o.projectId, o.n]))
  return rows.map((p) => {
    const ms = members.filter((m) => m.projectId === p.id)
    const mine = ms.find((m) => m.userId === ctx.user.id)
    return { ...p, role: (mine?.role ?? 'admin') as Access, memberCount: ms.length, private: ms.length <= 1, openIssues: openBy.get(p.id) ?? 0 }
  })
}

export async function updateProject(
  ctx: Ctx,
  key: string,
  version: number | undefined,
  patch: Partial<Pick<Project, 'name' | 'description' | 'reviewerId' | 'targetDate' | 'hiddenFromAdmins' | 'parentId'>>,
) {
  requireScope(ctx, 'manage')
  const { project: p, role } = await access(ctx, { key })
  need(role, 'owner')
  // Only an owning member can hide the project from admins.
  if (patch.hiddenFromAdmins !== undefined && role !== 'owner') throw notFound()
  if (patch.parentId) {
    if (patch.parentId === p.id) throw new AppError('cycle', 422, 'A project cannot be its own parent')
    await access(ctx, { id: patch.parentId })
  }
  const v = version ?? p.version
  const res = await ctx.db.batch([
    ctx.db
      .update(projects)
      .set({ ...patch, updatedAt: Date.now(), version: p.version + 1 })
      .where(and(eq(projects.id, p.id), eq(projects.version, v))),
    activity(ctx, { entityType: 'project', entityId: p.id, action: 'updated', data: { key: p.key, fields: Object.keys(patch).join(',') }, projectId: p.id }),
  ])
  if (res[0].meta.changes === 0) throw conflict()
  return { ...p, ...patch, version: p.version + 1 }
}

// ---------- members ----------

export async function addMember(ctx: Ctx, key: string, userId: string, role: ProjectRole) {
  requireScope(ctx, 'manage')
  const { project: p, role: mine } = await access(ctx, { key })
  need(mine, 'owner')
  const u = await ctx.db.select().from(users).where(and(eq(users.id, userId), eq(users.status, 'active'))).get()
  if (!u) throw notFound()
  const before = await memberCount(ctx, p.id)
  await ctx.db.batch([
    ctx.db
      .insert(projectMembers)
      .values({ projectId: p.id, userId, role, createdAt: Date.now() })
      .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role } }),
    activity(ctx, { entityType: 'project', entityId: p.id, action: 'member_added', data: { key: p.key, userId, role }, projectId: p.id }),
  ])
  return { becameShared: before <= 1 && (await memberCount(ctx, p.id)) >= 2 }
}

export async function setMemberRole(ctx: Ctx, key: string, userId: string, role: ProjectRole) {
  requireScope(ctx, 'manage')
  const { project: p, role: mine } = await access(ctx, { key })
  need(mine, 'owner')
  const target = await ctx.db.select().from(projectMembers).where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, userId))).get()
  if (!target) throw notFound()
  if (target.role === 'owner' && role !== 'owner') await assertNotLastOwner(ctx, p.id)
  await ctx.db.batch([
    ctx.db.update(projectMembers).set({ role }).where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, userId))),
    activity(ctx, { entityType: 'project', entityId: p.id, action: 'member_role', data: { key: p.key, userId, from: target.role, to: role }, projectId: p.id }),
  ])
}

async function assertNotLastOwner(ctx: Ctx, projectId: string) {
  const r = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'owner')))
    .get()
  if ((r?.n ?? 0) <= 1) throw new AppError('last_owner', 422, 'The last owner cannot be demoted or removed')
}

/** Removing a member also drops their assignments and reviewer role in the project. */
export async function removeMember(ctx: Ctx, key: string, userId: string) {
  requireScope(ctx, 'manage')
  const { project: p, role: mine } = await access(ctx, { key })
  if (userId !== ctx.user.id) need(mine, 'owner')
  const target = await ctx.db.select().from(projectMembers).where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, userId))).get()
  if (!target) throw notFound()
  if (target.role === 'owner') await assertNotLastOwner(ctx, p.id)
  const issueIds = ctx.db.select({ id: issues.id }).from(issues).where(eq(issues.projectId, p.id))
  await ctx.db.batch([
    ctx.db.delete(projectMembers).where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, userId))),
    ctx.db.delete(issueAssignees).where(and(eq(issueAssignees.userId, userId), inArray(issueAssignees.issueId, issueIds))),
    ...(p.reviewerId === userId ? [ctx.db.update(projects).set({ reviewerId: null }).where(eq(projects.id, p.id))] : []),
    activity(ctx, { entityType: 'project', entityId: p.id, action: 'member_removed', data: { key: p.key, userId }, projectId: p.id }),
  ])
}

/** Can this user see the project? (before assigning or @-mentioning them) */
export async function userCanSee(ctx: Ctx, projectId: string, userId: string) {
  const m = await ctx.db.select().from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId))).get()
  if (m) return true
  const u = await ctx.db.select().from(users).where(eq(users.id, userId)).get()
  if (!u || u.status !== 'active' || !isAdmin(u)) return false
  const p = await ctx.db.select().from(projects).where(eq(projects.id, projectId)).get()
  return !!p && !p.hiddenFromAdmins && (await memberCount(ctx, projectId)) >= 2
}

// ---------- lifecycle ----------

export async function setProjectState(ctx: Ctx, key: string, action: 'close' | 'reopen' | 'archive' | 'restore') {
  requireScope(ctx, 'manage')
  const { project: p, role } = await access(ctx, { key })
  // Closing: reviewer, owner, or admin. Everything else: owner/admin.
  const allowed = role === 'owner' || role === 'admin' || (action === 'close' && p.reviewerId === ctx.user.id)
  if (!allowed) throw notFound()
  const from = p.state
  const to = { close: 'closed', reopen: 'active', archive: 'archived', restore: 'closed' }[action] as Project['state']
  const ok = { close: from === 'active', reopen: from === 'closed', archive: from !== 'archived', restore: from === 'archived' }[action]
  if (!ok) throw new AppError('bad_request', 422, `Cannot ${action} a ${from} project`)
  await ctx.db.batch([
    ctx.db.update(projects).set({ state: to, updatedAt: Date.now(), version: p.version + 1 }).where(eq(projects.id, p.id)),
    activity(ctx, { entityType: 'project', entityId: p.id, action: `state_${action}`, data: { key: p.key, from, to }, projectId: p.id }),
  ])
  return { ...p, state: to }
}

/** Permanent delete: archived first, and the caller must type the key. */
export async function deleteProject(ctx: Ctx, key: string, confirmKey: string) {
  requireScope(ctx, 'manage')
  const { project: p, role } = await access(ctx, { key })
  need(role, 'owner')
  if (p.state !== 'archived') throw new AppError('bad_request', 422, 'Archive the project first')
  if (confirmKey.toUpperCase() !== p.key) throw new AppError('validation', 400, 'Key does not match', { field: 'confirmKey' })
  const issueIds = ctx.db.select({ id: issues.id }).from(issues).where(eq(issues.projectId, p.id))
  await ctx.db.batch([
    ctx.db.delete(issueAssignees).where(inArray(issueAssignees.issueId, issueIds)),
    ctx.db.delete(issues).where(eq(issues.projectId, p.id)),
    ctx.db.delete(labels).where(eq(labels.projectId, p.id)),
    ctx.db.delete(projectMembers).where(eq(projectMembers.projectId, p.id)),
    ctx.db.delete(projects).where(eq(projects.id, p.id)),
    activity(ctx, { entityType: 'project', entityId: p.id, action: 'deleted', data: { key: p.key, name: p.name } }),
  ])
}

// ---------- labels ----------

export async function listLabels(ctx: Ctx, key: string) {
  const { project: p } = await access(ctx, { key })
  return ctx.db.select().from(labels).where(eq(labels.projectId, p.id)).orderBy(asc(labels.name)).all()
}

export async function upsertLabel(ctx: Ctx, key: string, input: { id?: string; name: string; color: number }) {
  requireScope(ctx, 'write')
  const { project: p, role } = await access(ctx, { key })
  need(role, 'owner')
  const dup = await ctx.db
    .select()
    .from(labels)
    .where(and(eq(labels.projectId, p.id), eq(labels.name, input.name), input.id ? ne(labels.id, input.id) : undefined))
    .get()
  if (dup) throw new AppError('key_taken', 409, 'Label exists')
  if (input.id) {
    await ctx.db.update(labels).set({ name: input.name, color: input.color }).where(and(eq(labels.id, input.id), eq(labels.projectId, p.id)))
    return { id: input.id, projectId: p.id, ...input }
  }
  const row = { id: newId(), projectId: p.id, name: input.name, color: input.color }
  await ctx.db.insert(labels).values(row)
  return row
}

export async function deleteLabel(ctx: Ctx, key: string, labelId: string) {
  requireScope(ctx, 'write')
  const { project: p, role } = await access(ctx, { key })
  need(role, 'owner')
  await ctx.db.delete(labels).where(and(eq(labels.id, labelId), eq(labels.projectId, p.id)))
}
