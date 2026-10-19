import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useSyncExternalStore } from 'react'
import { ApiError } from '../lib/api'
import { translate, type Locale, type MsgKey } from '../lib/i18n'
import { cx } from './cx'

type Tone = 'success' | 'info' | 'error'
type ToastAction = { label: string; run(): void }
type ToastItem = { id: number; tone: Tone; text: string; sub?: string; action?: ToastAction }

let items: ToastItem[] = []
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function toast(text: string, tone: Tone = 'success', sub?: string, action?: ToastAction) {
  const id = ++seq
  items = [...items.slice(-3), { id, tone, text, sub, action }]
  emit()
  setTimeout(() => dismiss(id), action ? 9000 : tone === 'error' ? 6000 : 3500)
}

function dismiss(id: number) {
  items = items.filter((i) => i.id !== id)
  emit()
}

/** Shows the translated server error, with its request id for support. */
export function toastError(err: unknown, action?: ToastAction) {
  const locale: Locale = document.documentElement.lang.startsWith('en') ? 'en' : 'zh'
  if (err instanceof ApiError) {
    const key = `error.${err.code}` as MsgKey
    toast(translate(locale, key, err.params), 'error', err.requestId ? translate(locale, 'common.requestId', { id: err.requestId.slice(0, 8) }) : undefined, action)
  } else {
    toast(translate(locale, 'error.internal'), 'error', undefined, action)
  }
}

const ICON = { success: CheckCircle2, info: Info, error: TriangleAlert }

export function Toaster() {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => items,
  )
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[80] flex flex-col items-center gap-2 px-4 md:right-5 md:bottom-5 md:left-auto md:items-end"
    >
      <AnimatePresence initial={false}>
        {list.map((i) => {
          const Icon = ICON[i.tone]
          return (
            <motion.div
              key={i.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 500, damping: 34 }}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card"
            >
              <Icon className={cx('mt-0.5 size-4 shrink-0', i.tone === 'success' && 'text-success', i.tone === 'info' && 'text-info', i.tone === 'error' && 'text-danger')} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-fg">{i.text}</div>
                {i.sub && <div className="mt-0.5 text-xs text-fg-4">{i.sub}</div>}
              </div>
              {i.action && (
                <button
                  onClick={() => {
                    i.action!.run()
                    dismiss(i.id)
                  }}
                  className="shrink-0 rounded-lg px-2 py-0.5 text-sm font-semibold text-accent-text hover:bg-accent-soft"
                >
                  {i.action.label}
                </button>
              )}
              <button aria-label="dismiss" onClick={() => dismiss(i.id)} className="text-fg-4 hover:text-fg">
                <X className="size-4" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
