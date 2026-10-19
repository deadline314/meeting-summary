import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CalendarClock, Minus, Plus } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useActions } from '../../lib/actions'
import { api } from '../../lib/api'
import { useIsMobile, useNow } from '../../lib/hooks'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { Button, IconButton } from '../../ui/button'
import { cx } from '../../ui/cx'
import { EmptyState, Skeleton } from '../../ui/misc'
import { IssueStatusIcon } from './icons'
import { isDone, type Status } from './model'
import type { Filters } from './issue-views'

type Seg = { status: Status; from: number; to: number | null }
type Row = { ref: string; title: string; status: Status; dueAt: number | null; projectKey: string; createdAt: number; segments: Seg[] }
type Data = { items: Row[]; total: number; projects: { key: string; name: string; targetDate: number | null; state: string }[] }

const DAY = 86400_000
const LEVELS = [
  { id: 'quarter', px: 2, tick: 'month' },
  { id: 'month', px: 7, tick: 'week' },
  { id: 'week', px: 28, tick: 'day' },
  { id: 'day', px: 72, tick: 'day' },
] as const
const MAX = 500
const ROW = 36
const BAR: Record<Status, string> = {
  backlog: 'bg-surface-3',
  todo: 'bg-fg-4/40',
  in_progress: 'bg-warning',
  in_review: 'bg-info',
  done: 'bg-success',
  canceled: 'bg-fg-4/30',
}

