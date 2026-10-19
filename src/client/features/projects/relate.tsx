import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { api, queryClient } from '../../lib/api'
import { useDebounced } from '../../lib/hooks'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { Dialog, confirm } from '../../ui/dialog'
import { Input } from '../../ui/field'
import { EmptyState } from '../../ui/misc'
import { toast, toastError } from '../../ui/toast'
import { invalidateIssues, patchIssue, type IssueRow } from './model'

type Kind = 'parent' | 'blocks' | 'blocked_by' | 'relates' | 'duplicate_of'
type Req = { issue: Pick<IssueRow, 'ref' | 'version' | 'title'>; kind: Kind }
let req: Req | null = null
const listeners = new Set<() => void>()
const set = (r: Req | null) => {
  req = r
  listeners.forEach((l) => l())
}
export const openRelate = (r: Req) => set(r)

/** After marking an issue as a duplicate, ask whether to close it (status → canceled). */
export async function offerCloseDuplicate(issue: Pick<IssueRow, 'ref'>, of: string, t: (k: MsgKey, p?: Record<string, string>) => string) {
  if (!(await confirm({ title: t('pm.dup.closeTitle', { ref: issue.ref }), body: t('pm.dup.closeBody', { of }), confirmLabel: t('pm.dup.close') }))) return
  const cur = (await api<{ issue: IssueRow }>(`/api/issues/${issue.ref}`)).issue
  await patchIssue(cur, { status: 'canceled' }).catch(toastError)
}

export function RelateHost() {
  const r = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => req,
  )
  return r ? <RelateDialog r={r} key={r.issue.ref + r.kind} /> : null
}

/** Pick the other issue for a relation chosen from the context menu. */
function RelateDialog({ r }: { r: Req }) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 200)
  const hits = useQuery({
    queryKey: ['search', dq],
    queryFn: () => api<{ items: { type: string; id: string; title: string }[] }>(`/api/search?q=${encodeURIComponent(dq)}`),
    enabled: dq.trim().length > 0,
  })
  const items = (hits.data?.items ?? []).filter((h) => h.type === 'issue' && h.id !== r.issue.ref)
  const pick = async (target: string) => {
    try {
      if (r.kind === 'parent') await patchIssue(r.issue, { parentRef: target })
      else await api(`/api/issues/${r.issue.ref}/relations`, { method: 'POST', body: { type: r.kind, target } })
      set(null)
      toast(t('pm.rel.added', { ref: r.issue.ref, target }))
      if (r.kind === 'duplicate_of') await offerCloseDuplicate(r.issue, target, t)
      invalidateIssues()
      queryClient.invalidateQueries({ queryKey: ['issue'] })
    } catch (err) {
      toastError(err)
    }
  }
  const title = r.kind === 'parent' ? t('pm.rel.setParent') : t(`pm.rel.${r.kind}` as MsgKey)
  return (
    <Dialog open onOpenChange={(o) => !o && set(null)} title={`${r.issue.ref} · ${title}`} description={r.issue.title}>
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-4" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('pm.rel.pick')} aria-label={t('pm.rel.pick')} className="pl-9" />
        </div>
        <ul className="flex max-h-72 flex-col overflow-y-auto">
          {items.map((h) => (
            <li key={h.id}>
              <button onClick={() => pick(h.id)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-surface-2">
                <span className="font-mono text-xs text-fg-4">{h.id}</span>
                <span className="truncate">{h.title}</span>
              </button>
            </li>
          ))}
        </ul>
        {dq && !hits.isPending && !items.length && <EmptyState title={t('common.noResults')} />}
      </div>
    </Dialog>
  )
}
