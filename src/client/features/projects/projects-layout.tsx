import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, Inbox, Lock, Plus, Users, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { useActions } from '../../lib/actions'
import { api, queryClient } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { Button, IconButton } from '../../ui/button'
import { cx } from '../../ui/cx'
import { Dialog } from '../../ui/dialog'
import { Field, Input, Textarea } from '../../ui/field'
import { Skeleton } from '../../ui/misc'
import { toastError } from '../../ui/toast'
import { Tooltip } from '../../ui/tooltip'
import { CreateIssueHost, openCreateIssue } from './create-issue'
import { useProjects, type ProjectRow } from './model'

export function ProjectsLayout() {
  const [creating, setCreating] = useState(false)
  useActions([{ id: 'pm-new-issue', label: 'create.title', keys: 'c', icon: <Plus />, group: 'group.create', run: () => openCreateIssue(currentKey()) }])
  return (
    <div className="flex min-h-[calc(100dvh-7.5rem)] md:min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface/50 lg:flex">
        <ProjectNav onNew={() => setCreating(true)} />
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
      <CreateIssueHost />
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function currentKey() {
  const m = /^\/projects\/([A-Za-z]{2,6})(\/|$)/.exec(location.pathname)
  return m ? { projectKey: m[1]!.toUpperCase() } : {}
}

export function ProjectNav({ onNew }: { onNew(): void }) {
  const { t } = useI18n()
  const q = useProjects()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const [showClosed, setShowClosed] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const all = q.data ?? []
  const mine = all.filter((p) => p.role !== 'admin' && p.state === 'active')
  const others = all.filter((p) => p.role === 'admin' && p.state === 'active')
  const closed = all.filter((p) => p.state === 'closed')
  const archived = all.filter((p) => p.state === 'archived')
  const item = (to: string, icon: React.ReactNode, label: React.ReactNode, active: boolean) => (
    <Link to={to} className={cx('flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-sm transition-colors [&_svg]:size-4', active ? 'bg-accent-soft font-medium text-accent-text' : 'text-fg-2 hover:bg-surface-2')}>
      {icon}
      {label}
    </Link>
  )
  return (
    <nav className="flex flex-col gap-0.5 p-3">
      {item('/projects', <Inbox />, t('pm.myIssues'), path === '/projects')}
      <div className="mt-4 mb-1 flex items-center justify-between px-2.5">
        <span className="text-[11px] font-semibold tracking-wide text-fg-4 uppercase">{t('pm.projects')}</span>
        <IconButton label={t('pm.newProject')} icon={<Plus />} size="sm" onClick={onNew} className="-mr-1.5 size-7" />
      </div>
      {q.isPending && <Skeleton className="h-9" />}
      {mine.map((p) => (
        <ProjectLink key={p.id} p={p} active={path.startsWith(`/projects/${p.key}`)} child={!!p.parentId && mine.some((x) => x.id === p.parentId)} />
      ))}
      {others.length > 0 && (
        <>
          <div className="mt-4 mb-1 px-2.5 text-[11px] font-semibold tracking-wide text-fg-4 uppercase">{t('pm.others')}</div>
          {others.map((p) => (
            <ProjectLink key={p.id} p={p} active={path.startsWith(`/projects/${p.key}`)} />
          ))}
        </>
      )}
      {closed.length > 0 && (
        <>
          <Section label={`${t('pm.closed')} (${closed.length})`} open={showClosed} onToggle={() => setShowClosed((o) => !o)} />
          {showClosed && closed.map((p) => <ProjectLink key={p.id} p={p} active={path.startsWith(`/projects/${p.key}`)} />)}
        </>
      )}
      {archived.length > 0 && (
        <>
          <Section label={`${t('pm.archived')} (${archived.length})`} open={showArchived} onToggle={() => setShowArchived((o) => !o)} />
          {showArchived && archived.map((p) => <ProjectLink key={p.id} p={p} active={path.startsWith(`/projects/${p.key}`)} />)}
        </>
      )}
    </nav>
  )
}

function Section({ label, open, onToggle }: { label: string; open: boolean; onToggle(): void }) {
  return (
    <button onClick={onToggle} className="mt-4 mb-1 flex items-center gap-1 px-2.5 text-[11px] font-semibold tracking-wide text-fg-4 uppercase hover:text-fg-3">
      {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      {label}
    </button>
  )
}

export function VisibilityBadge({ p }: { p: Pick<ProjectRow, 'private' | 'hiddenFromAdmins'> }) {
  const { t } = useI18n()
  const [icon, label, hint] = p.private
    ? [<Lock key="i" />, t('pm.badge.private'), t('pm.badge.private.hint')]
    : p.hiddenFromAdmins
      ? [<Users key="i" />, t('pm.badge.members'), t('pm.badge.members.hint')]
      : [<UsersRound key="i" />, t('pm.badge.shared'), t('pm.badge.shared.hint')]
  return (
    <Tooltip label={hint}>
      <span className="inline-flex items-center gap-1 text-[11px] text-fg-4 [&_svg]:size-3" aria-label={label}>
        {icon}
        <span className="sr-only">{label}</span>
      </span>
    </Tooltip>
  )
}

function ProjectLink({ p, active, child }: { p: ProjectRow; active: boolean; child?: boolean }) {
  return (
    <Link
      to={`/projects/${p.key}`}
      className={cx('flex h-9 items-center gap-2 rounded-xl px-2.5 text-sm transition-colors', child && 'ml-4', active ? 'bg-accent-soft font-medium text-accent-text' : 'text-fg-2 hover:bg-surface-2')}
    >
      <span className="flex h-5 min-w-9 items-center justify-center rounded-md bg-surface-3 px-1 font-mono text-[10px] font-bold text-fg-3">{p.key}</span>
      <span className="flex-1 truncate">{p.name}</span>
      <VisibilityBadge p={p} />
      {p.openIssues > 0 && <span className="text-[11px] text-fg-4">{p.openIssues}</span>}
    </Link>
  )
}

export function NewProjectDialog({ onClose }: { onClose(): void }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const valid = /^[A-Z]{2,6}$/.test(key) && name.trim()
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('pm.newProject')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!valid}
            onClick={async () => {
              setBusy(true)
              try {
                await api('/api/projects', { method: 'POST', body: { key, name: name.trim(), description, operationId: crypto.randomUUID() } })
                queryClient.invalidateQueries({ queryKey: ['projects'] })
                onClose()
                navigate({ to: `/projects/${key}` })
              } catch (err) {
                toastError(err)
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('common.create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('pm.field.name')}>
          {(id) => (
            <Input
              id={id}
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (!key || key === suggestKey(name)) setKey(suggestKey(e.target.value))
              }}
            />
          )}
        </Field>
        <Field label={t('pm.field.key')} hint={t('pm.field.keyHint')}>
          {(id) => <Input id={id} value={key} maxLength={6} onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} className="font-mono uppercase" />}
        </Field>
        <Field label={t('pm.field.description')}>{(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      </div>
    </Dialog>
  )
}

const suggestKey = (name: string) =>
  name
    .toUpperCase()
    .replace(/[^A-Z ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w, _i, all) => (all.length > 1 ? w[0] : w.slice(0, 4)))
    .join('')
    .slice(0, 6)
