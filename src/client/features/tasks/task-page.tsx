import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, CalendarClock, ChevronDown, Code2, Download, FileUp, ListChecks, Settings2, Trophy, Upload, Users, XCircle, CheckCircle2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useRef, useState, type DragEvent } from 'react'
import { api } from '../../lib/api'
import { useNow } from '../../lib/hooks'
import { useI18n } from '../../lib/i18n'
import { renderMarkdown } from '../../lib/markdown'
import { useMe } from '../../lib/session'
import { fileUrl } from '../../lib/upload'
import { UserAvatar, UserName } from '../../ui/avatar'
import { Button } from '../../ui/button'
import { cx } from '../../ui/cx'
import { Badge, Card, EmptyState, Skeleton } from '../../ui/misc'
import { Segmented, TabBar } from '../../ui/tabs'
import { toast, toastError } from '../../ui/toast'
import { Html } from '../notes/preview'
import { pending, useResultMessage, useSubmissions, useTask, type Submission, type Task } from './model'
import { SubmissionBadge } from './status'
import { TaskSettings } from './task-settings'
import { duration } from './tasks-page'

export type TaskTab = 'overview' | 'submit' | 'leaderboard' | 'manage' | 'settings'

export function TaskPage({ id, tab, onTab }: { id: string; tab?: TaskTab; onTab(t: TaskTab): void }) {
  const q = useTask(id)
  const { t, fmt } = useI18n()
  const now = useNow(60_000)
  if (q.isPending)
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-64" />
      </div>
    )
  if (q.isError) throw q.error
  const task = q.data
  const active: TaskTab = tab ?? (task.canManage && task.status === 'draft' ? 'settings' : 'overview')
  const tabs: { value: TaskTab; label: string; icon: React.ReactNode }[] = [
    { value: 'overview', label: t('tasks.tab.overview'), icon: <ListChecks /> },
    { value: 'submit', label: t('tasks.tab.submit'), icon: <Upload /> },
    ...(task.leaderboard || task.canManage ? [{ value: 'leaderboard' as const, label: t('tasks.tab.leaderboard'), icon: <Trophy /> }] : []),
    ...(task.canManage
      ? [
          { value: 'manage' as const, label: t('tasks.tab.manage'), icon: <Users /> },
          { value: 'settings' as const, label: t('tasks.tab.settings'), icon: <Settings2 /> },
        ]
      : []),
  ]
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">{task.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-fg-3">
            <Badge tone={task.status === 'published' ? (task.open ? 'success' : 'neutral') : 'warning'}>
              {task.status === 'published' ? (task.open ? t('tasks.open') : task.opensAt && task.opensAt > now ? t('tasks.notOpen') : t('tasks.closed')) : t(`tasks.status.${task.status}`)}
            </Badge>
            <span className="flex items-center gap-1.5">
              <CalendarClock className="size-4" />
              {task.dueAt ? `${t('tasks.due', { time: fmt.dateTime(task.dueAt) })}${task.dueAt > now ? ` · ${t('tasks.dueIn', { time: duration(task.dueAt - now, fmt) })}` : ''}` : t('tasks.noDue')}
            </span>
          </div>
        </div>
      </div>
      <TabBar value={active} onChange={onTab} tabs={tabs} />
      <motion.div key={active} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="mt-6">
        {active === 'overview' && <Overview task={task} />}
        {active === 'submit' && <SubmitTab task={task} />}
        {active === 'leaderboard' && <Leaderboard task={task} />}
        {active === 'manage' && task.canManage && <Manage task={task} />}
        {active === 'settings' && task.canManage && <TaskSettings task={task} />}
      </motion.div>
    </div>
  )
}

function Overview({ task }: { task: Task }) {
  const { t } = useI18n()
  return (
    <Card className="p-5 md:p-7">
      {task.description.trim() ? <Html html={renderMarkdown(task.description)} className="prose-md" /> : <EmptyState title={t('common.none')} />}
    </Card>
  )
}

