import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { api } from '../lib/api'
import { useI18n, type MsgKey } from '../lib/i18n'
import { refreshMe, useMe } from '../lib/session'
import { Button } from '../ui/button'
import { cx } from '../ui/cx'

export type TourId = 'notes' | 'tasks' | 'projects'
type Step = { target?: string; title: MsgKey; body: MsgKey }

/** 3–7 short steps per module; `target` is a `data-tour` value, missing targets centre the card. */
export const TOURS: Record<TourId, Step[]> = {
  notes: [
    { title: 'tour.notes.1.t', body: 'tour.notes.1.b' },
    { target: 'notes-new', title: 'tour.notes.2.t', body: 'tour.notes.2.b' },
    { target: 'notes-view', title: 'tour.notes.3.t', body: 'tour.notes.3.b' },
    { target: 'notes-filters', title: 'tour.notes.4.t', body: 'tour.notes.4.b' },
  ],
  tasks: [
    { title: 'tour.tasks.1.t', body: 'tour.tasks.1.b' },
    { target: 'tasks-list', title: 'tour.tasks.2.t', body: 'tour.tasks.2.b' },
    { title: 'tour.tasks.3.t', body: 'tour.tasks.3.b' },
  ],
  projects: [
    { target: 'pm-nav', title: 'tour.pm.1.t', body: 'tour.pm.1.b' },
    { target: 'pm-new', title: 'tour.pm.2.t', body: 'tour.pm.2.b' },
    { target: 'pm-views', title: 'tour.pm.3.t', body: 'tour.pm.3.b' },
    { title: 'tour.pm.4.t', body: 'tour.pm.4.b' },
    { title: 'tour.pm.5.t', body: 'tour.pm.5.b' },
    { target: 'palette', title: 'tour.pm.6.t', body: 'tour.pm.6.b' },
    { title: 'tour.pm.7.t', body: 'tour.pm.7.b' },
  ],
}

let active: TourId | null = null
const listeners = new Set<() => void>()
const set = (id: TourId | null) => {
  active = id
  listeners.forEach((l) => l())
}
/** Replays a module's tour (from the shortcut help or the command palette). */
export const startTour = (id: TourId) => set(id)

/** Starts the module's tour the first time this account opens it. */
export function useTour(id: TourId) {
  const me = useMe()
  const seen = me.prefs.toursSeen?.includes(id)
  useEffect(() => {
    if (seen) return
    const t = setTimeout(() => set(id), 600)
    return () => clearTimeout(t)
  }, [id, seen])
}

function markSeen(id: TourId, seen: string[]) {
  if (seen.includes(id)) return
  api<{ user: ReturnType<typeof useMe> }>('/api/me', { method: 'PATCH', body: { prefs: { toursSeen: [...seen, id] } } }).then((r) => refreshMe(r.user), () => undefined)
}

export function TourHost() {
  const id = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => active,
  )
  return <AnimatePresence>{id && <Tour key={id} id={id} />}</AnimatePresence>
}

function Tour({ id }: { id: TourId }) {
  const { t } = useI18n()
  const me = useMe()
  const steps = TOURS[id]
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = steps[i]!
  const close = () => {
    markSeen(id, me.prefs.toursSeen ?? [])
    set(null)
  }
  // Follow the target (visible one only: desktop and mobile layouts both exist in the DOM).
  useLayoutEffect(() => {
    const find = () => {
      const el = step.target ? [...document.querySelectorAll<HTMLElement>(`[data-tour="${step.target}"]`)].find((e) => e.offsetParent !== null) : null
      el?.scrollIntoView({ block: 'nearest' })
      setRect(el ? el.getBoundingClientRect() : null)
    }
    find()
    window.addEventListener('resize', find)
    return () => window.removeEventListener('resize', find)
  }, [step.target])
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') setI((x) => Math.min(x + 1, steps.length - 1))
      if (e.key === 'ArrowLeft') setI((x) => Math.max(x - 1, 0))
    }
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
  })
  const pad = 6
  const vw = typeof window === 'undefined' ? 0 : window.innerWidth
  const vh = typeof window === 'undefined' ? 0 : window.innerHeight
  // Card goes below the target when there is room, otherwise above; centred when there is no target.
  const below = rect ? rect.bottom + 200 < vh : true
  const cardStyle = rect ? { left: Math.min(Math.max(12, rect.left), vw - 332), top: below ? rect.bottom + pad + 10 : undefined, bottom: below ? undefined : vh - rect.top + pad + 10 } : undefined
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="fixed inset-0 z-[80]" role="dialog" aria-modal aria-label={t(step.title)}>
      {/* Dim everything except the target: a huge shadow around a transparent box. */}
      {rect ? (
        <motion.div
          className="pointer-events-none absolute rounded-xl ring-2 ring-accent"
          animate={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
          style={{ boxShadow: '0 0 0 9999px var(--t-overlay)' }}
        />
      ) : (
        <div className="absolute inset-0 bg-overlay" />
      )}
      <div className="absolute inset-0" onClick={close} />
      {/* Without a target the card is centred by a flex wrapper (no transform, so the enter animation stays put). */}
      <div className={rect ? 'contents' : 'pointer-events-none absolute inset-0 flex items-center justify-center'}>
      <motion.div
        key={i}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className={cx('pointer-events-auto w-[min(320px,calc(100vw-24px))] rounded-2xl border border-line bg-surface p-4 shadow-card', rect && 'absolute')}
        style={cardStyle}
      >
        <div className="mb-1 text-xs font-medium text-accent-text">
          {i + 1} / {steps.length}
        </div>
        <div className="text-[15px] font-semibold">{t(step.title)}</div>
        <p className="mt-1 text-sm text-fg-3">{t(step.body)}</p>
        <div className="mt-4 flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={close}>
            {t('tour.skip')}
          </Button>
          <div className="flex-1" />
          {i > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setI(i - 1)}>
              {t('common.prev')}
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => (i < steps.length - 1 ? setI(i + 1) : close())}>
            {i < steps.length - 1 ? t('common.next') : t('tour.done')}
          </Button>
        </div>
      </motion.div>
      </div>
    </motion.div>
  )
}
