import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { Archive, CalendarRange, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, FolderPlus, Inbox, Link2, Lock, Plus, Settings2, Users, UsersRound } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { useActions } from '../../lib/actions'
import { api, queryClient } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { useMe } from '../../lib/session'
import { Button, IconButton } from '../../ui/button'
import { ContextMenu, CtxItem, CtxLabel, CtxSeparator, copyText, openInNewTab, siteLink } from '../../ui/context-menu'
import { cx } from '../../ui/cx'
import { Dialog, confirm } from '../../ui/dialog'
import { Field, Input, Select, Textarea } from '../../ui/field'
import { Skeleton } from '../../ui/misc'
import { toastError } from '../../ui/toast'
import { Tooltip } from '../../ui/tooltip'
import { UserChips } from '../../ui/user-picker'
import { useTour } from '../../app/tour'
import { CreateIssueHost, openCreateIssue } from './create-issue'
import { DuplicateIssueHost } from './duplicate-issue'
import { RelateHost } from './relate'
import { canManage, canWrite, childrenMap, invalidateIssues, useProjects, type ProjectRole, type ProjectRow } from './model'
import { RoleSelect, useParentOptions } from './project-settings'
import { SavedViewsNav } from './saved-views'

// "New project" can be opened from the sidebar, a project page or a context menu (as a sub-project).
let newProject: { parentId?: string } | null = null
const newProjectListeners = new Set<() => void>()
export function openNewProject(o: { parentId?: string } = {}) {
  newProject = o
  newProjectListeners.forEach((l) => l())
}
function NewProjectHost() {
  const req = useSyncExternalStore(
    (cb) => {
      newProjectListeners.add(cb)
      return () => newProjectListeners.delete(cb)
    },
    () => newProject,
  )
  if (!req) return null
  return <NewProjectDialog parentId={req.parentId} onClose={closeNewProject} />
}
function closeNewProject() {
  newProject = null
  newProjectListeners.forEach((l) => l())
}

