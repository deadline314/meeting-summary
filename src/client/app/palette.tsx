import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { CornerDownLeft, FileText, FolderKanban, Search, CheckSquare } from 'lucide-react'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { allActions, useActionsVersion, useScope, type Action } from '../lib/actions'
import { api } from '../lib/api'
import { useDebounced } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { cx } from '../ui/cx'
import { Dialog } from '../ui/dialog'
import { Kbd } from '../ui/misc'

type Hit = { type: 'note' | 'task' | 'issue'; id: string; title: string; subtitle?: string; href: string }

let open = false
const listeners = new Set<() => void>()
const set = (v: boolean) => {
  open = v
  listeners.forEach((l) => l())
}
export const openPalette = () => set(true)
let helpOpen = false
const helpListeners = new Set<() => void>()
export const openShortcutHelp = () => {
  helpOpen = true
  helpListeners.forEach((l) => l())
}

const useStore = (ls: Set<() => void>, get: () => boolean) =>
  useSyncExternalStore(
    (cb) => {
      ls.add(cb)
      return () => ls.delete(cb)
    },
    get,
  )

const HIT_ICON = { note: FileText, task: CheckSquare, issue: FolderKanban }

export function CommandPalette() {
  const isOpen = useStore(listeners, () => open)
  const t = useT()
  const navigate = useNavigate()
  useActionsVersion()
  useScope('palette', isOpen)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const dq = useDebounced(q.trim(), 180)
  const close = () => {
    set(false)
    setQ('')
    setSel(0)
  }

  const actions = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return allActions()
      .filter((a) => !a.hidden && a.scope !== 'palette')
      .filter((a) => !needle || t(a.label).toLowerCase().includes(needle) || a.id.includes(needle))
      .slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, t, isOpen])

  const search = useQuery({
    queryKey: ['search', dq],
    queryFn: () => api<{ items: Hit[] }>(`/api/search?q=${encodeURIComponent(dq)}`),
    enabled: isOpen && dq.length > 0,
    staleTime: 10_000,
  })
  const hits = search.data?.items ?? []
  const rows: ({ kind: 'action'; a: Action } | { kind: 'hit'; h: Hit })[] = [
    ...actions.map((a) => ({ kind: 'action' as const, a })),
    ...hits.map((h) => ({ kind: 'hit' as const, h })),
  ]

  const run = (i: number) => {
    const r = rows[i]
    if (!r) return
    close()
    if (r.kind === 'action') setTimeout(() => r.a.run(), 0)
    else navigate({ to: r.h.href })
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => (v ? set(true) : close())} title={t('action.palette')} size="md">
      <div className="-mx-5 -mt-3">
        <div className="flex items-center gap-2 border-b border-line px-5">
          <Search className="size-4 text-fg-4" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((s) => Math.min(s + 1, rows.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((s) => Math.max(s - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(sel)
              }
            }}
            placeholder={t('palette.placeholder')}
            className="h-12 flex-1 bg-transparent text-[15px] text-fg placeholder:text-fg-4 focus:outline-none"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {actions.length > 0 && <div className="px-3 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-fg-4 uppercase">{t('palette.actions')}</div>}
          {rows.map((r, i) => {
            const active = i === sel
            const header = r.kind === 'hit' && i === actions.length
            return (
              <div key={r.kind === 'action' ? r.a.id : `${r.h.type}:${r.h.id}`}>
                {header && <div className="px-3 pt-3 pb-1.5 text-[11px] font-semibold tracking-wide text-fg-4 uppercase">{t('palette.results')}</div>}
                <button
                  onMouseMove={() => setSel(i)}
                  onClick={() => run(i)}
                  className={cx(
                    'flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors [&_svg]:size-4',
                    active ? 'bg-accent-soft text-fg' : 'text-fg-2',
                  )}
                >
                  {r.kind === 'action' ? (
                    <>
                      <span className="text-fg-3">{r.a.icon}</span>
                      <span className="flex-1 truncate">{t(r.a.label)}</span>
                      {r.a.keys && <Kbd keys={r.a.keys} />}
                    </>
                  ) : (
                    <HitRow h={r.h} />
                  )}
                  {active && <CornerDownLeft className="text-fg-4" />}
                </button>
              </div>
            )
          })}
          {rows.length === 0 && <div className="py-8 text-center text-sm text-fg-4">{t('palette.empty')}</div>}
        </div>
      </div>
    </Dialog>
  )
}

function HitRow({ h }: { h: Hit }) {
  const Icon = HIT_ICON[h.type]
  return (
    <>
      <Icon className="text-fg-3" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{h.title}</span>
        {h.subtitle && <span className="block truncate text-xs text-fg-4">{h.subtitle}</span>}
      </span>
    </>
  )
}

export function ShortcutHelp() {
  const isOpen = useStore(helpListeners, () => helpOpen)
  const t = useT()
  useActionsVersion()
  useScope('help', isOpen)
  const groups = new Map<string, Action[]>()
  for (const a of allActions().filter((x) => x.keys)) {
    const g = t(a.group ?? 'group.general')
    groups.set(g, [...(groups.get(g) ?? []), a])
  }
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(v) => {
        helpOpen = v
        helpListeners.forEach((l) => l())
      }}
      title={t('shortcuts.title')}
      description={t('shortcuts.hint')}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {[...groups].map(([g, list]) => (
          <div key={g}>
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-fg-4 uppercase">{g}</div>
            <ul className="flex flex-col gap-1.5">
              {list.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 text-sm text-fg-2">
                  <span className="truncate">{t(a.label)}</span>
                  <Kbd keys={a.keys!} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Dialog>
  )
}
