import { Check, Plus, Search, X } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useMemo, useState, type ReactNode } from 'react'
import { useT } from '../lib/i18n'
import { useDirectory } from '../lib/session'
import { Avatar, UserAvatar, UserName } from './avatar'
import { cx } from './cx'

/** Searchable member list in a popover. `multiple` toggles; single closes on pick. */
export function UserPicker({
  value,
  onChange,
  multiple,
  trigger,
  filter,
}: {
  value: string[]
  onChange(ids: string[]): void
  multiple?: boolean
  trigger: ReactNode
  filter?: (id: string) => boolean
}) {
  const t = useT()
  const dir = useDirectory()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const list = useMemo(
    () => [...dir.values()].filter((u) => u.status === 'active' && (!filter || filter(u.id)) && u.name.toLowerCase().includes(q.toLowerCase())),
    [dir, q, filter],
  )
  const toggle = (id: string) => {
    if (!multiple) {
      onChange([id])
      setOpen(false)
      return
    }
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content data-layer align="start" sideOffset={6} collisionPadding={12} className="anim-pop z-[60] w-64 rounded-xl border border-line bg-surface p-1.5 shadow-card">
          <div className="flex items-center gap-2 px-2 pb-1.5">
            <Search className="size-4 text-fg-4" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('picker.search')}
              className="h-8 flex-1 bg-transparent text-sm focus:outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {list.map((u) => {
              const on = value.includes(u.id)
              return (
                <button
                  key={u.id}
                  onClick={() => toggle(u.id)}
                  className={cx('flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm hover:bg-surface-2 max-md:h-11', on && 'text-fg')}
                >
                  <Avatar id={u.id} name={u.name} src={u.avatarUrl} size="sm" />
                  <span className="flex-1 truncate">{u.name}</span>
                  {on && <Check className="size-4 text-accent" />}
                </button>
              )
            })}
            {list.length === 0 && <div className="py-6 text-center text-xs text-fg-4">{t('picker.none')}</div>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Inline chips of selected users with an add button. */
export function UserChips({ value, onChange, single, filter }: { value: string[]; onChange(ids: string[]): void; single?: boolean; filter?: (id: string) => boolean }) {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((id) => (
        <span key={id} className="anim-rise inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface-2 pr-1 pl-1">
          <UserAvatar id={id} size="xs" />
          <UserName id={id} className="text-[13px]" />
          {!single && (
            <button aria-label={t('common.delete')} onClick={() => onChange(value.filter((v) => v !== id))} className="rounded-full p-0.5 text-fg-4 hover:bg-surface-3 hover:text-fg">
              <X className="size-3.5" />
            </button>
          )}
        </span>
      ))}
      <UserPicker
        value={value}
        onChange={onChange}
        filter={filter}
        multiple={!single}
        trigger={
          <button type="button" className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 text-[13px] text-fg-3 hover:border-accent hover:text-accent-text">
            <Plus className="size-3.5" /> {single ? t('picker.change') : t('picker.add')}
          </button>
        }
      />
    </div>
  )
}
