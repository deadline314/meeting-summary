import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Bell, CheckCheck } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useState } from 'react'
import { api, queryClient } from '../lib/api'
import { useI18n, type MsgKey } from '../lib/i18n'
import { useDirectory } from '../lib/session'
import { UserAvatar } from '../ui/avatar'
import { Button } from '../ui/button'
import { cx } from '../ui/cx'
import { EmptyState } from '../ui/misc'
import { Tooltip } from '../ui/tooltip'
import { Logo } from './shell'

type Notice = { id: string; actorId: string | null; type: string; entityType: string; entityId: string; data: Record<string, string>; readAt: number | null; createdAt: number }

const query = { queryKey: ['notifications'], queryFn: () => api<{ items: Notice[]; unread: number; unreadIssues: string[] }>('/api/notifications'), refetchInterval: 30_000 }

/** Ids of issues with unread notifications (for the dot in lists). */
export function useUnreadIssues() {
  return new Set(useQuery(query).data?.unreadIssues ?? [])
}

export const markEntityRead = (entityId: string) =>
  api('/api/notifications/read', { method: 'POST', body: { entityId } }).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))

function href(n: Notice) {
  if (n.entityType === 'issue' && n.data.ref) return `/projects/${n.data.ref.split('-')[0]}/${n.data.ref}`
  if (n.entityType === 'note') return `/notes/${n.entityId}?tab=comments`
  if (n.entityType === 'task') return `/tasks/${n.entityId}?tab=submit`
  if (n.entityType === 'site') return '/admin?tab=usage'
  return '/'
}

/** Bell with unread count; opening lists recent notifications, clicking one marks it read and opens it. */
export function NotificationBell({ side = 'bottom' }: { side?: 'bottom' | 'right' }) {
  const { t, fmt } = useI18n()
  const dir = useDirectory()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const q = useQuery(query)
  const unread = q.data?.unread ?? 0
  const read = (ids?: string[]) => api('/api/notifications/read', { method: 'POST', body: { ids } }).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))
  const text = (n: Notice) =>
    t(Number(n.data.count) > 1 ? 'notice.merged' : (`notice.${n.type}` as MsgKey), {
      n: String(n.data.count ?? ''),
      actor: n.actorId ? (dir.get(n.actorId)?.name ?? '') : t('app.name'),
      ref: n.data.ref ?? '',
      title: n.data.title ?? '',
      to: n.data.to ? t(`status.${n.data.to}` as MsgKey) : '',
      status: n.data.status ? t(`submission.${n.data.status}` as MsgKey) : '',
      metric: n.data.metric ? t(`usage.${n.data.metric}` as MsgKey) : '',
      pct: n.data.pct ?? '',
    })
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip label={t('nav.notifications')} side={side}>
        <Popover.Trigger asChild>
          <button
            aria-label={t('nav.notifications')}
            className="relative flex size-10 shrink-0 items-center justify-center rounded-xl text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg-2 [&_svg]:size-[18px]"
          >
            <Bell />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-danger px-1.5 text-center text-[11px] font-bold text-on-status">{unread > 99 ? '99+' : unread}</span>
            )}
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content data-layer align="start" side={side} sideOffset={8} collisionPadding={12} className="anim-pop z-[60] flex max-h-[70vh] w-[min(380px,calc(100vw-24px))] flex-col rounded-2xl border border-line bg-surface shadow-card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-sm font-semibold">{t('nav.notifications')}</span>
            {unread > 0 && (
              <Button size="sm" variant="ghost" icon={<CheckCheck className="size-4" />} onClick={() => read()}>
                {t('notice.readAll')}
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {q.data?.items.length ? (
              q.data.items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.readAt) read([n.id])
                    setOpen(false)
                    navigate({ to: href(n) })
                  }}
                  className={cx('flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-surface-2', !n.readAt && 'bg-accent-soft/50')}
                >
                  {n.actorId ? <UserAvatar id={n.actorId} size="md" /> : <Logo className="size-8" />}
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm text-fg-2">{text(n)}</span>
                    <span className="text-xs text-fg-4">{fmt.relative(n.createdAt)}</span>
                  </span>
                  {!n.readAt && <span className="mt-2 size-2 shrink-0 rounded-full bg-accent" />}
                </button>
              ))
            ) : (
              <EmptyState icon={<Bell />} title={t('notice.empty')} />
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