export function ProjectsLayout() {
  useTour('projects')
  const navigate = useNavigate()
  useActions([
    { id: 'pm-new-issue', label: 'create.title', keys: 'c', icon: <Plus />, group: 'group.create', run: () => openCreateIssue(currentKey()) },
    { id: 'pm-overview', label: 'tl.overview', keys: 'g o', icon: <CalendarRange />, group: 'nav.projects', run: () => navigate({ to: '/projects/timeline' }) },
  ])
  return (
    <div className="flex min-h-[calc(100dvh-7.5rem)] md:min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface/50 lg:flex">
        <ProjectNav onNew={() => openNewProject()} />
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
      <CreateIssueHost />
      <DuplicateIssueHost />
      <RelateHost />
      <NewProjectHost />
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
    <nav data-tour="pm-nav" className="flex flex-col gap-0.5 p-3">
      {item('/projects', <Inbox />, t('pm.myIssues'), path === '/projects')}
      {item('/projects/timeline', <CalendarRange />, t('tl.overview'), path === '/projects/timeline')}
      <SavedViewsNav />
      <div className="mt-4 mb-1 flex items-center justify-between px-2.5">
        <span className="text-[11px] font-semibold tracking-wide text-fg-4 uppercase">{t('pm.projects')}</span>
        <IconButton label={t('pm.newProject')} icon={<Plus />} size="sm" onClick={onNew} className="-mr-1.5 size-7" />
      </div>
      {q.isPending && <Skeleton className="h-9" />}
      <ProjectTree list={mine} path={path} />
      {others.length > 0 && (
        <>
          <div className="mt-4 mb-1 px-2.5 text-[11px] font-semibold tracking-wide text-fg-4 uppercase">{t('pm.others')}</div>
          <ProjectTree list={others} path={path} />
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

const FOLD_KEY = 'ms.pm.folded'
const readFolded = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]')
  } catch {
    return []
  }
}

/** Sub-projects sit under their parent, indented per level and foldable; parents I can't see count as top level. */
function ProjectTree({ list, path }: { list: ProjectRow[]; path: string }) {
  const [folded, setFolded] = useState(() => new Set(readFolded()))
  const kids = childrenMap(list)
  const by = new Map(list.map((p) => [p.id, p]))
  const toggle = (id: string) =>
    setFolded((f) => {
      const n = new Set(f)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      try {
        localStorage.setItem(FOLD_KEY, JSON.stringify([...n]))
      } catch {
        /* per-viewer convenience only */
      }
      return n
    })
  const render = (id: string, depth: number): React.ReactNode => {
    const p = by.get(id)!
    const children = (kids.get(id) ?? []).map((c) => by.get(c)!).sort((a, b) => a.key.localeCompare(b.key))
    return (
      <div key={id}>
        <ProjectLink p={p} depth={depth} active={path === `/projects/${p.key}` || path.startsWith(`/projects/${p.key}/`)} folded={children.length ? folded.has(id) : undefined} onFold={() => toggle(id)} />
        {!folded.has(id) && children.map((c) => render(c.id, depth + 1))}
      </div>
    )
  }
  return <>{(kids.get(null) ?? []).map((id) => render(id, 0))}</>
}

function ProjectLink({ p, active, depth = 0, folded, onFold }: { p: ProjectRow; active: boolean; depth?: number; folded?: boolean; onFold?(): void }) {
  const { t } = useI18n()
  return (
    <ProjectContextMenu p={p}>
      <div className="relative" style={{ paddingLeft: depth * 14 }}>
        {folded !== undefined && (
          <button
            type="button"
            onClick={onFold}
            aria-label={folded ? t('pm.tree.expand') : t('pm.tree.collapse')}
            aria-expanded={!folded}
            className="absolute top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-4 hover:bg-surface-3 hover:text-fg max-md:size-9"
            style={{ left: depth * 14 - 4 }}
          >
            {folded ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        )}
        <Link
          to={`/projects/${p.key}`}
          className={cx('flex h-9 items-center gap-2 rounded-xl pr-2.5 pl-5 text-sm transition-colors max-md:h-11', active ? 'bg-accent-soft font-medium text-accent-text' : 'text-fg-2 hover:bg-surface-2')}
        >
          <span className="flex h-5 min-w-9 items-center justify-center rounded-md bg-surface-3 px-1 font-mono text-[10px] font-bold text-fg-3">{p.key}</span>
          <span className="flex-1 truncate">{p.name}</span>
          <VisibilityBadge p={p} />
          {p.openIssues > 0 && <span className="text-[11px] text-fg-4">{p.openIssues}</span>}
        </Link>
      </div>
    </ProjectContextMenu>
  )
}

/** Right-click on a project: open, create inside it, settings and lifecycle — only what my role allows. */
export function ProjectContextMenu({ p, children }: { p: Pick<ProjectRow, 'id' | 'key' | 'name' | 'role' | 'state' | 'reviewerId'>; children: React.ReactNode }) {
  const { t } = useI18n()
  const me = useMe()
  const navigate = useNavigate()
  const path = `/projects/${p.key}`
  const settings = (tab: 'general' | 'members') => navigate({ to: path, search: { settings: tab } as never })
  const active = p.state === 'active'
  const state = async (action: 'close' | 'archive') => {
    const ok = await confirm({ title: `${t(action === 'close' ? 'settings.pm.close' : 'settings.pm.archive')} ${p.key}`, body: t(action === 'close' ? 'settings.pm.closeHint' : 'settings.pm.archiveHint') })
    if (!ok) return
    try {
      await api(`/api/projects/${p.key}/state`, { method: 'POST', body: { action } })
      queryClient.invalidateQueries({ queryKey: ['project', p.key] })
      invalidateIssues()
    } catch (err) {
      toastError(err)
    }
  }
  return (
    <ContextMenu
      menu={
        <>
          <CtxLabel>
            {p.key} · {p.name}
          </CtxLabel>
          <CtxItem icon={<ChevronRight />} onSelect={() => navigate({ to: path })}>
            {t('ctx.open')}
          </CtxItem>
          <CtxItem icon={<ExternalLink />} onSelect={() => openInNewTab(path)}>
            {t('ctx.openNewTab')}
          </CtxItem>
          {active && canWrite(p.role) && (
            <>
              <CtxSeparator />
              <CtxItem icon={<Plus />} shortcut="c" onSelect={() => openCreateIssue({ projectKey: p.key })}>
                {t('create.title')}
              </CtxItem>
              <CtxItem icon={<FolderPlus />} onSelect={() => openNewProject({ parentId: p.id })}>
                {t('pm.newSubProject')}
              </CtxItem>
            </>
          )}
          <CtxSeparator />
          <CtxItem icon={<Settings2 />} onSelect={() => settings('general')}>
            {t('pm.settings')}
          </CtxItem>
          <CtxItem icon={<Users />} onSelect={() => settings('members')}>
            {canManage(p.role) ? t('ctx.manageMembers') : t('ctx.viewMembers')}
          </CtxItem>
          <CtxItem icon={<Link2 />} onSelect={() => copyText(siteLink(path), t('common.copied'))}>
            {t('pm.copyLink')}
          </CtxItem>
          {active && (canManage(p.role) || p.reviewerId === me.id) && (
            <>
              <CtxSeparator />
              <CtxItem icon={<CheckCircle2 />} onSelect={() => state('close')}>
                {t('settings.pm.close')}
              </CtxItem>
              {canManage(p.role) && (
                <CtxItem icon={<Archive />} onSelect={() => state('archive')}>
                  {t('settings.pm.archive')}
                </CtxItem>
              )}
            </>
          )}
        </>
      }
    >
      {children}
    </ContextMenu>
  )
}

export function NewProjectDialog({ onClose, parentId: initialParent }: { onClose(): void; parentId?: string }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [parentId, setParentId] = useState(initialParent ?? '')
  const [copyMembers, setCopyMembers] = useState(true)
  const [members, setMembers] = useState<string[]>([])
  const [role, setRole] = useState<ProjectRole>('member')
  const parents = useParentOptions()
  const me = useMe()
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
                await api('/api/projects', {
                  method: 'POST',
                  body: { key, name: name.trim(), description, parentId: parentId || null, copyParentMembers: !!parentId && copyMembers, members: members.map((userId) => ({ userId, role })), operationId: crypto.randomUUID() },
                })
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
        <Field label={t('pm.field.parent')}>
          {(id) => (
            <Select id={id} value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">{t('pm.parent.none')}</option>
              {parents.map((x) => (
                <option key={x.id} value={x.id}>
                  {'\u00a0\u00a0'.repeat(x.depth)}
                  {x.key} · {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {parentId && (
          <label className="-mt-2 flex min-h-11 items-center gap-2 text-sm md:min-h-0">
            <input type="checkbox" className="size-4 accent-accent" checked={copyMembers} onChange={(e) => setCopyMembers(e.target.checked)} />
            {t('pm.copyParentMembers')}
          </label>
        )}
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-fg-2">{t('settings.pm.members')}</span>
          <div className="flex flex-wrap items-center gap-2">
            <UserChips value={members} onChange={setMembers} filter={(id) => id !== me.id} />
            {members.length > 0 && <RoleSelect value={role} onChange={setRole} />}
          </div>
          <span className="text-xs text-fg-4">{members.length || (parentId && copyMembers) ? t('pm.membersHint') : t('pm.privateHint')}</span>
        </div>
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
