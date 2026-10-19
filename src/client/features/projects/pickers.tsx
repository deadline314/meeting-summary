import { Check, Plus, Search, Tag, UserRound } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useMemo, useState, type ReactNode } from 'react'
import { useScope } from '../../lib/actions'
import { useT, type MsgKey } from '../../lib/i18n'
import { useDirectory } from '../../lib/session'
import { Avatar } from '../../ui/avatar'
import { cx } from '../../ui/cx'
import { IssueStatusIcon, PriorityIcon } from './icons'
import { PRIORITIES, STATUSES, type Label, type Priority, type Status } from './model'

export type Option = { value: string; label: string; icon?: ReactNode; keywords?: string }

/**
 * The one picker used for status (S), assignee (A), priority (P) and labels (L) —
 * in the create dialog, context menus and the detail page alike.
 */
export function OptionPicker({
  options,
  value,
  multiple,
  onChange,
  trigger,
  open,
  onOpenChange,
  placeholder,
  onCreate,
  createLabel,
}: {
  options: Option[]
  value: string[]
  multiple?: boolean
  onChange(v: string[]): void
  trigger: ReactNode
  open?: boolean
  onOpenChange?(o: boolean): void
  placeholder: string
  onCreate?(q: string): void
  createLabel?(q: string): string
}) {
  const [inner, setInner] = useState(false)
  const isOpen = open ?? inner
  const setOpen = (o: boolean) => (onOpenChange ? onOpenChange(o) : setInner(o))
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  useScope('picker', isOpen)
  const list = useMemo(() => options.filter((o) => `${o.label} ${o.keywords ?? ''}`.toLowerCase().includes(q.toLowerCase())), [options, q])
  const pick = (v: string) => {
    if (multiple) onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
    else {
      onChange([v])
      setOpen(false)
    }
  }
  return (
    <Popover.Root
      open={isOpen}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQ('')
      }}
    >
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-layer
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onClick={(e) => e.stopPropagation()}
          className="anim-pop z-[65] w-60 rounded-xl border border-line bg-surface p-1.5 shadow-card"
        >
          <div className="flex items-center gap-2 px-2 pb-1.5">
            <Search className="size-4 text-fg-4" />
            <input
              autoFocus
              value={q}
              placeholder={placeholder}
              onChange={(e) => {
                setQ(e.target.value)
                setHi(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setHi((h) => Math.min(h + 1, list.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setHi((h) => Math.max(h - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  if (list[hi]) pick(list[hi]!.value)
                  else if (onCreate && q.trim()) {
                    onCreate(q.trim())
                    setQ('')
                  }
                }
              }}
              className="h-8 flex-1 bg-transparent text-sm focus:outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {list.map((o, i) => (
              <button
                key={o.value}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(o.value)}
                className={cx('flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm max-md:h-11', i === hi && 'bg-surface-2')}
              >
                {o.icon}
                <span className="flex-1 truncate">{o.label}</span>
                {value.includes(o.value) && <Check className="size-4 text-accent" />}
              </button>
            ))}
            {onCreate && q.trim() && !list.some((o) => o.label.toLowerCase() === q.trim().toLowerCase()) && (
              <button onClick={() => (onCreate(q.trim()), setQ(''))} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm text-accent-text hover:bg-surface-2">
                <Plus className="size-4" />
                {createLabel?.(q.trim())}
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function useStatusOptions(): Option[] {
  const t = useT()
  return STATUSES.map((s) => ({ value: s, label: t(`status.${s}` as MsgKey), icon: <IssueStatusIcon status={s} /> }))
}

export function usePriorityOptions(): Option[] {
  const t = useT()
  return PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}` as MsgKey), icon: <PriorityIcon priority={p} /> }))
}

export function useAssigneeOptions(memberIds?: string[]): Option[] {
  const dir = useDirectory()
  return [...dir.values()]
    .filter((u) => u.status === 'active' && (!memberIds || memberIds.includes(u.id)))
    .map((u) => ({ value: u.id, label: u.name, icon: <Avatar id={u.id} name={u.name} src={u.avatarUrl} size="xs" /> }))
}

export function labelOptions(labels: Label[]): Option[] {
  return labels.map((l) => ({ value: l.id, label: l.name, icon: <LabelDot color={l.color} /> }))
}

export const LabelDot = ({ color }: { color: number }) => <span className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--t-label-${color}-fg)` }} />

export function LabelChip({ label }: { label: Label }) {
  return (
    <span className="inline-flex h-5 max-w-28 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium" style={{ background: `var(--t-label-${label.color}-bg)`, color: `var(--t-label-${label.color}-fg)` }}>
      <span className="truncate">{label.name}</span>
    </span>
  )
}

/** Pill trigger used in the create dialog and properties panel. */
export function Pill({ icon, children, hotkey, className, ...p }: React.ComponentProps<'button'> & { icon?: ReactNode; hotkey?: string }) {
  return (
    <button
      type="button"
      className={cx('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-fg-2 transition-colors hover:border-line-strong hover:bg-surface-2 max-md:h-10', className)}
      {...p}
    >
      {icon}
      <span className="max-w-40 truncate">{children}</span>
      {hotkey && <kbd className="ml-0.5 hidden rounded bg-surface-3 px-1 text-[10px] font-semibold text-fg-4 md:inline">{hotkey}</kbd>}
    </button>
  )
}

export const AssigneeIcon = () => <UserRound className="size-4 text-fg-4" />
export const LabelIcon = () => <Tag className="size-4 text-fg-4" />
export type { Status, Priority }
