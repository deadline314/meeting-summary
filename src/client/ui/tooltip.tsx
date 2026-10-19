import { Tooltip as T } from 'radix-ui'
import type { ReactNode } from 'react'
import { Kbd } from './misc'

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <T.Provider delayDuration={400} skipDelayDuration={200}>
    {children}
  </T.Provider>
)

/** One-line hint. `shortcut` is rendered as a key badge (e.g. "C", "mod+K"). */
export function Tooltip({
  label,
  shortcut,
  side = 'top',
  children,
}: {
  label: ReactNode
  shortcut?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactNode
}) {
  if (!label) return <>{children}</>
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          data-layer
          className="z-[70] flex max-w-64 items-center gap-2 rounded-lg bg-fg px-2.5 py-1.5 text-xs font-medium text-canvas shadow-card anim-pop"
        >
          <span>{label}</span>
          {shortcut && <Kbd keys={shortcut} inverted />}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
