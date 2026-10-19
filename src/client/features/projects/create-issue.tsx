import { useQueryClient } from '@tanstack/react-query'
import { Dialog as D } from 'radix-ui'
import { FolderKanban, X } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useScope } from '../../lib/actions'
import { api } from '../../lib/api'
import { useIsMobile } from '../../lib/hooks'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { Button, IconButton } from '../../ui/button'
import { cx } from '../../ui/cx'
import { toast, toastError } from '../../ui/toast'
import { IssueStatusIcon, PriorityIcon } from './icons'
import { canWrite, invalidateIssues, useLabels, useProject, useProjects, type IssueRow, type Priority, type Status } from './model'
import { AssigneeIcon, LabelChip, LabelIcon, OptionPicker, Pill, labelOptions, useAssigneeOptions, usePriorityOptions, useStatusOptions } from './pickers'

type Open = { projectKey?: string; status?: Status; parentRef?: string } | null
let state: Open = null
const listeners = new Set<() => void>()
export function openCreateIssue(o: NonNullable<Open> = {}) {
  state = o
  listeners.forEach((l) => l())
}
const close = () => {
  state = null
  listeners.forEach((l) => l())
}

type Draft = { title: string; description: string; projectKey: string; status: Status; priority: Priority; assigneeIds: string[]; labelIds: string[] }
const DRAFT_KEY = 'ms.issue-draft'
const readDraft = (): Draft | null => {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null')
  } catch {
    return null
  }
}
const writeDraft = (d: Draft | null) => {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d))
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* ignore */
  }
}

export function CreateIssueHost() {
  const open = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
  return open ? <CreateIssueDialog init={open} key={JSON.stringify(open)} /> : null
}

