import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { api } from '../../lib/api'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { Card, Skeleton } from '../../ui/misc'
import { Tooltip } from '../../ui/tooltip'
import { IssueStatusIcon } from './icons'

type Summary = { avg: number; median: number; n: number } | null
type Stats = {
  total: number
  sampled: number
  lead: Summary
  cycle: Summary
  statuses: { status: string; avg?: number; median?: number; n?: number }[]
  weeks: { start: number; done: number }[]
}

const DAY = 86400_000

export function ProjectStats({ projectKey }: { projectKey: string }) {
  const { t, fmt } = useI18n()
  const q = useQuery({ queryKey: ['stats', projectKey], queryFn: () => api<Stats>(`/api/projects/${projectKey}/stats`) })
  if (q.isPending) return <Skeleton className="m-4 h-72" />
  if (q.isError) throw q.error
  const s = q.data
  const days = (ms: number) => (ms >= DAY ? t('tl.days', { n: Math.round((ms / DAY) * 10) / 10 }) : t('tl.hours', { n: Math.max(1, Math.round(ms / 3600_000)) }))
  const maxStatus = Math.max(1, ...s.statuses.map((x) => x.avg ?? 0))
  const maxWeek = Math.max(1, ...s.weeks.map((w) => w.done))
  const metric = (title: string, hint: string, v: Summary) => (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-fg-4">{hint}</div>
      </div>
      {v ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-fg-4">{t('stats.avg')}</div>
            <div className="text-2xl font-bold tracking-tight tabular-nums">{days(v.avg)}</div>
          </div>
          <div>
            <div className="text-xs text-fg-4">{t('stats.median')}</div>
            <div className="text-2xl font-bold tracking-tight tabular-nums">{days(v.median)}</div>
          </div>
          <div className="col-span-2 text-xs text-fg-4">{t('stats.samples', { n: v.n })}</div>
        </div>
      ) : (
        <div className="py-3 text-sm text-fg-4">{t('stats.none')}</div>
      )}
    </Card>
  )
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {s.total > s.sampled && <p className="text-xs text-warning">{t('stats.sampled', { n: s.sampled })}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {metric(t('stats.lead'), t('stats.leadHint'), s.lead)}
        {metric(t('stats.cycle'), t('stats.cycleHint'), s.cycle)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 text-sm font-semibold">{t('stats.inStatus')}</div>
          <ul className="flex flex-col gap-2.5">
            {s.statuses.map((x) => (
              <li key={x.status} className="grid grid-cols-[6.5rem_1fr_4rem] items-center gap-2 text-[13px]">
                <span className="flex items-center gap-1.5 truncate">
                  <IssueStatusIcon status={x.status} />
                  {t(`status.${x.status}` as MsgKey)}
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <motion.span className="block h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${((x.avg ?? 0) / maxStatus) * 100}%` }} transition={{ duration: 0.25 }} />
                </span>
                <span className="text-right text-xs text-fg-3 tabular-nums">{x.avg ? days(x.avg) : '—'}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-4">
          <div className="mb-3 text-sm font-semibold">{t('stats.weekly')}</div>
          <div className="flex h-36 items-end gap-1">
            {s.weeks.map((w) => (
              <Tooltip key={w.start} label={t('stats.weekOf', { date: fmt.day(w.start), n: w.done })}>
                <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[10px] text-fg-4 tabular-nums">{w.done || ''}</span>
                  <motion.span className="w-full rounded-t-md bg-success" initial={{ height: 0 }} animate={{ height: `${(w.done / maxWeek) * 100}%` }} style={{ minHeight: w.done ? 4 : 1 }} transition={{ duration: 0.25 }} />
                </div>
              </Tooltip>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-fg-4">
            <span>{fmt.day(s.weeks[0]!.start)}</span>
            <span>{fmt.day(s.weeks[s.weeks.length - 1]!.start)}</span>
          </div>
        </Card>
      </div>
    </div>
  )
}
