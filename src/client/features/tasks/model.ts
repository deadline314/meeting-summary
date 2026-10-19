import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useI18n, type MsgKey } from '../../lib/i18n'

export type Task = {
  id: string
  title: string
  description: string
  status: 'draft' | 'published' | 'archived'
  opensAt: number | null
  dueAt: number | null
  projectId: string | null
  submitKind: 'file' | 'code'
  accept: string
  maxBytes: number
  dailyLimit: number
  leaderboard: boolean
  higherIsBetter: boolean
  image: string
  timeoutSec: number
  memoryMb: number
  trialPassedAt: number | null
  createdBy: string
  createdAt: number
  updatedAt: number
  version: number
  open: boolean
  canManage: boolean
  // admin only
  graderFileId?: string | null
  dataFileId?: string | null
  requirements?: string
  best?: { status: string; score: number | null } | null
}

export type Submission = {
  id: string
  taskId: string
  userId: string
  fileId: string
  isTrial: boolean
  status: 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'timeout'
  score: number | null
  message: string | null
  details: { name: string; passed: boolean; message?: string }[] | null
  log: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
}

export const pending = (s: Pick<Submission, 'status'>) => s.status === 'queued' || s.status === 'running'

export function useTask(id: string) {
  return useQuery({ queryKey: ['task', id], queryFn: async () => (await api<{ task: Task }>(`/api/tasks/${id}`)).task })
}

/** Polls every 2s while any submission is still being graded. */
/** Newest `limit` submissions plus the total (lists grow with "show more"). Polls while any is being graded. */
export function useSubmissions(taskId: string, o: { all?: boolean; trial?: boolean; limit?: number } = {}) {
  const qs = new URLSearchParams({ ...(o.all && { all: '1' }), ...(o.trial !== undefined && { trial: o.trial ? '1' : '0' }), limit: String(o.limit ?? 50) })
  return useQuery({
    queryKey: ['submissions', taskId, qs.toString()],
    queryFn: () => api<{ items: Submission[]; total: number }>(`/api/tasks/${taskId}/submissions?${qs}`),
    refetchInterval: (q) => (q.state.data?.items.some(pending) ? 2000 : false),
    placeholderData: (prev) => prev,
  })
}

/** Platform/runner messages are `@key[:n]`; teacher messages are shown as written. */
export function useResultMessage() {
  const { t } = useI18n()
  return (m: string | null) => {
    if (!m) return ''
    if (!m.startsWith('@')) return m
    const [key, n] = m.slice(1).split(':')
    return t(key as MsgKey, { n: n ?? '' })
  }
}
