import { useNavigate } from '@tanstack/react-router'
import { useState, useSyncExternalStore } from 'react'
import { api } from '../../lib/api'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { useDirectory } from '../../lib/session'
import { Button } from '../../ui/button'
import { Dialog } from '../../ui/dialog'
import { Field, Input, Select } from '../../ui/field'
import { toast, toastError } from '../../ui/toast'
import { canWrite, invalidateIssues, useProjects, type IssueRow } from './model'

type Src = Pick<IssueRow, 'ref' | 'title' | 'projectKey'>
let state: Src | null = null
const listeners = new Set<() => void>()
const set = (s: Src | null) => {
  state = s
  listeners.forEach((l) => l())
}
export const openDuplicate = (s: Src) => set(s)

export function DuplicateIssueHost() {
  const open = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
  return open ? <DuplicateDialog src={open} key={open.ref} /> : null
}

const PARTS = ['children', 'attachments', 'labels', 'assignees'] as const

function DuplicateDialog({ src }: { src: Src }) {
  const { t } = useI18n()
  const dir = useDirectory()
  const navigate = useNavigate()
  const projects = useProjects()
  const targets = (projects.data ?? []).filter((p) => canWrite(p.role) && p.state === 'active')
  const [title, setTitle] = useState(src.title)
  const [key, setKey] = useState(src.projectKey)
  const [parts, setParts] = useState<Record<(typeof PARTS)[number], boolean>>({ children: true, attachments: true, labels: true, assignees: true })
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      const r = await api<{ ref: string; count: number; skipped: { labels: string[]; assignees: string[] } }>(`/api/issues/${src.ref}/duplicate`, {
        method: 'POST',
        body: { title: title.trim(), key, ...parts, operationId: crypto.randomUUID() },
      })
      const skipped = [
        r.skipped.labels.length ? t('dup.skippedLabels', { names: r.skipped.labels.join('、') }) : '',
        r.skipped.assignees.length ? t('dup.skippedAssignees', { names: r.skipped.assignees.map((id) => dir.get(id)?.name ?? '?').join('、') }) : '',
      ].filter(Boolean)
      toast(t('dup.done', { ref: r.ref, n: r.count }), skipped.length ? 'info' : 'success', skipped.join(' · ') || undefined)
      invalidateIssues()
      set(null)
      navigate({ to: `/projects/${r.ref.split('-')[0]}/${r.ref}` })
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && set(null)}
      title={t('dup.title', { ref: src.ref })}
      footer={
        <>
          <Button variant="ghost" onClick={() => set(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!title.trim() || !key} onClick={submit}>
            {t('dup.submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('dup.name')}>{(id) => <Input id={id} autoFocus value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && title.trim() && submit()} />}</Field>
        <Field label={t('dup.project')}>
          {(id) => (
            <Select id={id} value={key} onChange={(e) => setKey(e.target.value)}>
              {targets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key} · {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1.5 text-[13px] font-medium text-fg-2">{t('dup.include')}</legend>
          {PARTS.map((p) => (
            <label key={p} className="flex h-10 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-surface-2">
              <input type="checkbox" checked={parts[p]} onChange={(e) => setParts((x) => ({ ...x, [p]: e.target.checked }))} className="size-4 accent-accent" />
              {t(`dup.${p}` as MsgKey)}
            </label>
          ))}
        </fieldset>
        {key !== src.projectKey && <p className="text-xs text-fg-4">{t('dup.crossHint')}</p>}
      </div>
    </Dialog>
  )
}
