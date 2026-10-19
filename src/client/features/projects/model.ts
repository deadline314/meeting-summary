import { queryOptions, useQuery } from '@tanstack/react-query'
import { api, queryClient } from '../../lib/api'

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

export type ProjectDetail = Omit<ProjectRow, 'memberCount' | 'openIssues'> & { members: { userId: string; role: 'viewer' | 'member' | 'owner' }[] }

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
  blockedBy: { ref: string; title: string }[]
  parent: { ref: string; title: string } | null
  subProgress: { done: number; total: number } | null
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

export const patchIssue = (i: Pick<IssueRow, 'ref' | 'version'>, patch: IssuePatch) =>
  api<{ issue: IssueRow }>(`/api/issues/${i.ref}`, { method: 'PATCH', body: { version: i.version, ...patch } })

/** Remembers the list a detail page was opened from, for prev/next and returning to the same row. */
const NAV_KEY = 'ms.issue-nav'
export function rememberNav(refs: string[], from: string) {
  try {
    sessionStorage.setItem(NAV_KEY, JSON.stringify({ refs, from }))
  } catch {
    /* ignore */
  }
}
export function readNav(): { refs: string[]; from: string } | null {
  try {
    return JSON.parse(sessionStorage.getItem(NAV_KEY) ?? 'null')
  } catch {
    return null
  }
}