const startOfDay = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Tick positions for the header: month starts, Mondays, or every day. */
function ticks(from: number, to: number, unit: 'month' | 'week' | 'day') {
  const out: number[] = []
  const d = new Date(from)
  if (unit === 'month') d.setDate(1)
  if (unit === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  while (d.getTime() <= to) {
    if (d.getTime() >= from) out.push(d.getTime())
    if (unit === 'month') d.setMonth(d.getMonth() + 1)
    else d.setDate(d.getDate() + (unit === 'week' ? 7 : 1))
  }
  return out
}

/**
 * Status-segment chart. Ctrl/⌘+wheel (or pinch) zooms around the pointer through quarter/month/
 * week/day; = and - zoom, T jumps to today. Plain wheel and touch drag scroll natively.
 */
export function IssueTimeline({ scope, filters }: { scope: { key?: string }; filters: Filters }) {
  const { t, fmt } = useI18n()
  const mobile = useIsMobile()
  const now = useNow(60_000)
  const params = new URLSearchParams(Object.entries({ key: scope.key, assigneeId: filters.assigneeId, priority: filters.priority, labelId: filters.labelId, q: filters.q }).filter((e): e is [string, string] => !!e[1]))
  const q = useQuery({ queryKey: ['timeline', params.toString()], queryFn: () => api<Data>(`/api/timeline?${params}`) })
  const [level, setLevel] = useState(1)
  const scroller = useRef<HTMLDivElement>(null)
  // Day under the pointer when zooming, re-applied after the new width renders.
  const anchor = useRef<{ day: number; x: number } | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number; seg: Seg } | null>(null)
  const label = mobile ? 148 : 240

  const range = useMemo(() => {
    const items = q.data?.items ?? []
    const points = [now, ...items.map((i) => i.createdAt), ...items.flatMap((i) => (i.dueAt ? [i.dueAt] : [])), ...(q.data?.projects ?? []).flatMap((p) => (p.targetDate ? [p.targetDate] : []))]
    return { from: startOfDay(Math.min(...points)) - 7 * DAY, to: startOfDay(Math.max(...points)) + 21 * DAY }
  }, [q.data, now])
  const px = LEVELS[level]!.px
  const x = (ms: number) => ((ms - range.from) / DAY) * px
  const width = x(range.to)

  const zoom = (dir: 1 | -1, clientX?: number) => {
    const el = scroller.current
    const next = Math.min(LEVELS.length - 1, Math.max(0, level + dir))
    if (!el || next === level) return
    const rect = el.getBoundingClientRect()
    const cx = clientX === undefined ? (rect.width + label) / 2 : clientX - rect.left
    anchor.current = { day: (el.scrollLeft + cx - label) / px, x: cx }
    setLevel(next)
  }
  const toToday = (smooth = true) => {
    const el = scroller.current
    if (el) el.scrollTo({ left: Math.max(0, x(now) - (el.clientWidth - label) / 2), behavior: smooth ? 'smooth' : 'auto' })
  }
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !anchor.current) return
    el.scrollLeft = anchor.current.day * px + label - anchor.current.x
    anchor.current = null
  }, [px, label])
  // Start centred on today once data arrives.
  const centred = useRef(false)
  useLayoutEffect(() => {
    if (q.data && !centred.current) {
      centred.current = true
      toToday(false)
    }
  })

  // Ctrl/⌘+wheel needs a non-passive listener to stop the browser's page zoom.
  const zoomRef = useRef(zoom)
  useEffect(() => {
    zoomRef.current = zoom
  })
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let pinch: number | null = null
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0]!.clientX - e.touches[1]!.clientX, e.touches[0]!.clientY - e.touches[1]!.clientY)
    const mid = (e: TouchEvent) => (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      if (Math.abs(e.deltaY) > 2) zoomRef.current(e.deltaY < 0 ? 1 : -1, e.clientX)
    }
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = dist(e)
    }
    const onMove = (e: TouchEvent) => {
      if (pinch === null || e.touches.length !== 2) return
      e.preventDefault()
      const r = dist(e) / pinch
      if (r > 1.35 || r < 0.74) {
        zoomRef.current(r > 1 ? 1 : -1, mid(e))
        pinch = dist(e)
      }
    }
    const onEnd = () => (pinch = null)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
    }
  }, [q.isSuccess])

  useActions([
    { id: 'tl-in', label: 'tl.zoomIn', keys: '=', group: 'nav.projects', run: () => zoom(1) },
    { id: 'tl-out', label: 'tl.zoomOut', keys: '-', group: 'nav.projects', run: () => zoom(-1) },
    { id: 'tl-today', label: 'tl.today', keys: 't', group: 'nav.projects', run: () => toToday() },
  ])

  if (q.isPending) return <Skeleton className="m-4 h-72" />
  if (q.isError) throw q.error
  const d = q.data
  if (!d.items.length) return <EmptyState className="py-20" icon={<CalendarClock />} title={t('tl.empty')} hint={t('tl.emptyHint')} />
  const unit = LEVELS[level]!.tick
  const marks = ticks(range.from, range.to, unit)
  const dur = (s: Seg) => {
    const ms = (s.to ?? now) - s.from
    return ms >= DAY ? t('tl.days', { n: Math.round(ms / DAY) }) : t('tl.hours', { n: Math.max(1, Math.round(ms / 3600_000)) })
  }
  const open = new Set(d.items.filter((i) => !isDone(i.status)).map((i) => i.projectKey))

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-fg-4">
        {d.total > MAX && <span className="rounded-full bg-warning-soft px-2.5 py-1 font-medium text-warning">{t('tl.tooMany', { n: MAX, total: d.total })}</span>}
        <span className="flex-1" />
        <span className="hidden md:inline">{t('tl.hint')}</span>
        <IconButton label={t('tl.zoomOut')} shortcut="-" icon={<Minus />} size="sm" disabled={level === 0} onClick={() => zoom(-1)} />
        <span className="w-10 text-center font-medium text-fg-3">{t(`tl.level.${LEVELS[level]!.id}` as MsgKey)}</span>
        <IconButton label={t('tl.zoomIn')} shortcut="=" icon={<Plus />} size="sm" disabled={level === LEVELS.length - 1} onClick={() => zoom(1)} />
        <Button size="sm" variant="secondary" onClick={() => toToday()} title="T">
          {t('tl.today')}
        </Button>
      </div>
      <div ref={scroller} className="relative overflow-auto overscroll-x-contain border-t border-line" style={{ maxHeight: 'calc(100dvh - 15rem)', touchAction: 'pan-x pan-y' }} onMouseLeave={() => setHover(null)}>
        <div className="relative" style={{ width: width + label, minHeight: (d.items.length + 1) * ROW }}>
          {/* Header */}
          <div className="sticky top-0 z-20 flex h-9 border-b border-line bg-surface">
            <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-surface" style={{ width: label }} />
            <div className="relative flex-1">
              {marks.map((m) => (
                <span key={m} className="absolute top-0 flex h-full items-center border-l border-line pl-1.5 text-[11px] whitespace-nowrap text-fg-4" style={{ left: x(m) }}>
                  {/* Week zoom: every day gets a line, only Mondays a label, so labels never overlap. */}
                  {unit === 'month' ? fmt.month(m) : px >= 60 || unit === 'week' || new Date(m).getDay() === 1 ? fmt.day(m) : ''}
                </span>
              ))}
            </div>
          </div>
          {/* Grid, today and target-date lines span every row. */}
          <div className="pointer-events-none absolute top-9 bottom-0" style={{ left: label, width }}>
            {marks.map((m) => (
              <span key={m} className="absolute top-0 bottom-0 border-l border-line/50" style={{ left: x(m) }} />
            ))}
            {d.projects
              .filter((p) => p.targetDate)
              .map((p) => {
                const late = p.targetDate! < now && open.has(p.key)
                return (
                  <span key={p.key} className={cx('absolute top-0 bottom-0 border-l-2 border-dashed', late ? 'border-danger' : 'border-accent/60')} style={{ left: x(p.targetDate!) }}>
                    <span className={cx('absolute top-1 left-1 rounded px-1 text-[10px] font-semibold whitespace-nowrap', late ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent-text')}>
                      {scope.key ? t('tl.target') : p.key} {fmt.day(p.targetDate!)}
                    </span>
                  </span>
                )
              })}
            <span className="absolute top-0 bottom-0 w-0.5 bg-accent" style={{ left: x(now) }} aria-label={t('tl.today')} />
          </div>
          {d.items.map((r) => (
            <div key={r.ref} className="flex border-b border-line/60" style={{ height: ROW }}>
              <Link
                to={`/projects/${r.projectKey}/${r.ref}`}
                className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-surface px-3 text-[13px] hover:bg-surface-2"
                style={{ width: label }}
              >
                <IssueStatusIcon status={r.status} />
                {!mobile && <span className="shrink-0 font-mono text-[11px] text-fg-4">{r.ref}</span>}
                <span className={cx('truncate', r.status === 'canceled' && 'line-through')}>{r.title}</span>
              </Link>
              <div className="relative flex-1">
                {r.segments.map((s, i) => {
                  const left = x(s.from)
                  const w = Math.max(isDone(s.status) ? 6 : 3, x(s.to ?? now) - left)
                  return (
                    <span
                      key={i}
                      className={cx('absolute top-2.5 h-4 rounded-[5px] transition-[left,width] duration-200 motion-reduce:transition-none', BAR[s.status])}
                      style={{ left, width: w }}
                      onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, seg: s })}
                      onClick={(e) => setHover({ x: e.clientX, y: e.clientY, seg: s })}
                    />
                  )
                })}
                {r.dueAt && (
                  <span
                    className={cx('absolute top-1.5 h-6 w-0.5 rounded-full', r.dueAt < now && !isDone(r.status) ? 'bg-danger' : 'bg-fg-3')}
                    style={{ left: x(r.dueAt) }}
                    title={`${t('issue.due')} ${fmt.date(r.dueAt)}`}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {hover && (
        <div className="pointer-events-none fixed z-[70] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-card" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <div className="flex items-center gap-1.5 font-medium">
            <IssueStatusIcon status={hover.seg.status} className="size-3.5" />
            {t(`status.${hover.seg.status}` as MsgKey)} · {dur(hover.seg)}
          </div>
          <div className="text-fg-4">
            {fmt.day(hover.seg.from)} – {hover.seg.to ? fmt.day(hover.seg.to) : t('tl.now')}
          </div>
        </div>
      )}
    </div>
  )
}
