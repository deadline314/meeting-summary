import { forwardRef, useId, type ComponentProps, type ReactNode } from 'react'
import { cx } from './cx'

const control =
  'rounded-xl border border-line bg-surface px-3 text-sm text-fg placeholder:text-fg-4 transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_var(--t-accent-soft)] focus:outline-none disabled:opacity-60'

/** Full width unless the caller sets its own `w-*`. */
const width = (className?: string) => (/(^|\s)w-/.test(className ?? '') ? '' : 'w-full')

export const Input = forwardRef<HTMLInputElement, ComponentProps<'input'>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cx(control, width(className), 'h-10 max-md:h-11 max-md:text-base', className)} {...p} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<'textarea'>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cx(control, width(className), 'min-h-24 py-2.5 leading-relaxed max-md:text-base', className)} {...p} />
})

export const Select = forwardRef<HTMLSelectElement, ComponentProps<'select'>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} className={cx(control, width(className), 'h-10 pr-8 max-md:h-11', className)} {...p} />
})

/** Label + control + hint/error, wired with ids for accessibility. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: (id: string) => ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-fg-2">
        {label}
      </label>
      {children(id)}
      {error ? <p className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-fg-4">{hint}</p> : null}
    </div>
  )
}
