import { BellRing } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../lib/api'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { refreshMe, useMe } from '../../lib/session'
import { Button } from '../../ui/button'
import { Card, EmptyState, Skeleton } from '../../ui/misc'
import { toastError } from '../../ui/toast'
import { useProjects, type ProjectRow } from '../projects/model'

export const NOTIFY_EVENTS = ['issue_assigned', 'issue_status', 'issue_unblocked', 'issue_comment', 'mention'] as const
const pair = (projectId: string, e: string) => `${projectId}:${e}`

/**
 * Project × event matrix. Everything is on unless switched off, so only the
 * switched-off pairs are stored (as "projectId:event" in the user's prefs).
 */
export function NotificationPrefs() {
  const { t } = useI18n()
  const me = useMe()
  const projects = useProjects()
  // Optimistic: the box flips at once; a failed save rolls back to the server's copy.
  const [off, setOff] = useState(() => new Set(me.prefs.notifyOff ?? []))
  const save = (next: Set<string>) => {
    setOff(next)
    api<{ user: typeof me }>('/api/me', { method: 'PATCH', body: { prefs: { notifyOff: [...next] } } }).then(
      (r) => refreshMe(r.user),
      (err) => {
        setOff(new Set(me.prefs.notifyOff ?? []))
        toastError(err)
      },
    )
  }
  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(off)
    for (const k of keys) {
      if (on) next.delete(k)
      else next.add(k)
    }
    save(next)
  }
  if (projects.isPending) return <Skeleton className="h-48" />
  const all = projects.data ?? []
  if (!all.length) return <EmptyState icon={<BellRing />} title={t('notify.noProjects')} hint={t('notify.noProjectsHint')} />
  const section = (state: ProjectRow['state'], list: ProjectRow[]) => {
    if (!list.length) return null
    const keys = list.flatMap((p) => NOTIFY_EVENTS.map((e) => pair(p.id, e)))
    return (
      <Card key={state} className="overflow-x-auto">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="flex-1 text-sm font-semibold">{t(`notify.section.${state}` as MsgKey)}</span>
          <Button size="sm" variant="ghost" onClick={() => toggle(keys, true)}>
            {t('notify.all')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => toggle(keys, false)}>
            {t('notify.none')}
          </Button>
        </div>
        <table className="w-full min-w-[34rem] table-fixed text-sm">
          <thead>
            <tr className="text-xs text-fg-4">
              <th className="w-2/5 px-4 py-2 text-left font-medium">{t('pm.projects')}</th>
              {NOTIFY_EVENTS.map((e) => (
                <th key={e} className="px-2 py-2 text-center font-medium">
                  {t(`notify.event.${e}` as MsgKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2">
                  <span className="mr-2 font-mono text-xs text-fg-4">{p.key}</span>
                  {p.name}
                </td>
                {NOTIFY_EVENTS.map((e) => {
                  const k = pair(p.id, e)
                  return (
                    <td key={e} className="px-2 py-1 text-center">
                      <label className="inline-flex size-11 cursor-pointer items-center justify-center">
                        <input
                          type="checkbox"
                          className="size-4 accent-accent"
                          checked={!off.has(k)}
                          onChange={(ev) => toggle([k], ev.target.checked)}
                          aria-label={`${p.key} ${t(`notify.event.${e}` as MsgKey)}`}
                        />
                      </label>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-3">{t('notify.hint')}</p>
      {section('active', all.filter((p) => p.state === 'active'))}
      {section('closed', all.filter((p) => p.state === 'closed'))}
      {section('archived', all.filter((p) => p.state === 'archived'))}
    </div>
  )
}
