import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, BellOff, BellRing, CalendarDays, ChevronLeft, ChevronRight, CircleSlash, CopyPlus, Download, FileText, FolderKanban, HardDrive, Link2, Paperclip, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useActions } from '../../lib/actions'
import { ApiError, api } from '../../lib/api'
import { useIsMobile } from '../../lib/hooks'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { renderMarkdown } from '../../lib/markdown'
import { useDirectory, useMe } from '../../lib/session'
import { AvatarStack, UserAvatar, UserName } from '../../ui/avatar'
import { Button, IconButton } from '../../ui/button'
import { cx } from '../../ui/cx'
import { Input, Textarea } from '../../ui/field'
import { Badge, Card, EmptyState, Skeleton, Spinner } from '../../ui/misc'
import { Segmented } from '../../ui/tabs'
import { toast, toastError } from '../../ui/toast'
import { Tooltip } from '../../ui/tooltip'
import { driveName, iconFor, useFiles } from '../files/files-panel'
import { compressImage, fileUrl, uploadFile } from '../../lib/upload'
import { confirm } from '../../ui/dialog'
import { Composer } from '../notes/comments'
import { annotateImage } from '../files/annotate'
import { DrivePickerButton } from '../files/drive'
import { Html } from '../notes/preview'
import { markEntityRead, useUnreadIssues } from '../../app/notifications'
import { openDuplicate } from './duplicate-issue'
import { StaleBadge } from './issue-views'
import { IssueStatusIcon, PriorityIcon } from './icons'
import { canWrite, invalidateIssues, isDone, readNav, useLabels, useProject, type IssuePatch, type IssueRow, type Status } from './model'
import { AssigneeIcon, LabelChip, LabelIcon, OptionPicker, labelOptions, useAssigneeOptions, usePriorityOptions, useStatusOptions } from './pickers'

type Detail = {
  subscribed: boolean
  issue: IssueRow & { role: 'viewer' | 'member' | 'owner' | 'admin'; projectState: string; projectName: string }
  relations: { type: string; ref: string; title: string; status: string }[]
  children: { ref: string; title: string; status: string; assigneeIds: string[] }[]
  mentionedIn: { id: string; title: string; startsAt: number }[]
}

export function IssuePage({ projectKey, issueRef }: { projectKey: string; issueRef: string }) {
  const q = useQuery({ queryKey: ['issue', issueRef], queryFn: () => api<Detail>(`/api/issues/${issueRef}`), refetchInterval: 20_000 })
  if (q.isPending)
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-48" />
      </div>
    )
  if (q.isError) throw q.error
  return <IssueView d={q.data} projectKey={projectKey} issueRef={issueRef} />
}

