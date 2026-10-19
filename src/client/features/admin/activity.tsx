import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Activity } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../lib/api'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { useDirectory } from '../../lib/session'
import { UserAvatar } from '../../ui/avatar'
import { Button } from '../../ui/button'
import { Select } from '../../ui/field'
import { Card, EmptyState, Skeleton } from '../../ui/misc'

export type ActivityRow = {
  id: string
  actorId: string | null
  entityType: string
  entityId: string
  action: string
  data: Record<string, unknown>
  source: 'web' | 'mcp' | 'system'
  projectId: string | null
  createdAt: number
}

const TYPES = ['user', 'note', 'task', 'submission', 'project', 'issue'] as const

/** Href for the thing an activity is about; null when there is nothing to open. */
export function activityHref(a: ActivityRow): string | null {
  switch (a.entityType) {
    case 'note':
      return `/notes/${a.entityId}${a.data.versionId ? `?tab=history&version=${a.data.versionId}` : ''}`
    case 'task':
      return `/tasks/${a.entityId}`
    case 'submission':
      return typeof a.data.taskId === 'string' ? `/tasks/${a.data.taskId}?tab=submissions` : null
    case 'issue':
      return typeof a.data.ref === 'string' ? `/projects/${String(a.data.ref).split('-')[0]}/${a.data.ref}` : null
    case 'project':
      return typeof a.data.key === 'string' ? `/projects/${a.data.key}` : null
    default:
      return null
  }
}

export function useActivityText() {
  const { t } = useI18n()
  const dir = useDirectory()
  const name = (id: unknown) => (typeof id === 'string' ? dir.get(id)?.name : undefined) ?? t('common.unknownUser')
  return (a: ActivityRow) => {
    const key = `activity.${a.entityType}.${a.action}${a.action === 'role_changed' && a.data.via === 'key' ? '_key' : ''}` as MsgKey
    const params: Record<string, string | number> = { actor: name(a.actorId), target: name(a.entityId) }
    for (const [k, v] of Object.entries(a.data)) {
      if (typeof v === 'string' || typeof v === 'number') params[k] = v
    }
    if (a.action === 'role_changed') {
      params.from = t(`role.${a.data.from as 'student'}`)
      params.to = t(`role.${a.data.to as 'student'}`)
    }
    if (a.action === 'status_changed') {
      params.from = t(`status.${a.data.from as 'active'}`)
      params.to = t(`status.${a.data.to as 'active'}`)
    }
    const text = t(key, params)
    return text === key ? `${params.actor} · ${a.entityType}.${a.action}` : text
  }
}

export function ActivityFeed({ actorId: fixedActor }: { actorId?: string }) {
  const { t, fmt } = useI18n()
  const dir = useDirectory()
  const [actorId, setActor] = useState(fixedActor ?? '')
  const [type, setType] = useState('')
  const describe = useActivityText()
  const q = useInfiniteQuery({
    queryKey: ['activity', actorId, type],
    queryFn: ({ pageParam }) =>
      api<{ items: ActivityRow[]; nextBefore: number | null }>(
        `/api/admin/activity?${new URLSearchParams({ ...(actorId && { actorId }), ...(type && { entityType: type }), ...(pageParam && { before: String(pageParam) }) })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (p) => p.nextBefore ?? undefined,
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <div className="flex flex-col gap-4">
      {!fixedActor && (
        <div className="flex flex-wrap gap-2">
          <Select value={actorId} onChange={(e) => setActor(e.target.value)} className="w-auto" aria-label={t('activity.filterMember')}>
            <option value="">{t('activity.allMembers')}</option>
            {[...dir.values()].map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <Select value={type} onChange={(e) => setType(e.target.value)} className="w-auto" aria-label={t('activity.filterType')}>
            <option value="">{t('activity.allTypes')}</option>
            {TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`activity.type.${x}`)}
              </option>
            ))}
          </Select>
        </div>
      )}
      <Card>
        {q.isPending ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<Activity />} title={t('activity.empty')} />
        ) : (
          <ol className="divide-y divide-line">
            {items.map((a) => {
              const href = activityHref(a)
              const body = (
                <div className="flex items-start gap-3 px-4 py-3">
                  {a.actorId ? <UserAvatar id={a.actorId} size="sm" /> : <span className="size-6" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-fg-2">{describe(a)}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-4">
                      <span title={fmt.dateTime(a.createdAt)}>{fmt.relative(a.createdAt)}</span>
                      {a.source !== 'web' && <span className="rounded bg-surface-2 px-1.5 font-mono text-[10px]">{a.source}</span>}
                    </div>
                  </div>
                </div>
              )
              return (
                <li key={a.id} className="transition-colors hover:bg-surface-2/60">
                  {href ? <Link to={href}>{body}</Link> : body}
                </li>
              )
            })}
          </ol>
        )}
      </Card>
      {q.hasNextPage && (
        <Button className="self-center" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
          {t('common.loadMore')}
        </Button>
      )}
    </div>
  )
}
