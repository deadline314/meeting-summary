import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Database, Gauge, HardDrive, PlayCircle } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { api } from '../../lib/api'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { Avatar } from '../../ui/avatar'
import { cx } from '../../ui/cx'
import { Card, Skeleton } from '../../ui/misc'

type Meter = { used: number; limit: number; pct: number }
export type Usage = {
  storage: Meter
  database: Meter
  requests: Meter
  grading: { runs: number; ms: number }
  topStorage: { userId: string; name: string; bytes: number }[]
  warn: string[]
}

export const usageQuery = { queryKey: ['admin-usage'], queryFn: () => api<Usage>('/api/admin/usage'), staleTime: 60_000 }

function MeterCard({ icon, title, value, m }: { icon: ReactNode; title: string; value: string; m: Meter }) {
  const { t } = useI18n()
  const tone = m.pct >= 80 ? 'bg-danger' : m.pct >= 60 ? 'bg-warning' : 'bg-accent'
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4 [&_svg]:text-fg-3">
        {icon}
        {title}
        <span className={cx('ml-auto text-xs font-medium tabular-nums', m.pct >= 80 ? 'text-danger' : 'text-fg-3')}>{t('usage.pct', { n: m.pct })}</span>
      </div>
      <div className="text-xl font-bold tracking-tight tabular-nums">{value}</div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <motion.div className={cx('h-full rounded-full', tone)} initial={{ width: 0 }} animate={{ width: `${Math.min(100, Math.max(m.pct, 0.5))}%` }} transition={{ duration: 0.25 }} />
      </div>
    </Card>
  )
}

/** Free-plan usage at a glance; anything at 80% or more turns red and is listed on top. */
export function UsagePanel() {
  const { t, fmt } = useI18n()
  const q = useQuery(usageQuery)
  if (q.isPending) return <Skeleton className="h-72" />
  if (q.isError) throw q.error
  const u = q.data
  return (
    <div className="flex flex-col gap-4">
      {u.warn.length > 0 && <UsageWarning warn={u.warn} />}
      <div className="grid gap-4 md:grid-cols-3">
        <MeterCard icon={<HardDrive />} title={t('usage.storage')} value={`${fmt.bytes(u.storage.used)} / ${fmt.bytes(u.storage.limit)}`} m={u.storage} />
        <MeterCard icon={<Database />} title={t('usage.database')} value={`${fmt.bytes(u.database.used)} / ${fmt.bytes(u.database.limit)}`} m={u.database} />
        <MeterCard icon={<Gauge />} title={t('usage.requests')} value={`${fmt.number(u.requests.used)} / ${fmt.number(u.requests.limit)}`} m={u.requests} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4 [&_svg]:text-fg-3">
            <PlayCircle />
            {t('usage.grading')}
          </div>
          <div className="flex items-baseline gap-4">
            <span className="text-xl font-bold tabular-nums">{t('usage.runs', { n: fmt.number(u.grading.runs) })}</span>
            <span className="text-sm text-fg-3 tabular-nums">{t('usage.minutes', { n: fmt.number(Math.round(u.grading.ms / 60_000)) })}</span>
          </div>
          <p className="text-xs text-fg-4">{t('usage.gradingFree')}</p>
        </Card>
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold">{t('usage.topStorage')}</div>
          {u.topStorage.length ? (
            <ol className="flex flex-col gap-1.5">
              {u.topStorage.map((r) => (
                <li key={r.userId} className="flex items-center gap-2 text-sm">
                  <Avatar id={r.userId} name={r.name} size="xs" />
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="text-xs text-fg-3 tabular-nums">{fmt.bytes(r.bytes)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-fg-4">{t('usage.noFiles')}</p>
          )}
        </Card>
      </div>
      <p className="text-xs text-fg-4">{t('usage.hint')}</p>
    </div>
  )
}

export function UsageWarning({ warn }: { warn: string[] }) {
  const { t } = useI18n()
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{t('usage.warn', { items: warn.map((w) => t(`usage.${w}` as MsgKey)).join('、') })}</span>
    </div>
  )
}
