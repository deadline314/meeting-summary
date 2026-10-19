import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, CheckSquare, FileText, FolderKanban } from 'lucide-react'
import type { ReactNode } from 'react'
import type { UserDto } from '@shared/types'
import { api } from '../../lib/api'
import { useNow } from '../../lib/hooks'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { Avatar } from '../../ui/avatar'
import { Button } from '../../ui/button'
import { cx } from '../../ui/cx'
import { Badge, Card, EmptyState, Skeleton } from '../../ui/misc'
import { Tooltip } from '../../ui/tooltip'
import { IssueStatusIcon } from '../projects/icons'
import { SubmissionBadge } from '../tasks/status'
import { ActivityFeed } from './activity'

type Overview = {
  user: UserDto
  notes: { id: string; title: string; startsAt: number; edits: number; last: number }[]
  submissions: { id: string; taskId: string; title: string; status: string; score: number | null; createdAt: number }[]
  issues: { ref: string; title: string; status: string; updatedAt: number }[]
  heatmap: { day: number; n: number }[]
}

const DAY = 86400_000
const WEEKS = 12

/** 12 weeks × 7 days, columns are weeks (Monday on top), newest on the right. */
function Heatmap({ data }: { data: Overview['heatmap'] }) {
  const { t, fmt } = useI18n()
  const now = useNow(3600_000)
  const offset = -new Date(now).getTimezoneOffset() * 60_000
  const todayIdx = Math.floor((now + offset) / DAY)
  const counts = new Map(data.map((d) => [d.day, d.n]))
  // Day index 0 (1970-01-01) was a Thursday; shift so weeks start on Monday.
  const weekday = (i: number) => (i + 3) % 7
  const start = todayIdx - weekday(todayIdx) - (WEEKS - 1) * 7
  const max = Math.max(1, ...data.map((d) => d.n))
  const level = (n: number) => (n === 0 ? 'bg-surface-2' : n / max < 0.25 ? 'bg-accent/25' : n / max < 0.5 ? 'bg-accent/50' : n / max < 0.75 ? 'bg-accent/75' : 'bg-accent')
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 overflow-x-auto pb-1">
        {Array.from({ length: WEEKS }, (_, w) => (
          <div key={w} className="flex flex-col gap-1">
            {Array.from({ length: 7 }, (_, d) => {
              const idx = start + w * 7 + d
              if (idx > todayIdx) return <span key={d} className="size-4 md:size-5" />
              const n = counts.get(idx) ?? 0
              return (
                <Tooltip key={d} label={t('member.heatDay', { date: fmt.date(idx * DAY - offset), n })}>
                  <span className={cx('size-4 rounded-[4px] md:size-5', level(n))} />
                </Tooltip>
              )
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1 text-[11px] text-fg-4">
        {t('member.less')}
        {['bg-surface-2', 'bg-accent/25', 'bg-accent/50', 'bg-accent/75', 'bg-accent'].map((c) => (
          <span key={c} className={cx('size-3 rounded-[3px]', c)} />
        ))}
        {t('member.more')}
      </div>
    </div>
  )
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold [&_svg]:size-4 [&_svg]:text-fg-3">
        {icon}
        {title}
      </div>
      {children}
    </Card>
  )
}

export function MemberPage({ id, onBack }: { id: string; onBack(): void }) {
  const { t } = useI18n()
  const q = useQuery({ queryKey: ['member-overview', id], queryFn: () => api<Overview>(`/api/admin/members/${id}/overview?tz=${-new Date().getTimezoneOffset()}`) })
  if (q.isPending) return <Skeleton className="h-96" />
  if (q.isError) throw q.error
  const o = q.data
  const row = 'flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-surface-2'
  return (
    <div className="flex flex-col gap-4">
      <Button size="sm" variant="ghost" className="self-start" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
        {t('admin.members')}
      </Button>
      <div className="flex items-center gap-4">
        <Avatar id={o.user.id} name={o.user.name} src={o.user.avatarUrl} size="lg" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lg font-bold">
            {o.user.name}
            <Badge tone={o.user.role === 'student' ? 'neutral' : 'accent'}>{t(`role.${o.user.role}`)}</Badge>
          </div>
          <div className="truncate text-sm text-fg-4">{o.user.email}</div>
        </div>
      </div>
      <Section icon={null} title={t('member.heatmap')}>
        <Heatmap data={o.heatmap} />
      </Section>
      <div className="grid gap-4 lg:grid-cols-3">
        <Section icon={<FileText />} title={t('member.notes')}>
          {o.notes.length ? (
            o.notes.map((n) => (
              <Link key={n.id} to={`/notes/${n.id}?tab=history`} className={row}>
                <span className="flex-1 truncate">{n.title}</span>
                <span className="shrink-0 text-xs text-fg-4">{t('member.edits', { n: n.edits })}</span>
              </Link>
            ))
          ) : (
            <EmptyState title={t('member.none')} />
          )}
        </Section>
        <Section icon={<CheckSquare />} title={t('member.submissions')}>
          {o.submissions.length ? (
            o.submissions.map((s) => (
              <Link key={s.id} to={`/tasks/${s.taskId}?tab=submit`} className={row}>
                <span className="flex-1 truncate">{s.title}</span>
                <SubmissionBadge status={s.status} score={s.score} />
              </Link>
            ))
          ) : (
            <EmptyState title={t('member.none')} />
          )}
        </Section>
        <Section icon={<FolderKanban />} title={t('member.issues')}>
          {o.issues.length ? (
            o.issues.map((i) => (
              <Link key={i.ref} to={`/projects/${i.ref.split('-')[0]}/${i.ref}`} className={row}>
                <IssueStatusIcon status={i.status} />
                <span className="font-mono text-xs text-fg-4">{i.ref}</span>
                <span className="flex-1 truncate">{i.title}</span>
              </Link>
            ))
          ) : (
            <EmptyState title={t('member.none')} />
          )}
        </Section>
      </div>
      <h2 className="mt-2 text-sm font-semibold">{t(`admin.activity` as MsgKey)}</h2>
      <ActivityFeed actorId={o.user.id} />
    </div>
  )
}
