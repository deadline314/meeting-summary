import { Loader2 } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { isMac } from '../lib/hooks'
import { cx } from './cx'

export function Kbd({ keys, inverted }: { keys: string; inverted?: boolean }) {
  const parts = keys.split(/\s+/).map((chord) =>
    chord
      .split('+')
      .map((k) => (k === 'mod' ? (isMac ? '⌘' : 'Ctrl') : k === 'shift' ? '⇧' : k === 'enter' ? '↵' : k.length === 1 ? k.toUpperCase() : k))
      .join(isMac ? '' : '+'),
  )
  return (
    <span className="inline-flex gap-1">
      {parts.map((p, i) => (
        <kbd
          key={i}
          className={cx(
            'inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 font-sans text-[11px] font-semibold',
            inverted ? 'bg-canvas/20 text-canvas' : 'border border-line bg-surface-2 text-fg-3',
          )}
        >
          {p}
        </kbd>
      ))}
    </span>
  )
}

export const Spinner = ({ className }: { className?: string }) => (
  <Loader2 className={cx('size-4 animate-spin text-fg-3', className)} aria-hidden />
)

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cx(
        'animate-shimmer rounded-lg bg-[linear-gradient(90deg,var(--t-surface-2)_0%,var(--t-surface-3)_50%,var(--t-surface-2)_100%)] bg-[length:200%_100%]',
        className,
      )}
    />
  )
}

export function Card({ className, ...p }: ComponentProps<'div'>) {
  return <div className={cx('rounded-2xl border border-line bg-surface shadow-card', className)} {...p} />
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: ReactNode
  title: ReactNode
  hint?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('anim-rise flex flex-col items-center justify-center gap-3 px-6 py-10 text-center', className)}>
      {icon && <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">{icon}</div>}
      <div className="text-sm font-semibold text-fg">{title}</div>
      {hint && <div className="max-w-sm text-sm text-fg-3">{hint}</div>}
      {action}
    </div>
  )
}

const BADGE = {
  neutral: 'bg-surface-2 text-fg-2',
  accent: 'bg-accent-soft text-accent-text',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
} as const

export function Badge({ tone = 'neutral', className, ...p }: ComponentProps<'span'> & { tone?: keyof typeof BADGE }) {
  return (
    <span
      className={cx('inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold whitespace-nowrap', BADGE[tone], className)}
      {...p}
    />
  )
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold tracking-tight text-fg md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
