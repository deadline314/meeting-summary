import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { BarChart3, CalendarRange, ChevronRight, FolderKanban, FolderPlus, Inbox, Kanban, List, Plus, Search, Settings2, SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useActions } from '../../lib/actions'
import { useDebounced } from '../../lib/hooks'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { Button, IconButton } from '../../ui/button'
import { Input, Select } from '../../ui/field'
import { Badge, EmptyState, Skeleton } from '../../ui/misc'
import { Segmented } from '../../ui/tabs'
import { openCreateIssue } from './create-issue'
import { IssueBoard, IssueList, ViewProvider, type Filters } from './issue-views'
import { PRIORITIES, STATUSES, canWrite, treeOrder, useLabels, useProject, useProjects, type ProjectDetail } from './model'
import { useAssigneeOptions } from './pickers'
import { NewProjectDialog, ProjectContextMenu, VisibilityBadge, openNewProject } from './projects-layout'
import { ProjectSettings, type SettingsTab } from './project-settings'
import { SaveViewButton, useViews } from './saved-views'
import { ProjectStats } from './stats'
import { IssueTimeline } from './timeline'

export type ProjectSearch = Omit<Filters, 'due' | 'blocking'> & { all?: boolean; due?: 'overdue' | 'week' | 'none'; blocking?: 'blocked' | 'blocking'; view?: 'list' | 'board' | 'timeline' | 'stats'; settings?: SettingsTab }

