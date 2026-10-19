import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, CheckSquare, FileText, FolderKanban } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { api } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { useMe } from '../../lib/session'
import { AvatarStack } from '../../ui/avatar'
import { Button } from '../../ui/button'
import { Card, EmptyState, Skeleton } from '../../ui/misc'
import { SubmissionBadge } from '../tasks/status'
import { IssueStatusIcon } from '../projects/icons'

type HomeData = {
  notes: { id: string; title: string; startsAt: number; attendeeIds: string[]; openComments: number }[]
  tasks: { id: string; title: string; dueAt: number | null; best: { status: string; score: number | null } | null }[]
  issues: { id: string; ref: string; title: string; status: string; projectKey: string }[]
}

export function HomePage() {
  const me = useMe()
  const { t, fmt } = useI18n()
  const q = useQuery({ queryKey: ['home'], queryFn: () => api<HomeData>('/api/home') })
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('home.greeting', { name: me.name })}</h1>
        <p className="mt-1 text-sm text-fg-3">{t('home.subtitle')}</p>
      </motion.div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Section i={0} title={t('home.recentNotes')} icon={<FileText />} to="/notes">
          {q.isPending ? (
            <Rows />
          ) : q.data?.notes.length ? (
            q.data.notes.map((n) => (
              <Link key={n.id} to={`/notes/${n.id}`} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{n.title}</div>
                  <div className="text-xs text-fg-4">{fmt.date(n.startsAt)}</div>
                </div>
                <AvatarStack ids={n.attendeeIds} max={3} size="xs" />
              </Link>
            ))
          ) : (
            <EmptyState
              title={t('home.emptyNotes')}
              action={
                <Button asChild size="sm" variant="primary">
                  <Link to="/notes" search={{ create: true }}>
                    {t('home.emptyNotesCta')}
                  </Link>
                </Button>
              }
            />
          )}
        </Section>
        <Section i={1} title={t('home.activeTasks')} icon={<CheckSquare />} to="/tasks">
          {q.isPending ? (
            <Rows />
          ) : q.data?.tasks.length ? (
            q.data.tasks.map((x) => (
              <Link key={x.id} to={`/tasks/${x.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{x.title}</div>
                  {x.dueAt && <div className="text-xs text-fg-4">{fmt.dateTime(x.dueAt)}</div>}
                </div>
                <SubmissionBadge status={x.best?.status ?? null} score={x.best?.score ?? null} />
              </Link>
            ))
          ) : (
            <EmptyState title={t('home.emptyTasks')} />
          )}
        </Section>
        <Section i={2} title={t('home.myIssues')} icon={<FolderKanban />} to="/projects">
          {q.isPending ? (
            <Rows />
          ) : q.data?.issues.length ? (
            q.data.issues.map((x) => (
              <Link key={x.id} to={`/projects/${x.projectKey}/${x.ref}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2">
                <IssueStatusIcon status={x.status} />
                <span className="shrink-0 font-mono text-xs text-fg-4">{x.ref}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{x.title}</span>
              </Link>
            ))
          ) : (
            <EmptyState
              title={t('home.emptyIssues')}
              action={
                <Button asChild size="sm">
                  <Link to="/projects">{t('home.emptyIssuesCta')}</Link>
                </Button>
              }
            />
          )}
        </Section>
      </div>
    </div>
  )
}

function Section({ i, title, icon, to, children }: { i: number; title: string; icon: ReactNode; to: string; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}>
      <Card className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-accent-soft text-accent-text [&_svg]:size-4">{icon}</span>
          <h2 className="flex-1 text-sm font-semibold">{title}</h2>
          <Link to={to} className="group flex items-center gap-1 text-xs text-fg-4 hover:text-accent-text">
            {t('common.viewAll')} <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div className="flex flex-1 flex-col p-1.5 pt-0">{children}</div>
      </Card>
    </motion.div>
  )
}

const Rows = () => (
  <div className="flex flex-col gap-2 p-2">
    {Array.from({ length: 3 }, (_, i) => (
      <Skeleton key={i} className="h-11" />
    ))}
  </div>
)