function IssueView({ d, projectKey, issueRef }: { d: Detail; projectKey: string; issueRef: string }) {
  const { t, fmt } = useI18n()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const project = useProject(projectKey)
  const labels = useLabels(projectKey)
  // The version this page started from; a newer one from polling means someone else edited.
  const [base, setBase] = useState<number | null>(d.issue.version)
  const mobile = useIsMobile()
  const nav = useMemo(() => readNav(), [])
  const idx = nav?.refs.indexOf(issueRef) ?? -1
  const go = (d: number) => {
    const r = nav?.refs[idx + d]
    if (r) navigate({ to: `/projects/${r.split('-')[0]}/${r}` })
  }
  useActions([
    { id: 'issue-prev', label: 'pm.prev', keys: '[', group: 'nav.projects', run: () => go(-1) },
    { id: 'issue-next', label: 'pm.next', keys: ']', group: 'nav.projects', run: () => go(1) },
  ])
  const i = d.issue
  // Opening an issue reads its notifications.
  const unread = useUnreadIssues()
  useEffect(() => {
    if (unread.has(i.id)) markEntityRead(i.id)
  }, [unread, i.id])
  const editable = canWrite(i.role) && i.projectState === 'active'
  const conflict = base !== null && i.version > base
  const save = async (patch: IssuePatch) => {
    try {
      const r = await api<{ issue: IssueRow }>(`/api/issues/${i.ref}`, { method: 'PATCH', body: { version: i.version, ...patch } })
      setBase(r.issue.version)
      qc.setQueryData<Detail>(['issue', i.ref], (old) => (old ? { ...old, issue: { ...old.issue, ...r.issue, ...patch, version: r.issue.version } } : old))
      invalidateIssues()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'conflict') toast(t('error.conflict'), 'error')
      else toastError(err)
      qc.invalidateQueries({ queryKey: ['issue', i.ref] }).then(() => setBase(qc.getQueryData<Detail>(['issue', i.ref])?.issue.version ?? null))
    }
  }
  const back = nav?.from && nav.refs.includes(issueRef) ? nav.from : `/projects/${projectKey}`

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 md:px-6">
      <div className="mb-4 flex items-center gap-2">
        <Button asChild size="sm" variant="ghost" icon={<ArrowLeft className="size-4" />}>
          <Link to={back}>{projectKey}</Link>
        </Button>
        <span className="font-mono text-sm text-fg-4">{i.ref}</span>
        <div className="flex-1" />
        <IconButton
          label={d.subscribed ? t('issue.unsubscribe') : t('issue.subscribe')}
          icon={d.subscribed ? <BellRing /> : <BellOff />}
          size="sm"
          aria-pressed={d.subscribed}
          onClick={() =>
            api(`/api/issues/${i.ref}/subscription`, { method: 'PUT', body: { on: !d.subscribed } }).then(
              (r) => qc.setQueryData<Detail>(['issue', i.ref], (old) => (old ? { ...old, ...(r as { subscribed: boolean }) } : old)),
              (e) => toastError(e),
            )
          }
        />
        {canWrite(i.role) && <IconButton label={t('dup.action')} icon={<CopyPlus />} size="sm" onClick={() => openDuplicate(i)} />}
        {idx >= 0 && nav && (
          <div className="flex items-center gap-1 text-xs text-fg-4">
            <IconButton label={t('pm.prev')} shortcut="[" icon={<ChevronLeft />} size="sm" disabled={idx === 0} onClick={() => go(-1)} />
            {idx + 1} / {nav.refs.length}
            <IconButton label={t('pm.next')} shortcut="]" icon={<ChevronRight />} size="sm" disabled={idx >= nav.refs.length - 1} onClick={() => go(1)} />
          </div>
        )}
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex min-w-0 flex-col gap-4 lg:pr-4">
          <AnimatePresence>
            {conflict && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-3 rounded-xl bg-warning-soft px-4 py-2.5 text-sm text-warning">
                <RefreshCw className="size-4" />
                <span className="flex-1">{t('issue.conflict')}</span>
                <Button size="sm" onClick={() => (setBase(i.version), qc.invalidateQueries({ queryKey: ['issue', i.ref] }))}>
                  {t('issue.reload')}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
          {(i.parent || i.blockedBy.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {i.parent && (
                <Link to={`/projects/${i.parent.ref.split('-')[0]}/${i.parent.ref}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-fg-3 hover:border-accent">
                  <span className="font-mono">{i.parent.ref}</span>
                  <span className="max-w-60 truncate">{i.parent.title}</span>
                </Link>
              )}
              {i.blockedBy.length > 0 && (
                <Tooltip label={i.blockedBy.map((b) => `${b.ref} ${b.title}`).join('\n')}>
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-1 font-medium text-warning">
                    <CircleSlash className="size-3.5" />
                    {t('pm.blockedBy', { n: i.blockedBy.length })}
                  </span>
                </Tooltip>
              )}
            </div>
          )}
          <Title issue={i} editable={editable} onSave={(title) => save({ title })} />
          {/* Phones: properties sit right under the title, folded by default. */}
          {mobile && (
            <details className="group rounded-2xl border border-line bg-surface">
              <summary className="flex h-11 cursor-pointer items-center gap-2 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                <IssueStatusIcon status={i.status} />
                {t(`status.${i.status}` as MsgKey)}
                <PriorityIcon priority={i.priority} />
                <AvatarStack ids={i.assigneeIds} max={3} size="xs" />
                <ChevronRight className="ml-auto size-4 text-fg-4 transition-transform group-open:rotate-90" />
              </summary>
              <div className="border-t border-line">
                <Properties issue={i} editable={editable} labels={labels.data ?? []} memberIds={project.data?.members.map((m) => m.userId)} onSave={save} />
              </div>
            </details>
          )}
          <Description issue={i} editable={editable} onSave={(description) => save({ description })} onToggled={() => qc.invalidateQueries({ queryKey: ['issue', i.ref] })} />
          <IssueBody d={d} editable={editable} />
          {d.mentionedIn.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">{t('issue.mentionedIn')}</h2>
              <div className="flex flex-col gap-1.5">
                {d.mentionedIn.map((n) => (
                  <Link key={n.id} to={`/notes/${n.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                    <FileText className="size-4 text-fg-4" />
                    <span className="flex-1 truncate">{n.title}</span>
                    <span className="text-xs text-fg-4">{fmt.date(n.startsAt)}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          <hr className="border-line" />
          <Timeline issueRef={i.ref} issueId={i.id} editable={canWrite(i.role)} memberIds={project.data?.members.map((m) => m.userId)} />
        </div>
        <aside className="flex flex-col gap-5 lg:sticky lg:top-5 lg:self-start lg:border-l lg:border-line lg:pl-5">
          {!mobile && <Properties issue={i} editable={editable} labels={labels.data ?? []} memberIds={project.data?.members.map((m) => m.userId)} onSave={save} />}
          <div className="flex flex-col gap-2 px-2 text-xs text-fg-4">
            <span className="flex items-center gap-1.5">
              <UserAvatar id={i.createdBy} size="xs" />
              <UserName id={i.createdBy} className="text-fg-3" />
              <span title={fmt.dateTime(i.createdAt)}>· {fmt.relative(i.createdAt)}</span>
            </span>
            <span className="self-start">
              <StaleBadge issue={i} withText />
            </span>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Title({ issue, editable, onSave }: { issue: IssueRow; editable: boolean; onSave(t: string): void }) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(issue.title)
  if (editing)
    return (
      <Input
        autoFocus
        value={v}
        aria-label={t('issue.titlePh')}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (v.trim() && v.trim() !== issue.title) onSave(v.trim())
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setV(issue.title)
            setEditing(false)
          }
        }}
        className="h-auto py-1 text-xl font-bold"
      />
    )
  return (
    <h1
      onClick={() => editable && (setV(issue.title), setEditing(true))}
      className={cx('text-xl font-bold tracking-tight md:text-2xl', editable && 'cursor-text rounded-lg hover:bg-surface-2', issue.status === 'canceled' && 'text-fg-4 line-through')}
    >
      {issue.title}
    </h1>
  )
}

function Description({ issue, editable, onSave, onToggled }: { issue: IssueRow; editable: boolean; onSave(d: string): void; onToggled(): void }) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(issue.description)
  const html = useMemo(() => renderMarkdown(issue.description).replaceAll(' disabled=""', editable ? '' : ' disabled=""'), [issue.description, editable])
  const box = useRef<HTMLDivElement>(null)
  const onClick = async (e: React.MouseEvent) => {
    const el = e.target as HTMLInputElement
    if (el.tagName !== 'INPUT' || el.type !== 'checkbox' || !editable) return
    e.preventDefault()
    e.stopPropagation()
    const boxes = [...(box.current?.querySelectorAll('input[type=checkbox]') ?? [])]
    const index = boxes.indexOf(el)
    const lines = issue.description.split('\n').filter((l) => /^\s*[-*] \[[ xX]\]/.test(l))
    try {
      await api(`/api/issues/${issue.ref}/checkbox`, { method: 'POST', body: { version: issue.version, index, line: lines[index] ?? '', checked: !el.checked } })
      onToggled()
      invalidateIssues()
    } catch (err) {
      toastError(err)
      onToggled()
    }
  }
  if (editing)
    return (
      <div className="flex flex-col gap-2">
        <Textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={t('issue.descPh')} className="min-h-40 font-mono text-[13px]" />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => (setV(issue.description), setEditing(false))}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" variant="primary" onClick={() => (onSave(v), setEditing(false))}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    )
  if (!issue.description.trim())
    return editable ? (
      <button onClick={() => setEditing(true)} className="-mx-2 rounded-lg px-2 py-1 text-left text-[15px] text-fg-4 hover:bg-surface-2">
        {t('issue.descAdd')}
      </button>
    ) : null
  return (
    <div ref={box} onClick={onClick} onDoubleClick={() => editable && (setV(issue.description), setEditing(true))} className={cx('-mx-2 rounded-lg px-2', editable && 'cursor-text hover:bg-surface-2/50')}>
      <Tooltip label={editable ? t('issue.editDesc') : undefined} side="left">
        <div>
          <Html html={html} className="prose-md text-[15px]" />
        </div>
      </Tooltip>
    </div>
  )
}

const withAnnotation = async (list: File[]) => {
  const out: File[] = []
  for (const f of list) out.push(await annotateImage(f))
  return out
}

type FileRow = { id: string; name: string; mime: string; size: number; kind: 'image' | 'file' | 'drive'; ownerId: string; createdAt: number; driveUrl: string | null }

/**
 * Linear-style body chrome: a row of small actions under the description, then compact
 * lists (attachments, sub-issues, relations) that only appear once they have content.
 */
function IssueBody({ d, editable }: { d: Detail; editable: boolean }) {
  const { t, fmt } = useI18n()
  const me = useMe()
  const qc = useQueryClient()
  const i = d.issue
  const files = useFiles('issue', i.id)
  const [pending, setPending] = useState<{ key: string; name: string; pct: number }[]>([])
  const [addingSub, setAddingSub] = useState(false)
  const [addingRel, setAddingRel] = useState(false)
  const [drive, setDrive] = useState(false)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const refreshFiles = () => qc.invalidateQueries({ queryKey: ['files', 'issue', i.id] })

  const upload = async (list: File[]) => {
    for (const raw of list) {
      const key = crypto.randomUUID()
      setPending((p) => [...p, { key, name: raw.name, pct: 0 }])
      try {
        await uploadFile(await compressImage(raw), { parentType: 'issue', parentId: i.id }, { onProgress: (pct) => setPending((p) => p.map((x) => (x.key === key ? { ...x, pct } : x))) })
        refreshFiles()
      } catch (err) {
        toastError(err, { label: t('common.retry'), run: () => upload([raw]) })
      } finally {
        setPending((p) => p.filter((x) => x.key !== key))
      }
    }
  }
  const items = (files.data ?? []) as FileRow[]
  // Pasting files anywhere on the page (outside text fields) attaches them; images open the annotator first.
  const uploadRef = useRef(upload)
  useEffect(() => {
    uploadRef.current = upload
  })
  useEffect(() => {
    if (!editable) return
    const on = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, [contenteditable="true"]')) return
      const list = [...(e.clipboardData?.files ?? [])]
      if (!list.length) return
      e.preventDefault()
      withAnnotation(list).then((f) => uploadRef.current(f))
    }
    document.addEventListener('paste', on)
    return () => document.removeEventListener('paste', on)
  }, [editable])

  return (
    <div
      className={cx('-mx-2 flex flex-col gap-4 rounded-xl px-2 transition-colors', over && 'bg-accent-soft')}
      onDragOver={(e) => {
        if (!editable || !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        if (!editable) return
        e.preventDefault()
        setOver(false)
        withAnnotation([...e.dataTransfer.files]).then(upload)
      }}
    >
      {editable && (
        <div className="flex items-center gap-1">
          <IconButton label={t('files.upload')} icon={<Paperclip />} size="sm" onClick={() => input.current?.click()} />
          <IconButton label={t('files.linkDrive')} icon={<HardDrive />} size="sm" onClick={() => setDrive((v) => !v)} />
          <DrivePickerButton parentType="issue" parentId={i.id} onLinked={refreshFiles} />
          <input ref={input} type="file" multiple hidden onChange={(e) => (upload([...(e.target.files ?? [])]), (e.target.value = ''))} />
        </div>
      )}
      <AnimatePresence initial={false}>
        {drive && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <DriveLink issueId={i.id} onDone={() => (setDrive(false), refreshFiles())} />
          </motion.div>
        )}
      </AnimatePresence>

      {(items.length > 0 || pending.length > 0) && (
        <ul className="flex flex-col">
          {pending.map((p) => (
            <li key={p.key} className="flex h-9 items-center gap-2.5 px-1 text-sm text-fg-3">
              <Spinner className="size-4" />
              <span className="flex-1 truncate">{p.name}</span>
              <span className="text-xs">{p.pct}%</span>
            </li>
          ))}
          {items.map((f) => {
            const Icon = iconFor(f)
            const open = () => (f.kind === 'drive' ? window.open(f.driveUrl!, '_blank', 'noopener') : window.open(fileUrl(f.id), '_blank', 'noopener'))
            return (
              <li key={f.id} className="group flex h-9 items-center gap-2.5 rounded-lg px-1 text-sm hover:bg-surface-2">
                {f.kind === 'image' ? <img src={fileUrl(f.id)} alt="" className="size-6 rounded object-cover" loading="lazy" /> : <Icon className="size-4 shrink-0 text-fg-4" />}
                <button onClick={open} className="min-w-0 flex-1 truncate text-left hover:text-accent-text">
                  {f.name}
                </button>
                <span className="shrink-0 text-xs text-fg-4">{f.kind === 'drive' ? 'Drive' : fmt.bytes(f.size)}</span>
                {f.kind !== 'drive' && <IconButton label={t('files.download')} icon={<Download />} size="sm" className="size-7 opacity-0 group-hover:opacity-100 max-md:opacity-100" onClick={() => (location.href = `${fileUrl(f.id)}?download=1`)} />}
                {(f.ownerId === me.id || me.role !== 'student') && (
                  <IconButton
                    label={t('common.delete')}
                    icon={<Trash2 />}
                    size="sm"
                    className="size-7 opacity-0 group-hover:opacity-100 max-md:opacity-100"
                    onClick={async () => {
                      if (await confirm({ title: t('common.delete'), body: t('files.deleteConfirm', { name: f.name }), danger: true })) api(`/api/files/${f.id}`, { method: 'DELETE' }).then(refreshFiles, (e) => toastError(e))
                    }}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      <SubIssues d={d} editable={editable} adding={addingSub} setAdding={setAddingSub} />
      <Relations d={d} editable={editable} adding={addingRel} setAdding={setAddingRel} />

      {editable && (!addingSub || !addingRel) && (
        <div className="flex flex-wrap gap-1">
          {!addingSub && !d.children.length && (
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAddingSub(true)}>
              {t('issue.addSubShort')}
            </Button>
          )}
          {!addingRel && (
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAddingRel(true)}>
              {t('pm.relation')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function DriveLink({ issueId, onDone }: { issueId: string; onDone(): void }) {
  const { t } = useI18n()
  const [url, setUrl] = useState('')
  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await api('/api/files/drive', { method: 'POST', body: { parentType: 'issue', parentId: issueId, url, name: driveName(url) } })
          onDone()
        } catch (err) {
          toastError(err)
        }
      }}
    >
      <Input autoFocus type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('files.drivePh')} aria-label={t('files.drivePh')} className="h-9" />
      <Button type="submit" size="sm" variant="primary" disabled={!/^https:\/\/(drive|docs)\.google\.com\//.test(url)}>
        {t('common.save')}
      </Button>
    </form>
  )
}

function SubIssues({ d, editable, adding, setAdding }: { d: Detail; editable: boolean; adding: boolean; setAdding(v: boolean): void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const done = d.children.filter((c) => isDone(c.status)).length
  if (!d.children.length && !adding) return null
  return (
    <section>
      <div className="mb-1 flex items-center gap-3">
        <h2 className="text-[13px] font-semibold text-fg-2">{t('issue.subissues')}</h2>
        {d.children.length > 0 && (
          <>
            <div className="h-1 w-24 overflow-hidden rounded-full bg-surface-3">
              <motion.div className="h-full bg-success" animate={{ width: `${(done / d.children.length) * 100}%` }} />
            </div>
            <span className="text-xs text-fg-4">
              {done}/{d.children.length}
            </span>
          </>
        )}
      </div>
      <ul>
        {d.children.map((c) => (
          <li key={c.ref}>
            <Link to={`/projects/${c.ref.split('-')[0]}/${c.ref}`} className="flex h-9 items-center gap-2 rounded-lg px-1 text-sm hover:bg-surface-2">
              <IssueStatusIcon status={c.status} />
              <span className="font-mono text-xs text-fg-4">{c.ref}</span>
              <span className={cx('flex-1 truncate', c.status === 'canceled' && 'line-through')}>{c.title}</span>
              <AvatarStack ids={c.assigneeIds} max={2} size="xs" />
            </Link>
          </li>
        ))}
      </ul>
      {editable && (
        <div className="flex h-9 items-center gap-2 px-1">
          <Plus className="size-4 text-fg-4" />
          <input
            autoFocus={adding && !d.children.length}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => !title && !d.children.length && setAdding(false)}
            placeholder={t('issue.addSub')}
            aria-label={t('issue.addSub')}
            className="h-8 flex-1 bg-transparent text-sm focus:outline-none"
            onKeyDown={async (e) => {
              if (e.key === 'Escape') setAdding(false)
              if (e.key !== 'Enter' || !title.trim()) return
              try {
                await api(`/api/projects/${d.issue.projectKey}/issues`, { method: 'POST', body: { title: title.trim(), parentRef: d.issue.ref, operationId: crypto.randomUUID() } })
                setTitle('')
                qc.invalidateQueries({ queryKey: ['issue', d.issue.ref] })
                invalidateIssues()
              } catch (err) {
                toastError(err)
              }
            }}
          />
        </div>
      )}
    </section>
  )
}

function Relations({ d, editable, adding, setAdding }: { d: Detail; editable: boolean; adding: boolean; setAdding(v: boolean): void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [type, setType] = useState<'blocks' | 'blocked_by' | 'relates' | 'duplicate_of'>('relates')
  const [q, setQ] = useState('')
  const search = useQuery({
    queryKey: ['search', q],
    queryFn: () => api<{ items: { type: string; id: string; title: string }[] }>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
  })
  const hits = (search.data?.items ?? []).filter((h) => h.type === 'issue' && h.id !== d.issue.ref)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['issue', d.issue.ref] })
    invalidateIssues()
  }
  if (!d.relations.length && !adding) return null
  return (
    <section>
      <h2 className="mb-1 text-[13px] font-semibold text-fg-2">{t('issue.relations')}</h2>
      <ul>
        {d.relations.map((r) => (
          <li key={`${r.type}:${r.ref}`} className="group flex h-9 items-center gap-2 rounded-lg px-1 text-sm hover:bg-surface-2">
            <Badge tone={r.type === 'blocked_by' && !isDone(r.status) ? 'warning' : 'neutral'}>{t(`pm.rel.${r.type}` as MsgKey)}</Badge>
            <IssueStatusIcon status={r.status} />
            <Link to={`/projects/${r.ref.split('-')[0]}/${r.ref}`} className="flex min-w-0 flex-1 items-center gap-2">
              <span className="font-mono text-xs text-fg-4">{r.ref}</span>
              <span className="truncate">{r.title}</span>
            </Link>
            {editable && (
              <IconButton
                label={t('common.delete')}
                icon={<X />}
                size="sm"
                className="size-7 opacity-0 group-hover:opacity-100 max-md:opacity-100"
                onClick={() => api(`/api/issues/${d.issue.ref}/relations`, { method: 'DELETE', body: { type: r.type, target: r.ref } }).then(refresh, (e) => toastError(e))}
              />
            )}
          </li>
        ))}
      </ul>
      {editable && adding && (
        <div className="relative mt-1 flex flex-wrap items-center gap-2">
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label={t('pm.relation')} className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px]">
            {(['relates', 'blocks', 'blocked_by', 'duplicate_of'] as const).map((x) => (
              <option key={x} value={x}>
                {t(`pm.rel.${x}` as MsgKey)}
              </option>
            ))}
          </select>
          <div className="relative min-w-48 flex-1">
            <Link2 className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-4" />
            <input
              autoFocus={adding && !d.relations.length}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
              placeholder={t('pm.rel.pick')}
              aria-label={t('pm.rel.pick')}
              className="h-8 w-full rounded-lg border border-line bg-surface pr-2 pl-8 text-[13px] focus:border-accent focus:outline-none"
            />
            {hits.length > 0 && (
              <div className="absolute top-9 right-0 left-0 z-20 rounded-xl border border-line bg-surface p-1 shadow-card">
                {hits.map((h) => (
                  <button
                    key={h.id}
                    onClick={() =>
                      api(`/api/issues/${d.issue.ref}/relations`, { method: 'POST', body: { type, target: h.id } }).then(
                        () => (setQ(''), setAdding(false), refresh()),
                        (e) => toastError(e),
                      )
                    }
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                  >
                    <span className="font-mono text-xs text-fg-4">{h.id}</span>
                    <span className="truncate">{h.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/** Right column, Linear-style: plain rows grouped under small headings, no boxes. */
function Properties({ issue, editable, labels, memberIds, onSave }: { issue: IssueRow; editable: boolean; labels: { id: string; name: string; color: number }[]; memberIds?: string[]; onSave(p: IssuePatch): void }) {
  const { t } = useI18n()
  const statusOpts = useStatusOptions()
  const prioOpts = usePriorityOptions()
  const memberOpts = useAssigneeOptions(memberIds)
  const [open, setOpen] = useState<'s' | 'p' | 'a' | 'l' | null>(null)
  useActions(
    editable
      ? [
          { id: 'detail-s', label: 'picker.status', keys: 's', group: 'nav.projects', run: () => setOpen('s') },
          { id: 'detail-p', label: 'picker.priority', keys: 'p', group: 'nav.projects', run: () => setOpen('p') },
          { id: 'detail-a', label: 'picker.assignee', keys: 'a', group: 'nav.projects', run: () => setOpen('a') },
          { id: 'detail-l', label: 'picker.labels', keys: 'l', group: 'nav.projects', run: () => setOpen('l') },
        ]
      : [],
  )
  const row = 'flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] text-fg-2 transition-colors hover:bg-surface-2 disabled:hover:bg-transparent max-md:h-10'
  const heading = 'mb-1 px-2 text-xs font-medium text-fg-4'
  return (
    <div className="flex flex-col gap-5 p-2 lg:p-0">
      <div>
        <div className={heading}>{t('issue.properties')}</div>
        <OptionPicker options={statusOpts} value={[issue.status]} onChange={([s]) => onSave({ status: s as Status })} placeholder={t('picker.status')} open={open === 's'} onOpenChange={(o) => setOpen(o ? 's' : null)}
          trigger={<button disabled={!editable} aria-label={t('issue.status')} className={row}><IssueStatusIcon status={issue.status} />{t(`status.${issue.status}` as MsgKey)}</button>} />
        <OptionPicker options={prioOpts} value={[issue.priority]} onChange={([p]) => onSave({ priority: p as IssueRow['priority'] })} placeholder={t('picker.priority')} open={open === 'p'} onOpenChange={(o) => setOpen(o ? 'p' : null)}
          trigger={<button disabled={!editable} aria-label={t('issue.priority')} className={row}><PriorityIcon priority={issue.priority} /><span className={cx(issue.priority === 'none' && 'text-fg-4')}>{issue.priority === 'none' ? t('issue.setPriority') : t(`priority.${issue.priority}` as MsgKey)}</span></button>} />
        <OptionPicker options={memberOpts} multiple value={issue.assigneeIds} onChange={(ids) => onSave({ assigneeIds: ids })} placeholder={t('picker.assignee')} open={open === 'a'} onOpenChange={(o) => setOpen(o ? 'a' : null)}
          trigger={
            <button disabled={!editable} aria-label={t('issue.assignees')} className={row}>
              {issue.assigneeIds.length ? <AvatarStack ids={issue.assigneeIds} max={3} size="xs" /> : <AssigneeIcon />}
              <span className={cx('truncate', !issue.assigneeIds.length && 'text-fg-4')}>{issue.assigneeIds.length ? <AssigneeNames ids={issue.assigneeIds} /> : t('issue.assign')}</span>
            </button>
          } />
        <label className={cx(row, 'cursor-pointer')}>
          <CalendarDays className="size-4 shrink-0 text-fg-4" />
          <input
            type="date"
            disabled={!editable}
            aria-label={t('issue.due')}
            value={issue.dueAt ? new Date(issue.dueAt).toISOString().slice(0, 10) : ''}
            onChange={(e) => onSave({ dueAt: e.target.value ? new Date(`${e.target.value}T23:59:00`).getTime() : null })}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-fg-2 focus:outline-none"
          />
        </label>
      </div>
      <div>
        <div className={heading}>{t('issue.labels')}</div>
        <OptionPicker options={labelOptions(labels)} multiple value={issue.labels.map((l) => l.id)} onChange={(ids) => onSave({ labelIds: ids })} placeholder={t('picker.labels')} open={open === 'l'} onOpenChange={(o) => setOpen(o ? 'l' : null)}
          trigger={
            <button disabled={!editable} aria-label={t('issue.labels')} className={cx(row, 'h-auto min-h-8 flex-wrap py-1')}>
              {issue.labels.length ? issue.labels.map((l) => <LabelChip key={l.id} label={l} />) : (<><LabelIcon /><span className="text-fg-4">{t('issue.addLabel')}</span></>)}
            </button>
          } />
      </div>
      <div>
        <div className={heading}>{t('issue.project')}</div>
        <Link to={`/projects/${issue.projectKey}`} className={row}>
          <FolderKanban className="size-4 text-fg-4" />
          <span className="truncate">{issue.projectKey}</span>
        </Link>
      </div>
    </div>
  )
}

function AssigneeNames({ ids }: { ids: string[] }) {
  const dir = useDirectory()
  return <>{ids.map((id) => dir.get(id)?.name ?? '…').join('、')}</>
}

type TimelineItem =
  | { kind: 'comment'; at: number; comment: { id: string; parentId: string | null; authorId: string; body: string; createdAt: number; editedAt: number | null; deletedAt: number | null; version: number } }
  | { kind: 'change'; at: number; change: { id: string; actorId: string | null; action: string; data: Record<string, unknown>; source: string; createdAt: number } }

function Timeline({ issueRef, issueId, editable, memberIds }: { issueRef: string; issueId: string; editable: boolean; memberIds?: string[] }) {
  const { t, fmt } = useI18n()
  const me = useMe()
  const qc = useQueryClient()
  const [kind, setKind] = useState<'all' | 'comments' | 'changes'>('all')
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const q = useInfiniteQuery({
    queryKey: ['issue-timeline', issueRef, kind, order],
    queryFn: ({ pageParam }) => api<{ items: TimelineItem[]; next: number | null }>(`/api/issues/${issueRef}/timeline?kind=${kind}&order=${order}${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (p) => p.next ?? undefined,
    refetchInterval: 20_000,
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  const describe = useChangeText()
  const refresh = () => qc.invalidateQueries({ queryKey: ['issue-timeline', issueRef] })
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">{t('issue.activity')}</h2>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: t('issue.filter.all') },
            { value: 'comments', label: t('issue.filter.comments') },
            { value: 'changes', label: t('issue.filter.changes') },
          ]}
        />
        <Button size="sm" variant="ghost" onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}>
          {order === 'asc' ? t('issue.oldest') : t('issue.newest')}
        </Button>
      </div>
      <ol className="relative flex flex-col gap-3 pl-1">
        {items.map((it) =>
          it.kind === 'change' ? (
            <li key={`c${it.change.id}`} className="flex items-center gap-2 pl-1 text-xs text-fg-4">
              {it.change.actorId ? <UserAvatar id={it.change.actorId} size="xs" /> : <span className="size-5" />}
              <span>
                <UserName id={it.change.actorId} className="font-medium text-fg-3" /> {describe(it.change)}
                {it.change.action === 'referenced' && typeof it.change.data.from === 'string' && (
                  <>
                    {' '}
                    <Link to={`/projects/${it.change.data.from.split('-')[0]}/${it.change.data.from}`} className="font-mono text-accent-text hover:underline">
                      {it.change.data.from}
                    </Link>
                  </>
                )}
                {typeof it.change.data.copiedFrom === 'string' && (
                  <>
                    {' · '}
                    {t('change.copiedFrom')}{' '}
                    <Link to={`/projects/${it.change.data.copiedFrom.split('-')[0]}/${it.change.data.copiedFrom}`} className="font-mono text-accent-text hover:underline">
                      {it.change.data.copiedFrom}
                    </Link>
                  </>
                )}
              </span>
              <span title={fmt.dateTime(it.at)}>· {fmt.relative(it.at)}</span>
              {it.change.source !== 'web' && <span className="rounded bg-surface-2 px-1 font-mono text-[10px]">{it.change.source}</span>}
            </li>
          ) : (
            <li key={`m${it.comment.id}`} className={cx(it.comment.parentId && 'ml-8')}>
              <Card className="p-3">
                <div className="mb-1 flex items-center gap-2 text-xs">
                  <UserAvatar id={it.comment.authorId} size="xs" />
                  <UserName id={it.comment.authorId} className="font-semibold text-fg" />
                  <span className="text-fg-4">{fmt.relative(it.comment.createdAt)}</span>
                  {it.comment.editedAt && <span className="text-fg-4">（{t('common.edited')}）</span>}
                  <div className="flex-1" />
                  {editable && !it.comment.parentId && !it.comment.deletedAt && (
                    <button className="min-h-8 px-1 text-fg-4 hover:text-fg-2" onClick={() => setReplyTo(it.comment.id)}>
                      {t('comments.reply')}
                    </button>
                  )}
                  {it.comment.authorId === me.id && !it.comment.deletedAt && (
                    <>
                      <button className="min-h-8 px-1 text-fg-4 hover:text-fg-2" onClick={() => setEditingId(it.comment.id)}>
                        {t('comments.edit')}
                      </button>
                      <button className="min-h-8 px-1 text-fg-4 hover:text-danger" onClick={() => api(`/api/issues/${issueRef}/comments/${it.comment.id}`, { method: 'DELETE' }).then(refresh, (e) => toastError(e))}>
                        {t('common.delete')}
                      </button>
                    </>
                  )}
                </div>
                {it.comment.deletedAt ? (
                  <div className="text-xs text-fg-4 italic">{t('comments.deleted')}</div>
                ) : editingId === it.comment.id ? (
                  <Composer
                    autoFocus
                    initial={it.comment.body}
                    userIds={memberIds}
                    upload={{ parentType: 'issue', parentId: issueId }}
                    onCancel={() => setEditingId(null)}
                    onSend={async (body) => {
                      await api(`/api/issues/${issueRef}/comments/${it.comment.id}`, { method: 'PATCH', body: { body, version: it.comment.version } })
                      setEditingId(null)
                      refresh()
                    }}
                  />
                ) : (
                  <Html html={renderMarkdown(it.comment.body)} className="prose-md text-sm" />
                )}
              </Card>
              {replyTo === it.comment.id && (
                <div className="mt-2 ml-8">
                  <Composer
                    autoFocus
                    placeholder={t('comments.replyPh')}
                    userIds={memberIds}
                    upload={{ parentType: 'issue', parentId: issueId }}
                    onCancel={() => setReplyTo(null)}
                    onSend={async (body) => {
                      await api(`/api/issues/${issueRef}/comments`, { method: 'POST', body: { body, parentId: it.comment.id, operationId: crypto.randomUUID() } })
                      setReplyTo(null)
                      refresh()
                    }}
                  />
                </div>
              )}
            </li>
          ),
        )}
        {!items.length && !q.isPending && <EmptyState title={t('comments.empty')} />}
      </ol>
      {q.hasNextPage && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
          {t('issue.loadEarlier')}
        </Button>
      )}
      {editable && (
        <div className="mt-4">
          <Composer
            placeholder={t('issue.commentPh')}
            userIds={memberIds}
            upload={{ parentType: 'issue', parentId: issueId }}
            onSend={async (body) => {
              await api(`/api/issues/${issueRef}/comments`, { method: 'POST', body: { body, operationId: crypto.randomUUID() } })
              refresh()
            }}
          />
        </div>
      )}
    </section>
  )
}

function useChangeText() {
  const { t, fmt } = useI18n()
  const dir = useDirectory()
  return (c: { action: string; data: Record<string, unknown> }) => {
    if (c.action === 'created') return t('change.created')
    if (c.action === 'deleted') return t('change.deleted')
    if (c.action === 'referenced') return t('change.referenced')
    if (c.action === 'related') return t('change.related', { type: t(`pm.rel.${c.data.type as 'relates'}` as MsgKey), target: String(c.data.target ?? '') })
    const f = String(c.data.field ?? '')
    const v = (x: unknown) =>
      f === 'status' ? t(`status.${x as Status}` as MsgKey) : f === 'priority' ? t(`priority.${x as 'none'}` as MsgKey) : f === 'dueAt' ? (x ? fmt.date(Number(x)) : t('issue.none')) : String(x ?? '')
    if (f === 'assignees') return t('change.assignees', { to: ((c.data.to as string[]) ?? []).map((id) => dir.get(id)?.name ?? '?').join('、') || t('issue.none') })
    const key = `change.${f}` as MsgKey
    return t(key, { from: v(c.data.from), to: v(c.data.to) })
  }
}
