import { queryOptions, useQuery } from '@tanstack/react-query'
import { api, queryClient } from '../../lib/api'
import type { MsgKey } from '../../lib/i18n'
import { confirm } from '../../ui/dialog'

export const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'] as const
export const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const
export type Status = (typeof STATUSES)[number]
export type Priority = (typeof PRIORITIES)[number]
export type Access = 'viewer' | 'member' | 'owner' | 'admin'
export const isDone = (s: string) => s === 'done' || s === 'canceled'

export type ProjectRow = {
  id: string
  key: string
  name: string
  description: string
  parentId: string | null
  reviewerId: string | null
  targetDate: number | null
  state: 'active' | 'closed' | 'archived'
  hiddenFromAdmins: boolean
  role: Access
  memberCount: number
  private: boolean
  openIssues: number
  staleDays: number
  version: number
}

export type ProjectRole = 'viewer' | 'member' | 'owner'
export type ProjectDetail = Omit<ProjectRow, 'memberCount' | 'openIssues'> & {
  members: { userId: string; role: ProjectRole }[]
  /** Visible ancestors, root first. */
  ancestors: { key: string; name: string }[]
  /** Visible sub-projects. */
  children: { key: string; name: string; state: ProjectRow['state']; openIssues: number; private: boolean; hiddenFromAdmins: boolean }[]
}
export const MAX_PROJECT_DEPTH = 5

export type Label = { id: string; name: string; color: number }

export type IssueRow = {
  id: string
  ref: string
  projectId: string
  projectKey: string
  number: number
  title: string
  description: string
  status: Status
  priority: Priority
  sortOrder: number
  parentId: string | null
  dueAt: number | null
  createdBy: string
  createdAt: number
  updatedAt: number
  statusChangedAt: number
  version: number
  assigneeIds: string[]
  labels: Label[]
  /** Unfinished issues blocking this one (only the ones the viewer can see)… */
  blockedBy: { ref: string; title: string }[]
  /** …plus how many more sit in projects the viewer can't see. */
  hiddenBlockers: number
  /** Unfinished issues this one blocks. */
  blocks: { ref: string; title: string }[]
  parent: { ref: string; title: string } | null
  subProgress: { done: number; total: number } | null
}

/** Children of each project id (null = top level), from the flat sidebar list. */
export function childrenMap(list: Pick<ProjectRow, 'id' | 'parentId'>[]) {
  const ids = new Set(list.map((p) => p.id))
  const m = new Map<string | null, string[]>()
  // A parent the viewer can't see counts as top level.
  for (const p of list) {
    const k = p.parentId && ids.has(p.parentId) ? p.parentId : null
    m.set(k, [...(m.get(k) ?? []), p.id])
  }
  return m
}

/** Depth-first order (parents before their sub-projects, siblings by key) with each one's depth. */
export function treeOrder<T extends Pick<ProjectRow, 'id' | 'parentId' | 'key'>>(list: T[]) {
  const kids = childrenMap(list)
  const by = new Map(list.map((p) => [p.id, p]))
  const out: { p: T; depth: number }[] = []
  const walk = (ids: string[], depth: number) => {
    for (const p of ids.map((id) => by.get(id)!).sort((a, b) => a.key.localeCompare(b.key))) {
      out.push({ p, depth })
      if (depth < 20) walk(kids.get(p.id) ?? [], depth + 1)
    }
  }
  walk(kids.get(null) ?? [], 0)
  return out
}

/** `id` and everything under it. */
export function subtreeIds(list: Pick<ProjectRow, 'id' | 'parentId'>[], id: string) {
  const kids = childrenMap(list)
  const out = new Set<string>()
  const walk = (x: string) => {
    if (out.has(x)) return
    out.add(x)
    for (const c of kids.get(x) ?? []) walk(c)
  }
  walk(id)
  return out
}

/** Level of a project in the visible tree (top level = 1). */
export function levelOf(list: Pick<ProjectRow, 'id' | 'parentId'>[], id: string) {
  const by = new Map(list.map((p) => [p.id, p]))
  let n = 0
  for (let cur = by.get(id); cur && n < 20; cur = cur.parentId ? by.get(cur.parentId) : undefined) n++
  return n
}

