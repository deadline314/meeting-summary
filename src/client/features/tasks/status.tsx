import { CheckCircle2, Clock, Loader2, TimerOff, TriangleAlert, XCircle } from 'lucide-react'
import { useI18n } from '../../lib/i18n'
import { Badge } from '../../ui/misc'

const TONE = {
  queued: 'neutral',
  running: 'info',
  passed: 'success',
  failed: 'danger',
  error: 'warning',
  timeout: 'warning',
} as const

const ICON = { queued: Clock, running: Loader2, passed: CheckCircle2, failed: XCircle, error: TriangleAlert, timeout: TimerOff }

export function SubmissionBadge({ status, score }: { status: string | null; score?: number | null }) {
  const { t, fmt } = useI18n()
  if (!status) return <Badge>{t('task.notSubmitted')}</Badge>
  const s = status as keyof typeof TONE
  const Icon = ICON[s] ?? Clock
  return (
    <Badge tone={TONE[s] ?? 'neutral'}>
      <Icon className={s === 'running' ? 'size-3 animate-spin' : 'size-3'} />
      {t(`submission.${s}`)}
      {score != null && (s === 'passed' || s === 'failed') && <span className="font-mono">{fmt.number(Math.round(score * 1000) / 1000)}</span>}
    </Badge>
  )
}
