import { useQuery } from '@tanstack/react-query'
import { useTour } from '../../app/tour'
import { Link, useNavigate } from '@tanstack/react-router'
import { CalendarClock, CheckSquare, Plus } from 'lucide-react'
import { motion } from 'motion/react'
import { useActions } from '../../lib/actions'
import { api } from '../../lib/api'
import { useNow } from '../../lib/hooks'
import { useI18n } from '../../lib/i18n'
import { isAdminRole, useMe } from '../../lib/session'
import { Button } from '../../ui/button'
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '../../ui/misc'
import { toastError } from '../../ui/toast'
import type { Task } from './model'
import { SubmissionBadge } from './status'

export function TasksPage() {
  useTour('tasks')
  const { t } = useI18n()
  const me = useMe()
  const admin = isAdminRole(me.role)
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['tasks'], queryFn: async () => (await api<{ items: Task[] }>('/api/tasks')).items })
  const create = async () => {
    try {
      const r = await api<{ task: Task }>('/api/tasks', { method: 'POST', body: { title: t('tasks.new') } })
      navigate({ to: `/tasks/${r.task.id}`, search: { tab: 'settings' } })
    } catch (err) {
      toastError(err)
    }
  }
  useActions(admin ? [{ id: 'tasks-new', label: 'tasks.new', keys: 'c', icon: <Plus />, group: 'group.create', run: create }] : [])
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader
        title={t('tasks.title')}
        subtitle={t('tasks.subtitle')}
        actions={
          admin && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={create}>
              {t('tasks.new')}
            </Button>
          )
        }
      />
      {q.isPending ? (
        <div data-tour="tasks-list" className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : !q.data?.length ? (
        <Card>
          <EmptyState
            icon={<CheckSquare />}
            title={t('tasks.empty')}
            hint={admin ? t('tasks.emptyAdmin') : t('tasks.emptyHint')}
            action={
              admin && (
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={create}>
                  {t('tasks.new')}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {q.data.map((task, i) => (
            <motion.div key={task.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.3) }}>
              <TaskCard task={task} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

function TaskCard({ task }: { task: Task }) {
  const { t, fmt } = useI18n()
  const now = useNow(60_000)
  const notOpen = task.opensAt && task.opensAt > now
  const closed = task.dueAt && task.dueAt <= now
  const left = task.dueAt && task.dueAt > now ? task.dueAt - now : null
  return (
    <Link
      to={`/tasks/${task.id}`}
      className="group flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card"
    >
      <div className="flex items-start gap-2">
        <h3 className="flex-1 font-semibold group-hover:text-accent-text">{task.title}</h3>
        {task.status !== 'published' ? (
          <Badge tone="neutral">{t(`tasks.status.${task.status}`)}</Badge>
        ) : notOpen ? (
          <Badge tone="info">{t('tasks.notOpen')}</Badge>
        ) : closed ? (
          <Badge>{t('tasks.closed')}</Badge>
        ) : (
          <Badge tone="success">{t('tasks.open')}</Badge>
        )}
      </div>
      <p className="line-clamp-2 text-sm text-fg-3">{task.description.replace(/[#*`>[\]()!-]/g, '').slice(0, 160)}</p>
      <div className="mt-auto flex items-center justify-between gap-2 text-xs text-fg-4">
        <span className="flex items-center gap-1.5">
          <CalendarClock className="size-3.5" />
          {task.dueAt ? (left && left < 3 * 86400_000 ? <span className="font-medium text-warning">{t('tasks.dueIn', { time: duration(left, fmt) })}</span> : t('tasks.due', { time: fmt.dateTime(task.dueAt) })) : t('tasks.noDue')}
        </span>
        <SubmissionBadge status={task.best?.status ?? null} score={task.best?.score} />
      </div>
    </Link>
  )
}

export function duration(ms: number, fmt: { number(n: number): string }) {
  const h = Math.floor(ms / 3600_000)
  if (h >= 24) return `${fmt.number(Math.floor(h / 24))}d ${h % 24}h`
  const m = Math.floor((ms % 3600_000) / 60_000)
  return h ? `${h}h ${m}m` : `${m}m`
}
