import { sql } from 'drizzle-orm'
import type { Ctx } from '../context'
import { isAdmin } from '../context'

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
