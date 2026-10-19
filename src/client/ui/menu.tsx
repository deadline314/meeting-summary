import { Check, ChevronRight } from 'lucide-react'
import { DropdownMenu as M } from 'radix-ui'
import type { ReactNode } from 'react'
import { cx } from './cx'
import { Kbd } from './misc'

const panel = 'anim-pop z-[60] min-w-48 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-card'
const item =
  'flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm text-fg-2 outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2 data-[highlighted]:text-fg max-md:h-11 [&_svg]:size-4 [&_svg]:text-fg-3'

export const Menu = M.Root
export const MenuTrigger = M.Trigger

export function MenuContent({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <M.Portal>
      <M.Content data-layer align={align} sideOffset={6} collisionPadding={12} className={cx(panel, className)}>
        {children}
      </M.Content>
    </M.Portal>
  )
}

export function MenuItem({
  icon,
  children,
  hint,
  shortcut,
  danger,
  checked,
  onSelect,
  disabled,
}: {
  icon?: ReactNode
  children: ReactNode
  /** Second line under the label (wraps). */
  hint?: ReactNode
  shortcut?: string
  danger?: boolean
  checked?: boolean
  onSelect?: () => void
  disabled?: boolean
}) {
  return (
    <M.Item disabled={disabled} onSelect={onSelect} className={cx(item, !!hint && 'h-auto min-h-9 py-1.5 max-md:h-auto', danger && 'text-danger data-[highlighted]:text-danger [&_svg]:text-danger')}>
      {icon}
      {hint ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{children}</span>
          <span className="text-xs text-fg-4">{hint}</span>
        </span>
      ) : (
        <span className="flex-1 truncate">{children}</span>
      )}
      {checked && <Check className="!text-accent" />}
      {shortcut && <Kbd keys={shortcut} />}
    </M.Item>
  )
}

export function SubMenu({ icon, label, children }: { icon?: ReactNode; label: ReactNode; children: ReactNode }) {
  return (
    <M.Sub>
      <M.SubTrigger className={item}>
        {icon}
        <span className="flex-1">{label}</span>
        <ChevronRight />
      </M.SubTrigger>
      <M.Portal>
        <M.SubContent data-layer sideOffset={4} className={panel}>
          {children}
        </M.SubContent>
      </M.Portal>
    </M.Sub>
  )
}

export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line" />
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <M.Label className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-fg-4 uppercase">{children}</M.Label>
)