function SubmitTab({ task }: { task: Task }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const subs = useSubmissions(task.id, { trial: false })
  const [mode, setMode] = useState<'file' | 'code'>(task.submitKind)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const now = useNow(60_000)
  const today = (subs.data ?? []).filter((s) => s.createdAt > now - 86400_000).length
  const left = Math.max(0, task.dailyLimit - today)
  const send = async (file: File) => {
    setBusy(true)
    try {
      await api(`/api/tasks/${task.id}/submissions`, {
        method: 'POST',
        raw: file,
        headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
      })
      toast(t('tasks.submit.sent'))
      setCode('')
      qc.invalidateQueries({ queryKey: ['submissions', task.id] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files[0]
    if (f) send(f)
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Card className="flex flex-col gap-4 p-5">
        {!task.open ? (
          <EmptyState icon={<XCircle />} title={t('tasks.submit.closed')} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'file', label: t('tasks.submit.file'), icon: <FileUp /> },
                  { value: 'code', label: t('tasks.submit.code'), icon: <Code2 /> },
                ]}
              />
              <span className="text-xs text-fg-4">{t('tasks.submit.limit', { n: left })}</span>
            </div>
            {mode === 'file' ? (
              <div
                onDragOver={(e) => (e.preventDefault(), setOver(true))}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
                className={cx('flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center text-sm transition-colors', over ? 'border-accent bg-accent-soft' : 'border-line text-fg-3')}
              >
                <Upload className="size-6 text-accent-text" />
                <span>
                  {t('tasks.submit.drop')}{' '}
                  <button className="font-semibold text-accent-text hover:underline" onClick={() => input.current?.click()} disabled={busy || left === 0}>
                    {t('files.browse')}
                  </button>
                </span>
                {task.accept && <span className="text-xs text-fg-4">{t('tasks.submit.accept', { accept: task.accept })}</span>}
                <input ref={input} type="file" hidden accept={task.accept || undefined} onChange={(e) => (e.target.files?.[0] && send(e.target.files[0]), (e.target.value = ''))} />
              </div>
            ) : (
              <>
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t('tasks.submit.codePh')}
                  spellCheck={false}
                  className="min-h-64 w-full rounded-xl border border-line bg-canvas p-3 font-mono text-[13px] leading-relaxed focus:border-accent focus:outline-none"
                />
                <Button variant="primary" loading={busy} disabled={!code.trim() || left === 0} onClick={() => send(new File([code], 'main.py', { type: 'text/x-python' }))} className="self-end">
                  {t('tasks.submit.send')}
                </Button>
              </>
            )}
          </>
        )}
      </Card>
      <History subs={subs.data} loading={subs.isPending} higherIsBetter={task.higherIsBetter} />
    </div>
  )
}

