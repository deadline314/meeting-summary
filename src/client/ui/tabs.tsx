import type { ReactNode } from 'react'
import { cx } from './cx'
import { Tooltip } from './tooltip'

/** Underlined tab bar with a sliding indicator. Controlled, so callers can keep the tab in the URL. */
export function TabBar<const T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: NoInfer<T>; label: ReactNode; icon?: ReactNode; badge?: ReactNode }[]
  value: T
  onChange(v: NoInfer<T>): void
  className?: string
}) {
  return (
    <div role="tablist" className={cx('-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1 [scrollbar-width:none]', className)}>
      {tabs.map((tab) => {
        const active = tab.value === value
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cx(
              'relative flex h-10 shrink-0 items-center gap-2 px-3 text-sm font-medium transition-colors max-md:h-11 [&_svg]:size-4',
              active ? 'text-fg' : 'text-fg-3 hover:text-fg-2',
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.badge}
            {/* CSS only: shared-layout animations measure the whole page on every change. */}
            <span className={cx('absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent transition-transform duration-200', !active && 'scale-x-0')} aria-hidden />
          </button>
        )
      })}
    </div>
  )
}

/** Pill-style segmented control for 2–4 options. */
export function Segmented<const T extends string>({
  options,
  value,
  onChange,
  className,
  compact,
  ...rest
}: {
  options: { value: NoInfer<T>; label: string; icon?: ReactNode }[]
  value: T
  onChange(v: NoInfer<T>): void
  className?: string
  /** Only the selected option shows its label; the others are icons with a tooltip. */
  compact?: boolean
  'data-tour'?: string
}) {
  return (
    <div {...rest} className={cx('inline-flex rounded-xl bg-surface-2 p-1', className)}>
      {options.map((o) => (
        <Tooltip key={o.value} label={compact && o.value !== value ? o.label : undefined}>
        <button
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          aria-label={o.label}
          className={cx(
            'relative flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-200 max-md:h-9 [&_svg]:size-4',
            o.value === value ? 'bg-surface text-fg shadow-sm' : 'text-fg-3 hover:text-fg-2',
          )}
        >
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            {o.icon}
            {(!compact || o.value === value || !o.icon) && o.label}
          </span>
        </button>
        </Tooltip>
      ))}
    </div>
  )
}
