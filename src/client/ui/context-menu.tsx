import { Check, ChevronRight } from 'lucide-react'
import { ContextMenu as CM } from 'radix-ui'
import type { ReactNode } from 'react'
import { cx } from './cx'
import { Kbd } from './misc'
import { toast, toastError } from './toast'

// Same look as the dropdown menu; `data-sheet` turns it into a bottom sheet on phones (styles.css).
const panel = 'anim-pop z-[60] min-w-52 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-card'
const item =
  'flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm text-fg-2 outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2 data-[highlighted]:text-fg max-md:h-11 [&_svg]:size-4 [&_svg]:text-fg-3'

/**
 * Right-click (long-press on touch) menu around `children`. Pass `disabled` to keep the browser's
 * own menu, e.g. while the wrapped element is being edited.
 */
export function ContextMenu({ menu, children, disabled }: { menu: ReactNode; children: ReactNode; disabled?: boolean }) {
  return (
    <CM.Root modal={false}>
      <CM.Trigger asChild disabled={disabled}>
        {children}
      </CM.Trigger>
      <CM.Portal>
        <CM.Content data-layer data-sheet collisionPadding={8} className={panel}>
          {menu}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  )
}

export function CtxItem({
  icon,
  children,
  shortcut,
  danger,
  checked,
  onSelect,
  disabled,
}: {
  icon?: ReactNode
  children: ReactNode
  shortcut?: string
  danger?: boolean
  checked?: boolean
  onSelect?: () => void
  disabled?: boolean
}) {
  return (
    <CM.Item disabled={disabled} onSelect={onSelect} className={cx(item, danger && 'text-danger data-[highlighted]:text-danger [&_svg]:text-danger')}>
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {checked && <Check className="!text-accent" />}
      {shortcut && <Kbd keys={shortcut} />}
    </CM.Item>
  )
}

export function CtxSub({ icon, label, children }: { icon?: ReactNode; label: ReactNode; children: ReactNode }) {
  return (
    <CM.Sub>
      <CM.SubTrigger className={item}>
        {icon}
        <span className="flex-1">{label}</span>
        <ChevronRight />
      </CM.SubTrigger>
      <CM.Portal>
        <CM.SubContent data-layer data-sheet collisionPadding={8} className={panel}>
          {children}
        </CM.SubContent>
      </CM.Portal>
    </CM.Sub>
  )
}

export const CtxSeparator = () => <CM.Separator className="my-1 h-px bg-line" />
export const CtxLabel = ({ children }: { children: ReactNode }) => <CM.Label className="truncate px-2.5 py-1.5 text-[11px] font-semibold text-fg-4">{children}</CM.Label>

/** Copies text and confirms with a toast. */
export async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(done)
  } catch (err) {
    toastError(err)
  }
}

/** Absolute link to a path on this site. */
export const siteLink = (path: string) => new URL(path, location.origin).toString()

export const openInNewTab = (path: string) => window.open(path, '_blank', 'noopener')
