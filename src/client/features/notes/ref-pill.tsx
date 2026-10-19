import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CheckSquare, Lock } from 'lucide-react'
import { api } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { useUser } from '../../lib/session'
import { IssueStatusIcon } from '../projects/icons'
import { SubmissionBadge } from '../tasks/status'

type RefInfo = { title: string; href: string; status?: string; ref?: string; best?: { status: string; score: number | null } | null }

const pill = 'mx-0.5 inline-flex max-w-72 items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 align-baseline text-[0.88em] leading-6 no-underline hover:border-accent'

/** `@[user:id]`, `#[issue:KEY-N]`, `#[task:id]` rendered as live chips. Inaccessible targets never reveal a title. */
export function RefPill({ type, id }: { type: 'user' | 'issue' | 'task'; id: string }) {
  const u = useUser(type === 'user' ? id : null)
  const { t } = useI18n()
  const q = useQuery({
    queryKey: ['ref', type, id],
    queryFn: () => api<RefInfo>(`/api/refs/${type}/${encodeURIComponent(id)}`),
    enabled: type !== 'user',
    staleTime: 30_000,
    retry: false,
  })
  if (type === 'user') return <span className={`${pill} font-medium text-accent-text`}>@{u?.name ?? '…'}</span>
  if (q.isError)
    return (
      <span className={`${pill} text-fg-4`}>
        <Lock className="size-3" />
        {t('links.noAccess')}
      </span>
    )
  if (!q.data) return <span className={`${pill} text-fg-4`}>{type === 'issue' ? id : '…'}</span>
  return (
    <Link to={q.data.href} className={`${pill} text-fg-2`}>
      {type === 'issue' ? <IssueStatusIcon status={q.data.status ?? 'todo'} className="size-3.5" /> : <CheckSquare className="size-3.5 text-accent-text" />}
      {q.data.ref && <span className="font-mono text-[0.85em] text-fg-4">{q.data.ref}</span>}
      <span className="truncate">{q.data.title}</span>
      {type === 'task' && q.data.best !== undefined && <SubmissionBadge status={q.data.best?.status ?? null} score={q.data.best?.score} />}
    </Link>
  )
}
