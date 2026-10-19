import { useQuery } from '@tanstack/react-query'
import { CheckSquare } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../lib/api'
import { useDebounced } from '../../lib/hooks'
import { useDirectory } from '../../lib/session'
import { UserAvatar } from '../../ui/avatar'
import { cx } from '../../ui/cx'

type Option = { label: string; detail?: string; insert: string; icon: React.ReactNode }
type Token = { kind: '@' | '#'; q: string; from: number } | null

/** The `@name` or `#query` being typed right before the caret, if any. */
export function tokenAt(value: string, caret: number): Token {
  const m = /(^|\s)([@#])([^\s@#[\]]*)$/.exec(value.slice(0, caret))
  return m ? { kind: m[2] as '@' | '#', q: m[3]!, from: caret - m[3]!.length - 1 } : null
}

/**
 * Mentions for a plain textarea: `@` lists people (optionally only `userIds`, e.g. members of the
 * issue's project), `#` searches issues and tasks. Call `update` on input/caret moves and
 * `onKey` from onKeyDown; `pick` returns the new value and caret.
 */
export function useRefSuggest(userIds?: string[]) {
  const dir = useDirectory()
  const [token, setToken] = useState<Token>(null)
  const [active, setActive] = useState(0)
  const q = useDebounced(token?.kind === '#' ? token.q : '', 200)
  const search = useQuery({
    queryKey: ['search', q],
    queryFn: () => api<{ items: { type: string; id: string; title: string; subtitle?: string }[] }>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: token?.kind === '#' && q.length > 0,
  })
  let options: Option[] = []
  if (token?.kind === '@') {
    const allowed = userIds && new Set(userIds)
    options = [...dir.values()]
      .filter((u) => u.status === 'active' && (!allowed || allowed.has(u.id)) && u.name.toLowerCase().includes(token.q.toLowerCase()))
      .slice(0, 8)
      .map((u) => ({ label: u.name, insert: `@[user:${u.id}] `, icon: <UserAvatar id={u.id} size="xs" /> }))
  } else if (token?.kind === '#' && token.q) {
    options = (search.data?.items ?? [])
      .filter((h) => h.type === 'issue' || h.type === 'task')
      .slice(0, 8)
      .map((h) => ({
        label: h.type === 'issue' ? h.id : h.title,
        detail: h.type === 'issue' ? h.title : h.subtitle,
        insert: `#[${h.type}:${h.id}] `,
        icon: h.type === 'issue' ? <span className="w-3.5 text-center font-mono text-[11px] text-fg-4">#</span> : <CheckSquare className="size-3.5 text-accent-text" />,
      }))
  }
  const open = !!token && options.length > 0
  const pick = (value: string, caret: number, insert: string) => {
    const from = token!.from
    setToken(null)
    return { value: value.slice(0, from) + insert + value.slice(caret), caret: from + insert.length }
  }
  return {
    open,
    options,
    active: Math.min(active, Math.max(0, options.length - 1)),
    setActive,
    update: (value: string, caret: number) => {
      setToken(tokenAt(value, caret))
      setActive(0)
    },
    close: () => setToken(null),
    pick,
  }
}

export function RefSuggestList({ s, onPick }: { s: ReturnType<typeof useRefSuggest>; onPick(insert: string): void }) {
  if (!s.open) return null
  return (
    <ul role="listbox" className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-72 max-w-full overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-card">
      {s.options.map((o, i) => (
        <li key={o.insert} role="option" aria-selected={i === s.active}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(o.insert)
            }}
            onMouseEnter={() => s.setActive(i)}
            className={cx('flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm', i === s.active && 'bg-surface-2')}
          >
            {o.icon}
            <span className="truncate">{o.label}</span>
            {o.detail && <span className="ml-auto truncate text-xs text-fg-4">{o.detail}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}
