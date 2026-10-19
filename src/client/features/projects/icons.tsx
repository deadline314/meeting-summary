import { cx } from '../../ui/cx'

/** Status glyphs per the PM visual system: dashed / empty / half / ¾ / check / cross circles. */
export function IssueStatusIcon({ status, className }: { status: string; className?: string }) {
  const cls = cx('size-4 shrink-0', className)
  switch (status) {
    case 'backlog':
      return (
        <svg viewBox="0 0 16 16" className={cx(cls, 'text-fg-4')} aria-hidden>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.2 2.2" />
        </svg>
      )
    case 'todo':
      return (
        <svg viewBox="0 0 16 16" className={cx(cls, 'text-fg-3')} aria-hidden>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      )
    case 'in_progress':
      return (
        <svg viewBox="0 0 16 16" className={cx(cls, 'text-warning')} aria-hidden>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 4a4 4 0 0 1 0 8z" fill="currentColor" />
        </svg>
      )
    case 'in_review':
      return (
        <svg viewBox="0 0 16 16" className={cx(cls, 'text-info')} aria-hidden>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 4a4 4 0 1 1-4 4h4z" fill="currentColor" />
        </svg>
      )
    case 'done':
      return (
        <svg viewBox="0 0 16 16" className={cx(cls, 'text-success')} aria-hidden>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M5 8.2l2 2 4-4.2" fill="none" stroke="var(--t-surface)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 16 16" className={cx(cls, 'text-fg-4')} aria-hidden>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="var(--t-surface)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )
  }
}

/** Priority glyph: urgent = warning square with "!", high/medium/low = 3/2/1 lit bars, none = dashed line. */
export function PriorityIcon({ priority, className }: { priority: string; className?: string }) {
  const cls = cx('size-4 shrink-0', className)
  if (priority === 'urgent')
    return (
      <svg viewBox="0 0 16 16" className={cx(cls, 'text-warning')} aria-hidden>
        <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="currentColor" />
        <path d="M8 4.5v4.5" stroke="var(--t-surface)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="8" cy="11.6" r="1" fill="var(--t-surface)" />
      </svg>
    )
  if (priority === 'none')
    return (
      <svg viewBox="0 0 16 16" className={cx(cls, 'text-fg-4')} aria-hidden>
        <path d="M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2 2" strokeLinecap="round" />
      </svg>
    )
  const lit = priority === 'high' ? 3 : priority === 'medium' ? 2 : 1
  const tone = priority === 'high' ? 'text-fg-2' : priority === 'medium' ? 'text-fg-3' : 'text-fg-4'
  return (
    <svg viewBox="0 0 16 16" className={cx(cls, tone)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={2.5 + i * 4} y={10 - i * 3} width="3" height={4 + i * 3} rx="1" fill="currentColor" opacity={i < lit ? 1 : 0.25} />
      ))}
    </svg>
  )
}