export const canWrite = (r: Access | undefined) => r === 'member' || r === 'owner' || r === 'admin'
export const canManage = (r: Access | undefined) => r === 'owner' || r === 'admin'

export const projectsQuery = queryOptions({
  queryKey: ['projects'],
  queryFn: async () => (await api<{ items: ProjectRow[] }>('/api/projects')).items,
  staleTime: 30_000,
})

export const useProjects = () => useQuery(projectsQuery)

export function useProject(key: string) {
  return useQuery({ queryKey: ['project', key], queryFn: async () => (await api<{ project: ProjectDetail }>(`/api/projects/${key}`)).project })
}

export function useLabels(key: string | undefined) {
  return useQuery({
    queryKey: ['labels', key],
    queryFn: async () => (await api<{ items: Label[] }>(`/api/projects/${key}/labels`)).items,
    enabled: !!key,
  })
}

/** Everything that shows issues refetches after a write. */
export function invalidateIssues() {
  queryClient.invalidateQueries({ queryKey: ['issues'] })
  queryClient.invalidateQueries({ queryKey: ['issue'] })
  queryClient.invalidateQueries({ queryKey: ['counts'] })
  queryClient.invalidateQueries({ queryKey: ['projects'] })
  queryClient.invalidateQueries({ queryKey: ['home'] })
}

export type IssuePatch = Partial<{ title: string; description: string; status: Status; priority: Priority; assigneeIds: string[]; labelIds: string[]; dueAt: number | null; parentRef: string | null }>

const STARTED: Status[] = ['in_progress', 'in_review', 'done']

/**
 * Moving a still-blocked issue forward (in progress, in review, done) asks first and names the
 * blockers; it is allowed, just never by accident. Resolves true when the change may go ahead.
 */
export async function confirmBlocked(rows: Pick<IssueRow, 'ref' | 'status' | 'blockedBy' | 'hiddenBlockers'>[], to: Status | undefined, t: (k: MsgKey, p?: Record<string, string | number>) => string) {
  if (!to || !STARTED.includes(to)) return true
  const blocked = rows.filter((r) => r.status !== to && !isDone(r.status) && r.blockedBy.length + r.hiddenBlockers > 0)
  if (!blocked.length) return true
  const names = [...new Set(blocked.flatMap((r) => r.blockedBy.map((b) => `${b.ref} ${b.title}`)))]
  const hidden = blocked.reduce((n, r) => n + r.hiddenBlockers, 0)
  return confirm({
    title: blocked.length === 1 ? t('pm.block.confirmTitle', { ref: blocked[0]!.ref }) : t('pm.block.confirmTitleN', { n: blocked.length }),
    body: [t('pm.block.confirmBody', { to: t(`status.${to}` as MsgKey) }), ...names.slice(0, 8), ...(hidden ? [t('pm.block.hidden', { n: hidden })] : [])].join('\n'),
    confirmLabel: t('pm.block.confirmGo'),
  })
}

export const patchIssue = (i: Pick<IssueRow, 'ref' | 'version'>, patch: IssuePatch) =>
  api<{ issue: IssueRow }>(`/api/issues/${i.ref}`, { method: 'PATCH', body: { version: i.version, ...patch, operationId: crypto.randomUUID() } })

/** Remembers the list a detail page was opened from, for prev/next and returning to the same row. */
const NAV_KEY = 'ms.issue-nav'
export function rememberNav(refs: string[], from: string) {
  try {
    sessionStorage.setItem(NAV_KEY, JSON.stringify({ refs, from }))
  } catch {
    /* ignore */
  }
}
/** Marks the issue being viewed so the list can select it again on the way back. */
export function rememberLast(ref: string) {
  const n = readNav()
  if (!n) return
  try {
    sessionStorage.setItem(NAV_KEY, JSON.stringify({ ...n, last: ref }))
  } catch {
    /* ignore */
  }
}
export function readNav(): { refs: string[]; from: string; last?: string } | null {
  try {
    return JSON.parse(sessionStorage.getItem(NAV_KEY) ?? 'null')
  } catch {
    return null
  }
}