function CreateIssueDialog({ init }: { init: NonNullable<Open> }) {
  const { t } = useI18n()
  const mobile = useIsMobile()
  const qc = useQueryClient()
  const projects = useProjects()
  const writable = (projects.data ?? []).filter((p) => p.state === 'active' && canWrite(p.role))
  const [saved] = useState(readDraft)
  const usable = !!saved && (!init.projectKey || saved.projectKey === init.projectKey) && !!(saved.title || saved.description)
  const [d, setD] = useState<Draft>(() =>
    usable && saved
      ? { ...saved, status: init.status ?? saved.status }
      : { title: '', description: '', projectKey: init.projectKey ?? '', status: init.status ?? 'todo', priority: 'none', assigneeIds: [], labelIds: [] },
  )
  const [restored] = useState(usable)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [pickers, setPickers] = useState<'s' | 'p' | 'a' | 'l' | null>(null)
  const title = useRef<HTMLInputElement>(null)
  useScope('create-issue', true)
  // Default to the first project the user can file into.
  const projectKey = d.projectKey || writable[0]?.key || ''
  useEffect(() => {
    writeDraft(d.title || d.description ? d : null)
  }, [d])
  const project = useProject(projectKey)
  const labels = useLabels(projectKey || undefined)
  const statusOpts = useStatusOptions()
  const prioOpts = usePriorityOptions()
  const memberOpts = useAssigneeOptions(project.data?.members.map((m) => m.userId))
  const dirty = !!(d.title.trim() || d.description.trim())

  const requestClose = () => {
    if (dirty) setAsking(true)
    else close()
  }
  const submit = async () => {
    if (!d.title.trim() || !projectKey || busy) return
    setBusy(true)
    try {
      const r = await api<{ issue: IssueRow }>(`/api/projects/${projectKey}/issues`, {
        method: 'POST',
        body: { title: d.title.trim(), description: d.description, status: d.status, priority: d.priority, assigneeIds: d.assigneeIds, labelIds: d.labelIds, parentRef: init.parentRef ?? null, operationId: crypto.randomUUID() },
      })
      toast(t('create.created', { ref: r.issue.ref }))
      invalidateIssues()
      qc.invalidateQueries({ queryKey: ['issue'] })
      writeDraft(null)
      if (more) {
        setD((x) => ({ ...x, title: '', description: '' }))
        title.current?.focus()
      } else close()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
      return
    }
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 's' || k === 'p' || k === 'a' || k === 'l') {
      e.preventDefault()
      setPickers(k)
    }
  }

  return (
    <D.Root open onOpenChange={(o) => !o && requestClose()}>
      <D.Portal>
        <D.Overlay className="anim-fade fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
        <D.Content
          data-layer
          onKeyDown={onKey}
          onEscapeKeyDown={(e) => {
            e.preventDefault()
            if (!asking) requestClose()
          }}
          onPointerDownOutside={(e) => {
            e.preventDefault()
            requestClose()
          }}
          aria-describedby={undefined}
          className={cx(
            'fixed z-50 flex flex-col bg-surface shadow-card focus:outline-none',
            mobile ? 'anim-sheet inset-0 pt-safe pb-safe' : 'anim-pop top-[12vh] left-1/2 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 rounded-2xl border border-line',
          )}
        >
          <div className="flex items-center gap-2 px-5 pt-4">
            <OptionPicker
              options={writable.map((p) => ({ value: p.key, label: `${p.key} · ${p.name}` }))}
              value={[projectKey]}
              onChange={([k]) => setD((x) => ({ ...x, projectKey: k!, labelIds: [], assigneeIds: [] }))}
              placeholder={t('issue.project')}
              trigger={
                <Pill icon={<FolderKanban className="size-4 text-fg-4" />} aria-label={t('issue.project')}>
                  {projectKey || t('create.noProject')}
                </Pill>
              }
            />
            <D.Title className="text-sm font-medium text-fg-3">{t('create.title')}</D.Title>
            <div className="flex-1" />
            <IconButton label={t('common.close')} shortcut="Esc" icon={<X />} size="sm" onClick={requestClose} />
          </div>
          {restored && <div className="mx-5 mt-2 rounded-lg bg-info-soft px-3 py-1.5 text-xs text-info">{t('create.restored')}</div>}
          <div className="flex min-h-0 flex-1 flex-col px-5 pt-3">
            <input
              ref={title}
              autoFocus
              value={d.title}
              onChange={(e) => setD((x) => ({ ...x, title: e.target.value }))}
              placeholder={t('issue.titlePh')}
              aria-label={t('issue.titlePh')}
              className="h-10 bg-transparent text-lg font-semibold placeholder:text-fg-4 focus:outline-none"
            />
            <textarea
              value={d.description}
              onChange={(e) => setD((x) => ({ ...x, description: e.target.value }))}
              placeholder={t('issue.descPh')}
              aria-label={t('issue.descPh')}
              className="min-h-32 flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed placeholder:text-fg-4 focus:outline-none md:max-h-[40vh]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto px-5 pb-3 [scrollbar-width:none] max-md:flex-nowrap">
            <OptionPicker
              options={statusOpts}
              value={[d.status]}
              onChange={([s]) => setD((x) => ({ ...x, status: s as Status }))}
              placeholder={t('picker.status')}
              open={pickers === 's'}
              onOpenChange={(o) => setPickers(o ? 's' : null)}
              trigger={
                <Pill icon={<IssueStatusIcon status={d.status} />} hotkey="S" aria-label={t('issue.status')}>
                  {t(`status.${d.status}` as MsgKey)}
                </Pill>
              }
            />
            <OptionPicker
              options={prioOpts}
              value={[d.priority]}
              onChange={([p]) => setD((x) => ({ ...x, priority: p as Priority }))}
              placeholder={t('picker.priority')}
              open={pickers === 'p'}
              onOpenChange={(o) => setPickers(o ? 'p' : null)}
              trigger={
                <Pill icon={<PriorityIcon priority={d.priority} />} hotkey="P" aria-label={t('issue.priority')}>
                  {t(`priority.${d.priority}` as MsgKey)}
                </Pill>
              }
            />
            <OptionPicker
              options={memberOpts}
              multiple
              value={d.assigneeIds}
              onChange={(ids) => setD((x) => ({ ...x, assigneeIds: ids }))}
              placeholder={t('picker.assignee')}
              open={pickers === 'a'}
              onOpenChange={(o) => setPickers(o ? 'a' : null)}
              trigger={
                <Pill icon={<AssigneeIcon />} hotkey="A" aria-label={t('issue.assignees')}>
                  {d.assigneeIds.length ? memberOpts.filter((m) => d.assigneeIds.includes(m.value)).map((m) => m.label).join('、') : t('issue.assignees')}
                </Pill>
              }
            />
            <OptionPicker
              options={labelOptions(labels.data ?? [])}
              multiple
              value={d.labelIds}
              onChange={(ids) => setD((x) => ({ ...x, labelIds: ids }))}
              placeholder={t('picker.labels')}
              open={pickers === 'l'}
              onOpenChange={(o) => setPickers(o ? 'l' : null)}
              trigger={
                <Pill icon={<LabelIcon />} hotkey="L" aria-label={t('issue.labels')}>
                  {d.labelIds.length ? (
                    <span className="flex gap-1">
                      {(labels.data ?? []).filter((l) => d.labelIds.includes(l.id)).map((l) => <LabelChip key={l.id} label={l} />)}
                    </span>
                  ) : (
                    t('issue.labels')
                  )}
                </Pill>
              }
            />
          </div>
          <div className="flex items-center gap-3 border-t border-line px-5 py-3">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-fg-3 select-none">
              <input type="checkbox" checked={more} onChange={(e) => setMore(e.target.checked)} className="size-4 accent-accent" />
              {t('create.continuous')}
            </label>
            <div className="flex-1" />
            <Button variant="primary" loading={busy} disabled={!d.title.trim() || !projectKey} onClick={submit} title="Ctrl/⌘ + Enter">
              {t('create.submit')}
            </Button>
          </div>
          {asking && (
            <DraftPrompt
              onCancel={() => setAsking(false)}
              onDiscard={() => {
                writeDraft(null)
                close()
              }}
              onKeep={() => close()}
            />
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

/** Three choices on closing a dirty draft; focus starts on "Keep". Separate from the shared confirm. */
function DraftPrompt({ onCancel, onDiscard, onKeep }: { onCancel(): void; onDiscard(): void; onKeep(): void }) {
  const { t } = useI18n()
  useScope('draft-prompt', true)
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-overlay p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <div role="alertdialog" aria-labelledby="draft-title" data-layer className="anim-pop w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div id="draft-title" className="font-semibold">
          {t('create.discardTitle')}
        </div>
        <p className="mt-1 text-sm text-fg-3">{t('create.discardBody')}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={onDiscard}>
            {t('create.discard')}
          </Button>
          <Button variant="primary" autoFocus onClick={onKeep}>
            {t('create.keep')}
          </Button>
        </div>
      </div>
    </div>
  )
}
