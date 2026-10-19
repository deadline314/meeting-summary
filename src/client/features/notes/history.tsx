import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { diffLines } from 'diff'
import { History, RotateCcw } from 'lucide-react'
import { motion } from 'motion/react'
import { api, queryClient } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { UserAvatar, UserName } from '../../ui/avatar'
import { Button } from '../../ui/button'
import { cx } from '../../ui/cx'
import { Dialog, confirm } from '../../ui/dialog'
import { EmptyState, Skeleton } from '../../ui/misc'
import { toast, toastError } from '../../ui/toast'

type VersionRow = { id: string; authorId: string; startedAt: number; endedAt: number; inserted: number; deleted: number; restoredFrom: string | null }

export function HistoryPanel({ noteId, onOpen }: { noteId: string; onOpen(id: string): void }) {
  const { t, fmt } = useI18n()
  const q = useInfiniteQuery({
    queryKey: ['note-versions', noteId],
    queryFn: ({ pageParam }) => api<{ items: VersionRow[]; nextBefore: number | null }>(`/api/notes/${noteId}/versions?${pageParam ? `before=${pageParam}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (p) => p.nextBefore ?? undefined,
    refetchInterval: 30_000,
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isPending)
    return (
      <div className="flex flex-col gap-2 p-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    )
  if (!items.length) return <EmptyState icon={<History />} title={t('history.empty')} hint={t('history.emptyHint')} />
  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 pt-2 pb-6">
      <ol className="relative flex flex-col">
        <span className="absolute top-3 bottom-3 left-[19px] w-px bg-line" aria-hidden />
        {items.map((v, i) => (
          <motion.li key={v.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.02, 0.2) }}>
            <button onClick={() => onOpen(v.id)} className="relative flex w-full items-start gap-3 rounded-xl px-1.5 py-2.5 text-left transition-colors hover:bg-surface-2">
              <UserAvatar id={v.authorId} size="md" className="relative" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm">
                  <UserName id={v.authorId} className="truncate font-medium" />
                  {v.restoredFrom === 'created' ? (
                    <span className="rounded bg-accent-soft px-1.5 text-[10px] font-semibold text-accent-text">{t('history.created')}</span>
                  ) : (
                    v.restoredFrom && <span className="rounded bg-info-soft px-1.5 text-[10px] font-semibold text-info">{t('history.restoredFrom')}</span>
                  )}
                </div>
                <div className="text-xs text-fg-4" title={fmt.dateTime(v.endedAt)}>
                  {fmt.dateTime(v.endedAt)}
                </div>
              </div>
              {v.restoredFrom !== 'created' && (
                <span className="mt-0.5 shrink-0 font-mono text-xs">
                  <span className="text-success">+{v.inserted}</span> <span className="text-danger">−{v.deleted}</span>
                </span>
              )}
            </button>
          </motion.li>
        ))}
      </ol>
      {q.hasNextPage && (
        <Button size="sm" className="mt-2 self-center" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
          {t('common.loadMore')}
        </Button>
      )}
    </div>
  )
}

type Version = VersionRow & { content: string; previous: string }

export function VersionDialog({ noteId, versionId, canEdit, onClose }: { noteId: string; versionId: string; canEdit: boolean; onClose(): void }) {
  const { t, fmt } = useI18n()
  const q = useQuery({ queryKey: ['note-version', noteId, versionId], queryFn: () => api<{ version: Version }>(`/api/notes/${noteId}/versions/${versionId}`) })
  const v = q.data?.version
  const parts = v ? diffLines(v.previous, v.content) : []
  const changed = parts.some((p) => p.added || p.removed)
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={t('history.diffTitle')}
      description={
        v && (
          <span className="flex items-center gap-2">
            <UserAvatar id={v.authorId} size="xs" />
            <UserName id={v.authorId} /> · {fmt.dateTime(v.endedAt)} · {t('history.changes', { ins: v.inserted, del: v.deleted })}
          </span>
        )
      }
      footer={
        canEdit && v ? (
          <Button
            variant="primary"
            icon={<RotateCcw className="size-4" />}
            onClick={async () => {
              if (!(await confirm({ title: t('history.restore'), body: t('history.restoreConfirm') }))) return
              try {
                await api(`/api/notes/${noteId}/versions/${versionId}/restore`, { method: 'POST' })
                toast(t('history.restored'))
                queryClient.invalidateQueries({ queryKey: ['note-versions', noteId] })
                onClose()
              } catch (err) {
                toastError(err)
              }
            }}
          >
            {t('history.restore')}
          </Button>
        ) : undefined
      }
    >
      {q.isPending ? (
        <Skeleton className="h-64" />
      ) : !changed ? (
        <div className="py-10 text-center text-sm text-fg-4">{t('history.noChange')}</div>
      ) : (
        <pre className="overflow-x-auto rounded-xl border border-line bg-canvas p-3 font-mono text-[12.5px] leading-6 whitespace-pre-wrap">
          {parts.map((p, i) => {
            if (!p.added && !p.removed) {
              // Collapse long unchanged stretches to their edges.
              const lines = p.value.split('\n')
              const text = lines.length > 7 ? [...lines.slice(0, 3), '…', ...lines.slice(-3)].join('\n') : p.value
              return (
                <span key={i} className="text-fg-4">
                  {text}
                </span>
              )
            }
            return (
              <span key={i} className={cx('block rounded', p.added ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger line-through decoration-1')}>
                {p.value}
              </span>
            )
          })}
        </pre>
      )}
    </Dialog>
  )
}
