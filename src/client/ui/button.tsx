import { Slot } from 'radix-ui'
import { forwardRef, type ComponentProps, type ReactNode } from 'react'
import { cx } from './cx'
import { Spinner } from './misc'
import { Tooltip } from './tooltip'

const VARIANT = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm',
  secondary: 'border border-line bg-surface text-fg hover:bg-surface-2 hover:border-line-strong',
  ghost: 'text-fg-2 hover:bg-surface-2 hover:text-fg',
  danger: 'bg-danger text-on-status hover:opacity-90',
  soft: 'bg-accent-soft text-accent-text hover:brightness-95',
} as const

const SIZE = {
  sm: 'h-8 gap-1.5 rounded-lg px-2.5 text-[13px]',
  md: 'h-10 gap-2 rounded-xl px-3.5 text-sm max-md:h-11',
  lg: 'h-12 gap-2 rounded-xl px-5 text-[15px]',
} as const

type ButtonProps = ComponentProps<'button'> & {
  variant?: keyof typeof VARIANT
  size?: keyof typeof SIZE
  loading?: boolean
  icon?: ReactNode
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, asChild, className, children, disabled, ...p },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background,border-color,color,transform,box-shadow] duration-150 select-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...p}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Spinner className="text-current" /> : icon}
          {children}
        </>
      )}
    </Comp>
  )
})

type IconButtonProps = Omit<ComponentProps<'button'>, 'children'> & {
  /** Required: icon-only buttons always get a tooltip and an accessible name. */
  label: string
  shortcut?: string
  icon: ReactNode
  variant?: 'ghost' | 'secondary' | 'soft'
  size?: 'sm' | 'md'
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, icon, variant = 'ghost', size = 'md', side, className, ...p },
  ref,
) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={side}>
      <button
        ref={ref}
        aria-label={label}
        className={cx(
          'inline-flex shrink-0 items-center justify-center rounded-xl transition-[background,color,transform] duration-150 active:scale-90 disabled:pointer-events-none disabled:opacity-40',
          variant === 'ghost' && 'text-fg-3 hover:bg-surface-2 hover:text-fg',
          variant === 'secondary' && 'border border-line bg-surface text-fg-2 hover:bg-surface-2',
          variant === 'soft' && 'bg-accent-soft text-accent-text',
          size === 'sm' ? 'size-8 [&_svg]:size-4' : 'size-10 max-md:size-11 [&_svg]:size-[18px]',
          className,
        )}
        {...p}
      >
        {icon}
      </button>
    </Tooltip>
  )
})