function History({ subs, loading, higherIsBetter }: { subs?: Submission[]; loading: boolean; higherIsBetter: boolean }) {
  const { t } = useI18n()
  if (loading) return <Skeleton className="h-64" />
  if (!subs?.length)
    return (
      <Card>
        <EmptyState icon={<BarChart3 />} title={t('tasks.historyEmpty')} />
      </Card>
    )
  const scored = [...subs].reverse().filter((s) => s.score !== null)
  return (
    <div className="flex flex-col gap-3">
      {scored.length > 1 && (
        <Card className="p-4">
          <div className="mb-2 text-[13px] font-medium text-fg-2">{t('tasks.trend')}</div>
          <Trend values={scored.map((s) => s.score!)} higherIsBetter={higherIsBetter} />
        </Card>
      )}
      <div className="text-[13px] font-medium text-fg-2">{t('tasks.history')}</div>
      <AnimatePresence initial={false}>
        {subs.map((s, i) => (
          <motion.div key={s.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
            <SubmissionCard s={s} n={subs.length - i} prev={subs[i + 1]} defaultOpen={i === 0} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function SubmissionCard({ s, n, prev, defaultOpen, showUser }: { s: Submission; n?: number; prev?: Submission; defaultOpen?: boolean; showUser?: boolean }) {
  const { t, fmt } = useI18n()
  const msg = useResultMessage()
  // The newest card opens by itself once grading finishes; after a click the user decides.
  const [toggled, setOpen] = useState<boolean | null>(null)
  const open = toggled ?? (!!defaultOpen && !pending(s))
  const delta = prev && s.score !== null && prev.score !== null ? s.score - prev.score : null
  return (
    <Card className={cx('overflow-hidden transition-colors', pending(s) && 'border-info')}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        {showUser && <UserAvatar id={s.userId} size="sm" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            {showUser ? <UserName id={s.userId} /> : n !== undefined && t('tasks.attempt', { n })}
            {delta !== null && delta !== 0 && <span className={cx('font-mono text-xs', delta > 0 ? 'text-success' : 'text-danger')}>{delta > 0 ? `+${delta.toFixed(3)}` : delta.toFixed(3)}</span>}
          </div>
          <div className="text-xs text-fg-4">{fmt.dateTime(s.createdAt)}</div>
        </div>
        <SubmissionBadge status={s.status} score={s.score} />
        <ChevronDown className={cx('size-4 text-fg-4 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="flex flex-col gap-3 border-t border-line px-4 py-3 text-sm">
              {s.message && <div className={cx('rounded-xl px-3 py-2', s.status === 'passed' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>{msg(s.message)}</div>}
              {!!s.details?.length && (
                <div>
                  <div className="mb-1.5 text-xs font-medium text-fg-3">{t('tasks.details')}</div>
                  <ul className="flex flex-col gap-1">
                    {s.details.map((d, i) => (
                      <li key={i} className="flex items-start gap-2 text-[13px]">
                        {d.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
                        <span className="font-mono">{d.name}</span>
                        {d.message && <span className="text-fg-3">— {d.message}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {s.log && (
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-fg-3">{t('tasks.log')}</summary>
                  <pre className="mt-1.5 max-h-64 overflow-auto rounded-lg bg-surface-2 p-2 font-mono text-xs whitespace-pre-wrap text-fg-2">{s.log}</pre>
                </details>
              )}
              {showUser && s.fileId && (
                <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} className="self-start" onClick={() => (location.href = `${fileUrl(s.fileId)}?download=1`)}>
                  {t('tasks.manage.download')}
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}

function Trend({ values, higherIsBetter }: { values: number[]; higherIsBetter: boolean }) {
  const w = 320
  const h = 70
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [(i / Math.max(values.length - 1, 1)) * (w - 12) + 6, h - 8 - ((v - min) / span) * (h - 16)] as const)
  const best = higherIsBetter ? max : min
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full" role="img" aria-label="trend">
      <motion.polyline
        points={pts.map((p) => p.join(',')).join(' ')}
        fill="none"
        stroke="var(--t-accent)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6 }}
      />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={values[i] === best ? 4.5 : 3} fill={values[i] === best ? 'var(--t-success)' : 'var(--t-surface)'} stroke="var(--t-accent)" strokeWidth="2" />
      ))}
    </svg>
  )
}

type LbRow = { rank: number; userId: string; score: number | null; createdAt: number; attempts: number }

function Leaderboard({ task }: { task: Task }) {
  const { t, fmt } = useI18n()
  const me = useMe()
  const q = useQuery({ queryKey: ['leaderboard', task.id], queryFn: async () => (await api<{ items: LbRow[] }>(`/api/tasks/${task.id}/leaderboard`)).items, refetchInterval: 15_000 })
  if (!task.leaderboard && !task.canManage) return <EmptyState title={t('tasks.lb.off')} />
  if (q.isPending) return <Skeleton className="h-48" />
  if (!q.data?.length)
    return (
      <Card>
        <EmptyState icon={<Trophy />} title={t('tasks.lb.empty')} />
      </Card>
    )
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-surface-2 text-left text-xs text-fg-3">
          <tr>
            <th className="w-16 px-4 py-2.5 font-medium">{t('tasks.lb.rank')}</th>
            <th className="px-2 py-2.5 font-medium">{t('tasks.lb.member')}</th>
            <th className="px-2 py-2.5 text-right font-medium">{t('tasks.lb.score')}</th>
            <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">{t('tasks.lb.attempts')}</th>
            <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">{t('tasks.lb.when')}</th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((r, i) => (
            <motion.tr key={r.userId} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className={cx('border-b border-line last:border-0', r.userId === me.id && 'bg-accent-soft')}>
              <td className="px-4 py-2.5">
                <span className={cx('inline-flex size-7 items-center justify-center rounded-full text-xs font-bold', r.rank === 1 ? 'bg-warning-soft text-warning' : r.rank <= 3 ? 'bg-surface-3 text-fg-2' : 'text-fg-4')}>{r.rank}</span>
              </td>
              <td className="px-2 py-2.5">
                <span className="flex items-center gap-2">
                  <UserAvatar id={r.userId} size="sm" />
                  <UserName id={r.userId} className="truncate" />
                  {r.userId === me.id && <Badge tone="accent">{t('tasks.lb.you')}</Badge>}
                </span>
              </td>
              <td className="px-2 py-2.5 text-right font-mono font-semibold">{r.score ?? '—'}</td>
              <td className="hidden px-2 py-2.5 text-right text-fg-3 sm:table-cell">{r.attempts}</td>
              <td className="hidden px-4 py-2.5 text-right text-xs text-fg-4 sm:table-cell">{fmt.relative(r.createdAt)}</td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

type Overview = { perUser: { userId: string; best: { status: string; score: number | null } | null; attempts: number }[]; notSubmitted: string[]; reasons: { message: string; count: number }[] }

function Manage({ task }: { task: Task }) {
  const { t } = useI18n()
  const msg = useResultMessage()
  const overview = useQuery({ queryKey: ['task-overview', task.id], queryFn: () => api<Overview>(`/api/tasks/${task.id}/overview`) })
  const all = useSubmissions(task.id, { all: true, trial: false })
  const [view, setView] = useState<'users' | 'all'>('users')
  const maxReason = useMemo(() => Math.max(1, ...(overview.data?.reasons.map((r) => r.count) ?? [1])), [overview.data])
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'users', label: t('tasks.manage.perUser') },
            { value: 'all', label: t('tasks.tab.manage') },
          ]}
        />
        <Button icon={<Download className="size-4" />} onClick={() => (location.href = `/api/tasks/${task.id}/export.csv`)}>
          {t('tasks.manage.export')}
        </Button>
      </div>
      {view === 'users' ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card className="divide-y divide-line">
            {overview.data?.perUser.map((p) => (
              <div key={p.userId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <UserAvatar id={p.userId} size="sm" />
                <UserName id={p.userId} className="flex-1 truncate" />
                <span className="text-xs text-fg-4">{p.attempts}×</span>
                <SubmissionBadge status={p.best?.status ?? null} score={p.best?.score} />
              </div>
            ))}
            {overview.data && !overview.data.perUser.length && <EmptyState title={t('tasks.historyEmpty')} />}
          </Card>
          <div className="flex flex-col gap-5">
            <Card className="p-4">
              <div className="mb-3 text-[13px] font-medium text-fg-2">{t('tasks.manage.reasons')}</div>
              <ul className="flex flex-col gap-2">
                {overview.data?.reasons.map((r) => (
                  <li key={r.message} className="text-xs">
                    <div className="mb-1 flex justify-between gap-2">
                      <span className="truncate text-fg-2">{msg(r.message)}</span>
                      <span className="text-fg-4">{r.count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <motion.div className="h-full bg-danger" initial={{ width: 0 }} animate={{ width: `${(r.count / maxReason) * 100}%` }} />
                    </div>
                  </li>
                ))}
                {overview.data && !overview.data.reasons.length && <li className="text-xs text-fg-4">{t('common.none')}</li>}
              </ul>
            </Card>
            <Card className="p-4">
              <div className="mb-3 text-[13px] font-medium text-fg-2">{t('tasks.manage.notSubmitted', { n: overview.data?.notSubmitted.length ?? 0 })}</div>
              <div className="flex flex-wrap gap-1.5">
                {overview.data?.notSubmitted.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pr-2.5 pl-0.5 text-xs">
                    <UserAvatar id={id} size="xs" />
                    <UserName id={id} />
                  </span>
                ))}
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {all.data?.map((s) => <SubmissionCard key={s.id} s={s} showUser />)}
          {all.data && !all.data.length && <EmptyState title={t('tasks.historyEmpty')} />}
        </div>
      )}
    </div>
  )
}