function Toolbar({
  search,
  setSearch,
  labels,
  memberIds,
  showView,
  projects,
}: {
  search: ProjectSearch
  setSearch(s: Partial<ProjectSearch>): void
  labels?: { id: string; name: string }[]
  memberIds?: string[]
  showView: boolean
  /** My issues only: narrow to one project. */
  projects?: { key: string; name: string }[]
}) {
  const { t } = useI18n()
  const [q, setQ] = useState(search.q ?? '')
  const dq = useDebounced(q, 250)
  const input = useRef<HTMLInputElement>(null)
  const assignees = useAssigneeOptions(memberIds)
  useEffect(() => {
    if (dq !== (search.q ?? '')) setSearch({ q: dq || undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq])
  useActions([
    { id: 'pm-search', label: 'pm.focusSearch', keys: '/', group: 'nav.projects', run: () => input.current?.focus() },
    ...(showView
      ? [
          { id: 'pm-board', label: 'pm.goBoard' as MsgKey, keys: 'g b', group: 'nav.projects' as MsgKey, run: () => setSearch({ view: 'board' }) },
          { id: 'pm-list', label: 'pm.goList' as MsgKey, keys: 'g l', group: 'nav.projects' as MsgKey, run: () => setSearch({ view: undefined }) },
          { id: 'pm-timeline', label: 'pm.goTimeline' as MsgKey, keys: 'g t', group: 'nav.projects' as MsgKey, run: () => setSearch({ view: 'timeline' }) },
          { id: 'pm-stats', label: 'pm.goStats' as MsgKey, keys: 'g i', group: 'nav.projects' as MsgKey, run: () => setSearch({ view: 'stats' }) },
        ]
      : []),
  ])
  const filtered = !!(search.assigneeId || search.priority || search.labelId || search.q || search.due || search.blocking || search.statuses || search.project)
  const [showFilters, setShowFilters] = useState(false)
  const active = [search.assigneeId, search.priority, search.labelId, search.sort, search.due, search.blocking, search.statuses, search.project].filter(Boolean).length
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
      {showView && (
        <Segmented
          data-tour="pm-views"
          compact
          value={search.view ?? 'list'}
          onChange={(v) => setSearch({ view: v === 'list' ? undefined : v })}
          options={[
            { value: 'list', label: t('pm.view.list'), icon: <List /> },
            { value: 'board', label: t('pm.view.board'), icon: <Kanban /> },
            { value: 'timeline', label: t('pm.view.timeline'), icon: <CalendarRange /> },
            { value: 'stats', label: t('pm.view.stats'), icon: <BarChart3 /> },
          ]}
        />
      )}
      <div className="relative min-w-40 flex-1 md:max-w-64">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-4" />
        <Input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('pm.search')} aria-label={t('pm.search')} className="h-9 pl-9" />
      </div>
      {/* Filters fold behind one button (Linear-style) so the toolbar stays on one line. */}
      {(
        <Button size="sm" variant={active ? 'soft' : 'secondary'} icon={<SlidersHorizontal className="size-4" />} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
          {t('pm.filter')}
          {active > 0 && ` ${active}`}
        </Button>
      )}
      {showFilters && (
      <div className="flex w-full flex-wrap items-center gap-2">
      {projects && (
        <Select value={search.project ?? ''} onChange={(e) => setSearch({ project: e.target.value || undefined })} aria-label={t('pm.filter.project')} className="h-9 w-auto">
          <option value="">{t('pm.filter.project')}</option>
          {projects.map((p) => (
            <option key={p.key} value={p.key}>
              {p.key} · {p.name}
            </option>
          ))}
        </Select>
      )}
      {search.view !== 'timeline' && search.view !== 'stats' && (
        <Select value={search.statuses ?? ''} onChange={(e) => setSearch({ statuses: e.target.value || undefined })} aria-label={t('pm.filter.status')} className="h-9 w-auto">
          <option value="">{t('pm.filter.status')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}` as MsgKey)}
            </option>
          ))}
        </Select>
      )}
      <Select value={search.assigneeId ?? ''} onChange={(e) => setSearch({ assigneeId: e.target.value || undefined })} aria-label={t('pm.filter.assignee')} className="h-9 w-auto">
        <option value="">{t('pm.filter.assignee')}</option>
        {assignees.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </Select>
      <Select value={search.priority ?? ''} onChange={(e) => setSearch({ priority: e.target.value || undefined })} aria-label={t('pm.filter.priority')} className="h-9 w-auto">
        <option value="">{t('pm.filter.priority')}</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {t(`priority.${p}` as MsgKey)}
          </option>
        ))}
      </Select>
      {labels && (
        <Select value={search.labelId ?? ''} onChange={(e) => setSearch({ labelId: e.target.value || undefined })} aria-label={t('pm.filter.label')} className="h-9 w-auto">
          <option value="">{t('pm.filter.label')}</option>
          {labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      )}
      <Select value={search.due ?? ''} onChange={(e) => setSearch({ due: (e.target.value || undefined) as ProjectSearch['due'] })} aria-label={t('pm.filter.due')} className="h-9 w-auto">
        <option value="">{t('pm.filter.due')}</option>
        {(['overdue', 'week', 'none'] as const).map((d) => (
          <option key={d} value={d}>
            {t(`pm.due.${d}` as MsgKey)}
          </option>
        ))}
      </Select>
      <Select value={search.blocking ?? ''} onChange={(e) => setSearch({ blocking: (e.target.value || undefined) as ProjectSearch['blocking'] })} aria-label={t('pm.filter.blocking')} className="h-9 w-auto">
        <option value="">{t('pm.filter.blocking')}</option>
        {(['blocked', 'blocking'] as const).map((d) => (
          <option key={d} value={d}>
            {t(`pm.filter.blocking.${d}`)}
          </option>
        ))}
      </Select>
      <Select value={search.sort ?? ''} onChange={(e) => setSearch({ sort: e.target.value || undefined })} aria-label={t('pm.sort.manual')} className="h-9 w-auto">
        {(['manual', 'created', 'updated', 'priority', 'due'] as const).map((s) => (
          <option key={s} value={s === 'manual' ? '' : s}>
            {t(`pm.sort.${s}` as MsgKey)}
          </option>
        ))}
      </Select>
      </div>
      )}
      {filtered && (
        <Button size="sm" variant="ghost" onClick={() => (setQ(''), setSearch({ assigneeId: undefined, priority: undefined, labelId: undefined, q: undefined, due: undefined, blocking: undefined, statuses: undefined, project: undefined }))}>
          {t('common.clearFilters')}
        </Button>
      )}
    </div>
  )
}

/** Phones have no project sidebar: a compact picker heads every PM page instead. */
function MobileProjectPicker({ current }: { current?: string }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const projects = useProjects()
  const views = useViews()
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  return (
    <div className="flex items-center gap-2 border-b border-line px-4 py-2 lg:hidden">
      <Select
        value={current ?? (location.pathname === '/projects/timeline' ? '/projects/timeline' : '')}
        onChange={(e) => (e.target.value.startsWith('/') ? router.history.push(e.target.value) : navigate({ to: e.target.value ? `/projects/${e.target.value}` : '/projects' }))}
        aria-label={t('pm.projects')}
        className="h-10 flex-1"
      >
        <option value="">{t('pm.myIssues')}</option>
        <option value="/projects/timeline">{t('tl.overview')}</option>
        {!!views.data?.length && (
          <optgroup label={t('views.title')}>
            {views.data.map((v) => (
              <option key={v.id} value={v.url}>
                {v.name}
              </option>
            ))}
          </optgroup>
        )}
        {treeOrder(projects.data ?? []).map(({ p, depth }) => (
          <option key={p.id} value={p.key}>
            {'  '.repeat(depth)}
            {p.key} · {p.name}
          </option>
        ))}
      </Select>
      <IconButton label={t('pm.newProject')} icon={<Plus />} variant="secondary" onClick={() => setCreating(true)} />
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

export function MyIssuesPage({ search, setSearch }: { search: ProjectSearch; setSearch(s: Partial<ProjectSearch>): void }) {
  const { t } = useI18n()
  const projects = useProjects()
  const [creating, setCreating] = useState(false)
  const filters: Filters = { assigneeId: search.assigneeId, priority: search.priority, q: search.q, sort: search.sort, due: search.due, blocking: search.blocking, statuses: search.statuses, project: search.project }
  return (
    <div>
      <MobileProjectPicker />
      <div className="flex flex-wrap items-center gap-3 px-4 pt-5 pb-3 md:px-6">
        <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
          <Inbox className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold tracking-tight md:text-xl">{search.all ? t('pm.allIssues') : t('pm.myIssues')}</h1>
          <p className="text-xs text-fg-4">{search.all ? t('pm.allIssuesHint') : t('pm.myIssuesHint')}</p>
        </div>
        <Segmented
          className="max-md:order-last"
          value={search.all ? 'all' : 'mine'}
          onChange={(v) => setSearch({ all: v === 'all' ? true : undefined })}
          options={[
            { value: 'mine', label: t('pm.scope.mine') },
            { value: 'all', label: t('pm.scope.all') },
          ]}
        />
        <SaveViewButton />
        <Button data-tour="pm-new" variant="primary" icon={<Plus className="size-4" />} onClick={() => openCreateIssue()} disabled={!projects.data?.some((p) => canWrite(p.role) && p.state === 'active')} title="C">
          {t('pm.new')}
        </Button>
      </div>
      <Toolbar search={search} setSearch={setSearch} showView={false} projects={projects.data} />
      {projects.data && !projects.data.length ? (
        <EmptyState
          className="py-20"
          icon={<FolderKanban />}
          title={t('pm.noProjects')}
          hint={t('pm.noProjectsHint')}
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              {t('pm.newProject')}
            </Button>
          }
        />
      ) : (
        <ViewProvider key={search.all ? 'all' : 'mine'} scope={search.all ? {} : { mine: true }} labels={[]}>
          <IssueList filters={filters} empty={<EmptyState className="py-20" icon={<Inbox />} title={search.q || search.priority || search.due || search.blocking || search.statuses || search.project ? t('pm.emptyFiltered') : t('pm.emptyMine')} />} />
        </ViewProvider>
      )}
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

export function ProjectPage({ projectKey, search, setSearch }: { projectKey: string; search: ProjectSearch; setSearch(s: Partial<ProjectSearch>): void }) {
  const { t } = useI18n()
  const q = useProject(projectKey)
  const labels = useLabels(projectKey)
  if (q.isPending)
    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64" />
      </div>
    )
  if (q.isError) throw q.error
  const p = q.data
  const filters: Filters = { assigneeId: search.assigneeId, priority: search.priority, labelId: search.labelId, q: search.q, sort: search.sort, due: search.due, blocking: search.blocking, statuses: search.statuses }
  const filtered = !!(search.assigneeId || search.priority || search.labelId || search.q || search.due || search.blocking || search.statuses)
  const writable = canWrite(p.role) && p.state === 'active'
  return (
    <div className="flex min-h-full flex-col">
      <MobileProjectPicker current={p.key} />
      <div className="flex flex-wrap items-center gap-3 px-4 pt-5 pb-3 md:px-6">
        <span className="flex h-9 min-w-12 items-center justify-center rounded-xl bg-accent-soft px-2 font-mono text-sm font-bold text-accent-text">{p.key}</span>
        <div className="min-w-0 flex-1">
          {p.ancestors.length > 0 && (
            <nav aria-label={t('pm.field.parent')} className="flex flex-wrap items-center gap-1 text-xs text-fg-4">
              {p.ancestors.map((a) => (
                <span key={a.key} className="flex items-center gap-1">
                  <Link to={`/projects/${a.key}`} className="hover:text-fg hover:underline">
                    {a.name}
                  </Link>
                  <ChevronRight className="size-3" />
                </span>
              ))}
            </nav>
          )}
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight max-md:flex-wrap md:truncate md:text-xl">
            {p.name}
            <VisibilityBadge p={p} />
            {p.state !== 'active' && <Badge>{t(`settings.pm.state.${p.state}` as MsgKey)}</Badge>}
          </h1>
          {p.description && <p className="truncate text-xs text-fg-4">{p.description}</p>}
        </div>
        <SaveViewButton />
        <IconButton label={t('pm.settings')} icon={<Settings2 />} variant="secondary" onClick={() => setSearch({ settings: 'general' })} />
        {writable && (
          <Button data-tour="pm-new" variant="primary" icon={<Plus className="size-4" />} onClick={() => openCreateIssue({ projectKey: p.key })} title="C">
            {t('pm.new')}
          </Button>
        )}
      </div>
      {(p.children.length > 0 || (writable && !search.view)) && <SubProjects p={p} writable={writable} />}
      <Toolbar search={search} setSearch={setSearch} labels={labels.data} memberIds={p.members.map((m) => m.userId)} showView />
      <ViewProvider key={p.key} scope={{ key: p.key }} role={p.role} labels={labels.data ?? []} memberIds={p.members.map((m) => m.userId)}>
        {search.view === 'board' ? (
          <IssueBoard filters={filters} />
        ) : search.view === 'stats' ? (
          <ProjectStats projectKey={p.key} />
        ) : search.view === 'timeline' ? (
          <IssueTimeline scope={{ key: p.key }} filters={filters} />
        ) : (
          <IssueList
            filters={filters}
            empty={
              filtered ? (
                <EmptyState
                  className="py-20"
                  icon={<Search />}
                  title={t('pm.emptyFiltered')}
                  action={
                    <Button size="sm" onClick={() => setSearch({ assigneeId: undefined, priority: undefined, labelId: undefined, q: undefined, due: undefined, blocking: undefined, statuses: undefined })}>
                      {t('common.clearFilters')}
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  className="py-20"
                  icon={<FolderKanban />}
                  title={t('pm.emptyProject')}
                  hint={writable ? t('pm.emptyProjectHint') : undefined}
                  action={
                    writable && (
                      <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openCreateIssue({ projectKey: p.key })}>
                        {t('pm.new')}
                      </Button>
                    )
                  }
                />
              )
            }
          />
        )}
      </ViewProvider>
      {search.settings && <ProjectSettings project={p} tab={search.settings} onTab={(s) => setSearch({ settings: s })} onClose={() => setSearch({ settings: undefined })} />}
    </div>
  )
}

/** Sub-projects I can see, as chips; members can start a new one here. */
function SubProjects({ p, writable }: { p: ProjectDetail; writable: boolean }) {
  const { t } = useI18n()
  const rows = useProjects().data ?? []
  if (!p.children.length && !writable) return null
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3 md:px-6">
      {p.children.length > 0 && <span className="text-xs font-medium text-fg-4">{t('pm.subProjects')}</span>}
      {p.children.map((c) => {
        const chip = (
          <Link to={`/projects/${c.key}`} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[13px] text-fg-2 hover:border-accent max-md:h-11">
            <span className="font-mono text-[11px] font-bold text-fg-3">{c.key}</span>
            <span className="max-w-40 truncate">{c.name}</span>
            <VisibilityBadge p={c} />
            {c.openIssues > 0 && <span className="text-[11px] text-fg-4">{c.openIssues}</span>}
          </Link>
        )
        const row = rows.find((r) => r.key === c.key)
        return row ? (
          <ProjectContextMenu key={c.key} p={row}>
            {chip}
          </ProjectContextMenu>
        ) : (
          <span key={c.key}>{chip}</span>
        )
      })}
      {writable && (
        <button
          type="button"
          onClick={() => openNewProject({ parentId: p.id })}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 text-[13px] text-fg-3 hover:border-accent hover:text-accent-text max-md:h-11"
        >
          <FolderPlus className="size-3.5" /> {t('pm.newSubProject')}
        </button>
      )}
    </div>
  )
}

/** G O: every visible project's issues on one chart. */
export function TimelineOverviewPage({ search, setSearch }: { search: ProjectSearch; setSearch(s: Partial<ProjectSearch>): void }) {
  const { t } = useI18n()
  const filters: Filters = { assigneeId: search.assigneeId, priority: search.priority, q: search.q }
  return (
    <div>
      <MobileProjectPicker />
      <div className="flex items-center gap-3 px-4 pt-5 pb-3 md:px-6">
        <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
          <CalendarRange className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold tracking-tight md:text-xl">{t('tl.overview')}</h1>
          <p className="text-xs text-fg-4">{t('tl.overviewHint')}</p>
        </div>
      </div>
      <Toolbar search={search} setSearch={setSearch} showView={false} />
      <IssueTimeline scope={{}} filters={filters} />
    </div>
  )
}
