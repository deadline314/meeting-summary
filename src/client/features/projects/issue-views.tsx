import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, Copy, CopyPlus, GitBranch, Link2, Plus, Trash2, UserPlus } from 'lucide-react'
import { ContextMenu as CM } from 'radix-ui'
import { AnimatePresence, motion } from 'motion/react'
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useActions } from '../../lib/actions'
import { ApiError, api, queryClient } from '../../lib/api'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { useMe } from '../../lib/session'
import { AvatarStack } from '../../ui/avatar'
import { Button, IconButton } from '../../ui/button'
import { cx } from '../../ui/cx'
import { confirm } from '../../ui/dialog'
import { Kbd, Skeleton } from '../../ui/misc'
import { toast, toastError } from '../../ui/toast'
import { Tooltip } from '../../ui/tooltip'
import { openCreateIssue } from './create-issue'
import { openDuplicate } from './duplicate-issue'
import { IssueStatusIcon, PriorityIcon } from './icons'
import { STATUSES, canWrite, invalidateIssues, isDone, patchIssue, rememberNav, type Access, type IssuePatch, type IssueRow, type Label, type Status } from './model'
import { LabelChip, OptionPicker, labelOptions, useAssigneeOptions, usePriorityOptions, useStatusOptions } from './pickers'

export type Scope = { key?: string; mine?: boolean }
export type Filters = { assigneeId?: string; priority?: string; labelId?: string; q?: string; sort?: string }

const PAGE = 50
const base = (s: Scope) => (s.key ? `/api/projects/${s.key}` : '/api/my-issues')
const qs = (f: Filters & Record<string, unknown>) =>
  new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined && v !== '' && v !== false) as [string, string][]).toString()
const FOURTEEN_DAYS = 14 * 86400_000

export function useCounts(scope: Scope, f: Filters) {
  return useQuery({
    queryKey: ['counts', scope, f],
    queryFn: () => api<Record<Status, number>>(`${base(scope)}/counts?${qs(f)}`),
  })
}

/** One status, its own pages. Shared by list groups and board columns (same cache key). */
export function useStatusIssues(scope: Scope, f: Filters, status: Status, enabled: boolean, doneSince?: number) {
  return useInfiniteQuery({
    queryKey: ['issues', scope, f, status, doneSince ?? 0],
    queryFn: ({ pageParam }) => api<{ items: IssueRow[]; total: number }>(`${base(scope)}${scope.key ? '/issues' : ''}?${qs({ ...f, status, offset: pageParam, limit: PAGE, doneSince })}`),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const n = all.reduce((s, p) => s + p.items.length, 0)
      return n < last.total ? n : undefined
    },
    enabled,
  })
}

type Ctx = {
  scope: Scope
  role?: Access
  labels: Label[]
  memberIds?: string[]
  cursor: string | null
  setCursor(ref: string | null): void
  checked: Set<string>
  toggleChecked(ref: string): void
  picker: { ref: string; kind: 's' | 'p' | 'a' | 'l' } | null
  setPicker(p: Ctx['picker']): void
  register(status: Status, rows: IssueRow[]): void
  all(): IssueRow[]
}
const ViewCtx = createContext<Ctx | null>(null)
const useView = () => useContext(ViewCtx)!

/** Optimistic edit: patch every cached copy, send, roll back on failure (409 → refetch + toast). */
export async function applyPatch(rows: IssueRow[], patch: IssuePatch, t: (k: MsgKey, p?: Record<string, string | number>) => string) {
  const refs = new Set(rows.map((r) => r.ref))
  const snapshot = queryClient.getQueriesData<InfiniteData<{ items: IssueRow[]; total: number }>>({ queryKey: ['issues'] })
  queryClient.setQueriesData<InfiniteData<{ items: IssueRow[]; total: number }>>({ queryKey: ['issues'] }, (d) =>
    d ? { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map((i) => (refs.has(i.ref) ? { ...i, ...(patch as Partial<IssueRow>) } : i)) })) } : d,
  )
  try {
    if (rows.length === 1) await patchIssue(rows[0]!, patch)
    else {
      const r = await api<{ results: { ok: boolean }[] }>('/api/issues/batch', { method: 'POST', body: { items: rows.map((i) => ({ ref: i.ref, version: i.version })), patch } })
      const failed = r.results.filter((x) => !x.ok).length
      if (failed) toast(t('pm.batchFailed', { failed, total: rows.length }), 'error')
    }
  } catch (err) {
    snapshot.forEach(([k, v]) => queryClient.setQueryData(k, v))
    if (err instanceof ApiError && err.code === 'conflict') toast(t('error.conflict'), 'error')
    else toastError(err)
  } finally {
    invalidateIssues()
  }
}

export function ViewProvider({ scope, role, labels, memberIds, children }: { scope: Scope; role?: Access; labels: Label[]; memberIds?: string[]; children: ReactNode }) {
  const [cursor, setCursor] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [picker, setPicker] = useState<Ctx['picker']>(null)
  const rows = useRef(new Map<Status, IssueRow[]>())
  const value = useMemo<Ctx>(
    () => ({
      scope,
      role,
      labels,
      memberIds,
      cursor,
      setCursor,
      checked,
      toggleChecked: (ref) =>
        setChecked((s) => {
          const n = new Set(s)
          if (n.has(ref)) n.delete(ref)
          else n.add(ref)
          return n
        }),
      picker,
      setPicker,
      register: (status, list) => {
        rows.current.set(status, list)
      },
      all: () => STATUSES.flatMap((s) => rows.current.get(s) ?? []),
    }),
    [scope, role, labels, memberIds, cursor, checked, picker],
  )
  return (
    <ViewCtx.Provider value={value}>
      <Keyboard />
      {children}
      <SelectionBar />
    </ViewCtx.Provider>
  )
}

function useTargets() {
  const v = useView()
  return () => {
    const all = v.all()
    if (v.checked.size) return all.filter((i) => v.checked.has(i.ref))
    const c = all.find((i) => i.ref === v.cursor)
    return c ? [c] : []
  }
}

/** J/K/↑/↓ move, Enter opens, X selects, S/A/P/L edit, I assigns me, ⌘C / ⌘⇧C copy. */
function Keyboard() {
  const v = useView()
  const me = useMe()
  const { t } = useI18n()
  const navigate = useNavigate()
  const targets = useTargets()
  const move = (d: number) => {
    const all = v.all()
    if (!all.length) return
    const i = all.findIndex((x) => x.ref === v.cursor)
    const next = all[Math.max(0, Math.min(all.length - 1, i < 0 ? 0 : i + d))]!
    v.setCursor(next.ref)
    document.querySelector(`[data-ref="${next.ref}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  const open = () => {
    const all = v.all()
    const c = all.find((x) => x.ref === v.cursor)
    if (!c) return
    rememberNav(all.map((x) => x.ref), location.pathname + location.search)
    navigate({ to: `/projects/${c.projectKey}/${c.ref}` })
  }
  const pick = (kind: 's' | 'p' | 'a' | 'l') => () => v.cursor && canWrite(v.role ?? 'member') && v.setPicker({ ref: v.cursor, kind })
  useActions([
    { id: 'pm-down', label: 'pm.moveDown', keys: 'j', group: 'nav.projects', run: () => move(1) },
    { id: 'pm-down2', label: 'pm.moveDown', keys: 'arrowdown', hidden: true, run: () => move(1) },
    { id: 'pm-up', label: 'pm.moveUp', keys: 'k', group: 'nav.projects', run: () => move(-1) },
    { id: 'pm-up2', label: 'pm.moveUp', keys: 'arrowup', hidden: true, run: () => move(-1) },
    { id: 'pm-open', label: 'pm.openIssue', keys: 'enter', group: 'nav.projects', run: open },
    { id: 'pm-select', label: 'pm.toggleSelect', keys: 'x', group: 'nav.projects', run: () => v.cursor && v.toggleChecked(v.cursor) },
    { id: 'pm-status', label: 'picker.status', keys: 's', group: 'nav.projects', run: pick('s') },
    { id: 'pm-assignee', label: 'picker.assignee', keys: 'a', group: 'nav.projects', run: pick('a') },
    { id: 'pm-priority', label: 'picker.priority', keys: 'p', group: 'nav.projects', run: pick('p') },
    { id: 'pm-labels', label: 'picker.labels', keys: 'l', group: 'nav.projects', run: pick('l') },
    {
      id: 'pm-assign-me',
      label: 'pm.assignMe',
      keys: 'i',
      group: 'nav.projects',
      run: () => {
        const rows = targets()
        if (rows.length) applyPatch(rows, { assigneeIds: [...new Set([...rows[0]!.assigneeIds, me.id])] }, t)
      },
    },
    { id: 'pm-copy-id', label: 'pm.copyId', keys: 'mod+c', group: 'nav.projects', hidden: true, run: () => copyRefs(targets(), false, t) },
    { id: 'pm-copy-link', label: 'pm.copyLink', keys: 'mod+shift+c', group: 'nav.projects', hidden: true, run: () => copyRefs(targets(), true, t) },
  ])
  return null
}

function copyRefs(rows: IssueRow[], link: boolean, t: (k: MsgKey) => string) {
  if (!rows.length || window.getSelection()?.toString()) return
  const text = rows.map((r) => (link ? `${location.origin}/projects/${r.projectKey}/${r.ref}` : r.ref)).join('\n')
  navigator.clipboard.writeText(text).then(() => toast(t('common.copied')))
}

function SelectionBar() {
  const v = useView()
  const { t } = useI18n()
  const n = v.checked.size
  return (
    <AnimatePresence>
      {n > 0 && (
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          className="fixed bottom-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2 text-sm shadow-card md:bottom-6"
        >
          <span className="font-medium">{t('pm.selected', { n })}</span>
          <span className="hidden text-xs text-fg-4 sm:inline">
            <Kbd keys="s" /> <Kbd keys="a" /> <Kbd keys="p" /> <Kbd keys="l" />
          </span>
          <Button size="sm" variant="ghost" onClick={() => [...v.checked].forEach((r) => v.toggleChecked(r))}>
            {t('pm.clearSelection')}
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ---------- list ----------

export function IssueList({ filters, empty }: { filters: Filters; empty: ReactNode }) {
  const v = useView()
  const counts = useCounts(v.scope, filters)
  const [collapsed, setCollapsed] = useState<Set<Status>>(new Set())
  const total = counts.data ? Object.values(counts.data).reduce((a, b) => a + b, 0) : null
  if (total === 0) return <>{empty}</>
  return (
    <div className="flex flex-col">
      {STATUSES.map((s) => (
        <Group
          key={s}
          status={s}
          filters={filters}
          total={counts.data?.[s] ?? 0}
          collapsed={collapsed.has(s)}
          onToggle={() =>
            setCollapsed((c) => {
              const n = new Set(c)
              if (n.has(s)) n.delete(s)
              else n.add(s)
              return n
            })
          }
        />
      ))}
    </div>
  )
}

function Group({ status, filters, total, collapsed, onToggle }: { status: Status; filters: Filters; total: number; collapsed: boolean; onToggle(): void }) {
  const v = useView()
  const { t } = useI18n()
  const [showAll, setShowAll] = useState(false)
  // In "My issues", finished work defaults to the last 14 days.
  const [since] = useState(() => Date.now() - FOURTEEN_DAYS)
  const doneSince = v.scope.mine && isDone(status) && !showAll ? since : undefined
  const q = useStatusIssues(v.scope, filters, status, !collapsed && total > 0, doneSince)
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data])
  useEffect(() => {
    v.register(status, collapsed ? [] : rows)
  }, [v, status, rows, collapsed])
  if (!total) return null
  const loaded = rows.length
  return (
    <section>
      <div className="sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-line bg-surface-2/95 px-4 backdrop-blur max-md:top-14">
        <button onClick={onToggle} className="flex items-center gap-2 text-[13px] font-semibold" aria-expanded={!collapsed}>
          {collapsed ? <ChevronRight className="size-4 text-fg-4" /> : <ChevronDown className="size-4 text-fg-4" />}
          <IssueStatusIcon status={status} />
          {t(`status.${status}` as MsgKey)}
        </button>
        <Tooltip label={t('pm.loaded', { loaded: collapsed ? 0 : loaded, total })}>
          <span className="text-xs text-fg-4">{collapsed ? total : `${loaded}／${doneSince ? q.data?.pages[0]?.total ?? total : total}`}</span>
        </Tooltip>
        <div className="flex-1" />
        {canWrite(v.role ?? 'member') && v.scope.key && (
          <IconButton label={t('pm.newHint', { status: t(`status.${status}` as MsgKey) })} icon={<Plus />} size="sm" onClick={() => openCreateIssue({ projectKey: v.scope.key, status })} />
        )}
      </div>
      {!collapsed && (
        <>
          {q.isPending ? (
            <div className="flex flex-col gap-1 p-2">
              {Array.from({ length: Math.min(total, 3) }, (_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (
            <ul>
              {rows.map((i) => (
                <IssueRowView key={i.ref} issue={i} />
              ))}
            </ul>
          )}
          {q.hasNextPage && (
            <button className="w-full py-2 text-xs text-accent-text hover:bg-surface-2" onClick={() => q.fetchNextPage()}>
              {t('common.loadMore')}
            </button>
          )}
          {doneSince && (
            <button className="w-full py-2 text-xs text-fg-4 hover:text-accent-text" onClick={() => setShowAll(true)}>
              {t('pm.recentDone')} · {t('pm.showAll')}
            </button>
          )}
        </>
      )}
    </section>
  )
}

const IssueRowView = memo(function IssueRowView({ issue }: { issue: IssueRow }) {
  const v = useView()
  const { t, fmt } = useI18n()
  const navigate = useNavigate()
  const active = v.cursor === issue.ref
  const checked = v.checked.has(issue.ref)
  const open = () => {
    rememberNav(v.all().map((x) => x.ref), location.pathname + location.search)
    navigate({ to: `/projects/${issue.projectKey}/${issue.ref}` })
  }
  return (
    <IssueContextMenu issue={issue}>
      <li
        data-ref={issue.ref}
        onMouseEnter={() => v.setCursor(issue.ref)}
        onClick={(e) => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) v.toggleChecked(issue.ref)
          else open()
        }}
        className={cx(
          'group flex h-11 cursor-pointer items-center gap-2 border-b border-line px-3 text-sm transition-colors max-md:h-auto max-md:min-h-14 max-md:flex-wrap max-md:py-2 md:px-4',
          active && 'bg-surface-2',
          checked && 'bg-accent-soft',
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => v.toggleChecked(issue.ref)}
          onClick={(e) => e.stopPropagation()}
          aria-label={t('pm.toggleSelect')}
          className={cx('size-4 shrink-0 accent-accent', !checked && 'opacity-0 group-hover:opacity-100 max-md:hidden')}
        />
        <InlinePicker issue={issue} kind="p" />
        <span className="w-16 shrink-0 font-mono text-xs text-fg-4">{issue.ref}</span>
        <InlinePicker issue={issue} kind="s" />
        <span className={cx('flex min-w-0 flex-1 items-center gap-1.5', issue.status === 'canceled' && 'text-fg-4 line-through')}>
          <Prefix issue={issue} />
          <span className="truncate">{issue.title}</span>
          {issue.subProgress && (
            <span className="shrink-0 rounded bg-surface-2 px-1 text-[11px] text-fg-4">
              {issue.subProgress.done}/{issue.subProgress.total}
            </span>
          )}
        </span>
        <span className="hidden shrink-0 items-center gap-1 md:flex">
          {issue.labels.slice(0, 3).map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
          {issue.labels.length > 3 && <span className="text-[11px] text-fg-4">+{issue.labels.length - 3}</span>}
        </span>
        <InlinePicker issue={issue} kind="a" />
        <Tooltip label={fmt.dateTime(issue.createdAt)}>
          <span className="hidden w-16 shrink-0 text-right text-xs text-fg-4 sm:inline">{fmt.relative(issue.createdAt)}</span>
        </Tooltip>
      </li>
    </IssueContextMenu>
  )
})

/** "Blocker title +N ⃠" (warm) and "Parent ›" prefixes; blockers only count while unfinished. */
function Prefix({ issue }: { issue: IssueRow }) {
  const navigate = useNavigate()
  if (issue.blockedBy.length) {
    const first = issue.blockedBy[0]!
    return (
      <Tooltip
        label={
          <span className="flex flex-col">
            {issue.blockedBy.slice(0, 5).map((b) => (
              <span key={b.ref}>
                {b.ref} {b.title}
              </span>
            ))}
          </span>
        }
      >
        <button
          onClick={(e) => {
            e.stopPropagation()
            navigate({ to: `/projects/${first.ref.split('-')[0]}/${first.ref}` })
          }}
          className="flex max-w-48 shrink-0 items-center gap-1 rounded-md bg-warning-soft px-1.5 text-xs text-warning"
        >
          <span className="truncate">{first.title}</span>
          {issue.blockedBy.length > 1 && <span>+{issue.blockedBy.length - 1}</span>}
          <span aria-hidden>⃠</span>
        </button>
      </Tooltip>
    )
  }
  if (issue.parent)
    return (
      <span className="flex max-w-40 shrink-0 items-center gap-1 text-xs text-fg-4">
        <span className="truncate">{issue.parent.title}</span>
        <ChevronRight className="size-3" />
      </span>
    )
  return null
}

function InlinePicker({ issue, kind }: { issue: IssueRow; kind: 's' | 'p' | 'a' | 'l' }) {
  const v = useView()
  const { t } = useI18n()
  const statusOpts = useStatusOptions()
  const prioOpts = usePriorityOptions()
  const memberOpts = useAssigneeOptions(v.memberIds)
  const open = v.picker?.ref === issue.ref && v.picker.kind === kind
  const editable = canWrite(v.role ?? 'member')
  const setOpen = (o: boolean) => v.setPicker(o ? { ref: issue.ref, kind } : null)
  const rows = () => (v.checked.has(issue.ref) ? v.all().filter((i) => v.checked.has(i.ref)) : [issue])
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  if (kind === 's')
    return (
      <OptionPicker
        options={statusOpts}
        value={[issue.status]}
        onChange={([s]) => applyPatch(rows(), { status: s as Status }, t)}
        placeholder={t('picker.status')}
        open={open}
        onOpenChange={setOpen}
        trigger={
          <button disabled={!editable} onClick={stop} aria-label={t('issue.status')} className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-surface-3">
            <IssueStatusIcon status={issue.status} />
          </button>
        }
      />
    )
  if (kind === 'p')
    return (
      <OptionPicker
        options={prioOpts}
        value={[issue.priority]}
        onChange={([p]) => applyPatch(rows(), { priority: p as IssueRow['priority'] }, t)}
        placeholder={t('picker.priority')}
        open={open}
        onOpenChange={setOpen}
        trigger={
          <button disabled={!editable} onClick={stop} aria-label={t('issue.priority')} className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-surface-3">
            <PriorityIcon priority={issue.priority} />
          </button>
        }
      />
    )
  if (kind === 'a')
    return (
      <OptionPicker
        options={memberOpts}
        multiple
        value={issue.assigneeIds}
        onChange={(ids) => applyPatch(rows(), { assigneeIds: ids }, t)}
        placeholder={t('picker.assignee')}
        open={open}
        onOpenChange={setOpen}
        trigger={
          <button disabled={!editable} onClick={stop} aria-label={t('issue.assignees')} className="flex h-7 min-w-7 shrink-0 items-center justify-end rounded-md px-0.5 hover:bg-surface-3">
            {issue.assigneeIds.length ? <AvatarStack ids={issue.assigneeIds} max={2} size="xs" /> : <span className="size-5 rounded-full border border-dashed border-line-strong" />}
          </button>
        }
      />
    )
  return (
    <OptionPicker
      options={labelOptions(v.labels)}
      multiple
      value={issue.labels.map((l) => l.id)}
      onChange={(ids) => applyPatch(rows(), { labelIds: ids }, t)}
      placeholder={t('picker.labels')}
      open={open}
      onOpenChange={setOpen}
      trigger={<span className="hidden" />}
    />
  )
}

function IssueContextMenu({ issue, children }: { issue: IssueRow; children: ReactNode }) {
  const v = useView()
  const { t } = useI18n()
  const me = useMe()
  const statusOpts = useStatusOptions()
  const prioOpts = usePriorityOptions()
  const memberOpts = useAssigneeOptions(v.memberIds)
  const multi = v.checked.has(issue.ref) && v.checked.size > 1
  const rows = () => (multi ? v.all().filter((i) => v.checked.has(i.ref)) : [issue])
  const editable = canWrite(v.role ?? 'member')
  const item = 'flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm text-fg-2 outline-none data-[highlighted]:bg-surface-2 max-md:h-11 [&_svg]:size-4'
  const panel = 'anim-pop z-[60] min-w-52 rounded-xl border border-line bg-surface p-1 shadow-card'
  const sub = (label: string, opts: { value: string; label: string; icon?: ReactNode }[], apply: (v: string) => void, current: string[]) => (
    <CM.Sub>
      <CM.SubTrigger className={item}>
        <span className="flex-1">{label}</span>
        <ChevronRight />
      </CM.SubTrigger>
      <CM.Portal>
        <CM.SubContent data-layer className={panel}>
          {opts.map((o) => (
            <CM.Item key={o.value} className={item} onSelect={() => apply(o.value)}>
              {o.icon}
              <span className="flex-1 truncate">{o.label}</span>
              {current.includes(o.value) && <span className="size-1.5 rounded-full bg-accent" />}
            </CM.Item>
          ))}
        </CM.SubContent>
      </CM.Portal>
    </CM.Sub>
  )
  return (
    <CM.Root>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content data-layer className={panel}>
          <CM.Label className="px-2.5 py-1.5 text-[11px] font-semibold text-fg-4">{multi ? t('pm.issues', { n: v.checked.size }) : issue.ref}</CM.Label>
          {editable && (
            <>
              {sub(t('issue.status'), statusOpts, (s) => applyPatch(rows(), { status: s as Status }, t), [issue.status])}
              {sub(t('issue.priority'), prioOpts, (p) => applyPatch(rows(), { priority: p as IssueRow['priority'] }, t), [issue.priority])}
              {sub(t('issue.assignees'), memberOpts, (id) => applyPatch(rows(), { assigneeIds: multi ? [id] : issue.assigneeIds.includes(id) ? issue.assigneeIds.filter((x) => x !== id) : [...issue.assigneeIds, id] }, t), multi ? [] : issue.assigneeIds)}
              {sub(t('issue.labels'), labelOptions(v.labels), (id) => {
                const cur = issue.labels.map((l) => l.id)
                applyPatch(rows(), { labelIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }, t)
              }, issue.labels.map((l) => l.id))}
              <CM.Item className={item} onSelect={() => applyPatch(rows(), { assigneeIds: [...new Set([...issue.assigneeIds, me.id])] }, t)}>
                <UserPlus /> <span className="flex-1">{t('pm.assignMe')}</span> <Kbd keys="i" />
              </CM.Item>
            </>
          )}
          <CM.Separator className="my-1 h-px bg-line" />
          {!multi && editable && (
            <CM.Item className={item} onSelect={() => openCreateIssue({ projectKey: issue.projectKey, parentRef: issue.ref })}>
              <GitBranch /> {t('pm.rel.child')}
            </CM.Item>
          )}
          {!multi && editable && (
            <CM.Item className={item} onSelect={() => openDuplicate(issue)}>
              <CopyPlus /> {t('dup.action')}
            </CM.Item>
          )}
          <CM.Item className={item} onSelect={() => copyRefs(rows(), false, t)}>
            <Copy /> <span className="flex-1">{t('pm.copyId')}</span> <Kbd keys="mod+c" />
          </CM.Item>
          <CM.Item className={item} onSelect={() => copyRefs(rows(), true, t)}>
            <Link2 /> <span className="flex-1">{t('pm.copyLink')}</span> <Kbd keys="mod+shift+c" />
          </CM.Item>
          {editable && (
            <>
              <CM.Separator className="my-1 h-px bg-line" />
              <CM.Item
                className={cx(item, 'text-danger [&_svg]:text-danger')}
                onSelect={async () => {
                  const list = rows()
                  if (!(await confirm({ title: multi ? t('pm.deleteIssues', { n: list.length }) : `${t('common.delete')} ${issue.ref}`, body: t('pm.deleteConfirm'), danger: true }))) return
                  await Promise.all(list.map((r) => api(`/api/issues/${r.ref}`, { method: 'DELETE' }).catch(toastError)))
                  invalidateIssues()
                }}
              >
                <Trash2 /> {multi ? t('pm.deleteIssues', { n: v.checked.size }) : t('common.delete')}
              </CM.Item>
            </>
          )}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  )
}

// ---------- board ----------

export function IssueBoard({ filters }: { filters: Filters }) {
  const counts = useCounts(useView().scope, filters)
  // Done/canceled start folded; so does any empty column (except Todo, the default drop target).
  const [toggled, setToggled] = useState<Map<Status, boolean>>(new Map())
  const isOpen = (s: Status) => toggled.get(s) ?? (!isDone(s) && (s === 'todo' || (counts.data?.[s] ?? 0) > 0))
  return (
    <div className="flex h-full min-h-[60vh] gap-3 overflow-x-auto p-3 md:p-4 max-md:snap-x max-md:snap-mandatory">
      {STATUSES.map((s) => (
        <Column
          key={s}
          status={s}
          filters={filters}
          total={counts.data?.[s] ?? 0}
          expanded={isOpen(s)}
          onToggle={() => setToggled((m) => new Map(m).set(s, !isOpen(s)))}
        />
      ))}
    </div>
  )
}

function Column({ status, filters, total, expanded, onToggle }: { status: Status; filters: Filters; total: number; expanded: boolean; onToggle(): void }) {
  const v = useView()
  const { t } = useI18n()
  const q = useStatusIssues(v.scope, filters, status, expanded)
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data])
  useEffect(() => {
    v.register(status, expanded ? rows : [])
  }, [v, status, rows, expanded])
  const [over, setOver] = useState<{ index: number } | null>(null)
  const editable = canWrite(v.role ?? 'member')

  const onDrop = async (e: DragEvent, index: number) => {
    e.preventDefault()
    setOver(null)
    const ref = e.dataTransfer.getData('text/issue')
    const issue = v.all().find((i) => i.ref === ref)
    if (!issue || !editable) return
    const list = rows.filter((r) => r.ref !== ref)
    const before = list[index - 1]?.ref ?? null
    const after = list[index]?.ref ?? null
    // Optimistic: drop it in place in the cache.
    const snapshot = queryClient.getQueriesData({ queryKey: ['issues'] })
    queryClient.setQueriesData<InfiniteData<{ items: IssueRow[]; total: number }>>({ queryKey: ['issues', v.scope, filters] }, (d) => {
      if (!d) return d
      return { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((i) => i.ref !== ref) })) }
    })
    queryClient.setQueryData<InfiniteData<{ items: IssueRow[]; total: number }>>(['issues', v.scope, filters, status, 0], (d) => {
      if (!d || !d.pages[0]) return d
      const items = [...d.pages[0].items.filter((i) => i.ref !== ref)]
      items.splice(index, 0, { ...issue, status })
      return { ...d, pages: [{ ...d.pages[0], items }, ...d.pages.slice(1)] }
    })
    try {
      await api(`/api/issues/${ref}/move`, { method: 'POST', body: { version: issue.version, status: status !== issue.status ? status : undefined, beforeRef: before, afterRef: after } })
    } catch (err) {
      snapshot.forEach(([k, d]) => queryClient.setQueryData(k, d))
      if (err instanceof ApiError && err.code === 'conflict') toast(t('error.conflict'), 'error')
      else toastError(err)
    } finally {
      invalidateIssues()
    }
  }

  if (!expanded)
    return (
      <button
        data-column={status}
        onClick={onToggle}
        onDragOver={(e) => {
          e.preventDefault()
          setOver({ index: 0 })
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => onDrop(e, 0)}
        className={cx('flex w-11 shrink-0 flex-col items-center gap-2 rounded-2xl border bg-surface-2 py-3 text-xs text-fg-3 transition-colors hover:bg-surface-3', over ? 'border-accent bg-accent-soft' : 'border-line')}
        aria-label={t(`status.${status}` as MsgKey)}
      >
        <IssueStatusIcon status={status} />
        <span className="[writing-mode:vertical-rl]">{t(`status.${status}` as MsgKey)}</span>
        <span className="text-fg-4">{total}</span>
      </button>
    )
  return (
    <div
      data-column={status}
      className="flex min-w-60 flex-1 flex-col rounded-2xl bg-surface-2 md:max-w-80 max-md:w-[85vw] max-md:shrink-0 max-md:snap-center"
      onDragOver={(e) => {
        e.preventDefault()
        if (!over) setOver({ index: rows.length })
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null)
      }}
      onDrop={(e) => onDrop(e, over?.index ?? rows.length)}
    >
      <div className="flex h-11 items-center gap-2 px-3">
        <button onClick={onToggle} className="flex items-center gap-2 text-[13px] font-semibold">
          <IssueStatusIcon status={status} />
          {t(`status.${status}` as MsgKey)}
        </button>
        <span className="text-xs text-fg-4">
          {rows.length}／{total}
        </span>
        <div className="flex-1" />
        {editable && v.scope.key && <IconButton label={t('pm.newHint', { status: t(`status.${status}` as MsgKey) })} icon={<Plus />} size="sm" onClick={() => openCreateIssue({ projectKey: v.scope.key, status })} />}
      </div>
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {rows.map((i, idx) => (
          <div
            key={i.ref}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const r = e.currentTarget.getBoundingClientRect()
              setOver({ index: e.clientY < r.top + r.height / 2 ? idx : idx + 1 })
            }}
          >
            {over?.index === idx && <DropLine />}
            <Card issue={i} draggable={editable} />
          </div>
        ))}
        {over?.index === rows.length && <DropLine />}
        {q.hasNextPage && (
          <button className="py-1 text-xs text-accent-text" onClick={() => q.fetchNextPage()}>
            {t('common.loadMore')}
          </button>
        )}
      </div>
    </div>
  )
}

const DropLine = () => <motion.div layoutId="drop-line" className="my-1 h-0.5 rounded-full bg-accent" />

function Card({ issue, draggable }: { issue: IssueRow; draggable: boolean }) {
  const v = useView()
  const navigate = useNavigate()
  const [dragging, setDragging] = useState(false)
  return (
    <IssueContextMenu issue={issue}>
      <motion.div
        layout
        data-ref={issue.ref}
        draggable={draggable}
        onDragStart={(e) => {
          const ev = e as unknown as DragEvent
          ev.dataTransfer.setData('text/issue', issue.ref)
          ev.dataTransfer.effectAllowed = 'move'
          setDragging(true)
        }}
        onDragEnd={() => setDragging(false)}
        onMouseEnter={() => v.setCursor(issue.ref)}
        onClick={() => {
          rememberNav(v.all().map((x) => x.ref), location.pathname + location.search)
          navigate({ to: `/projects/${issue.projectKey}/${issue.ref}` })
        }}
        className={cx(
          'cursor-pointer rounded-xl border border-line bg-surface p-3 text-sm shadow-sm transition-[box-shadow,opacity,transform] hover:shadow-card',
          dragging && 'opacity-40',
          v.cursor === issue.ref && 'ring-2 ring-accent-soft',
          v.checked.has(issue.ref) && 'ring-2 ring-accent',
        )}
      >
        <div className="mb-1 flex items-center gap-1.5 text-xs text-fg-4">
          <PriorityIcon priority={issue.priority} />
          <span className="font-mono">{issue.ref}</span>
          <div className="flex-1" />
          {issue.assigneeIds.length > 0 && <AvatarStack ids={issue.assigneeIds} max={3} size="xs" />}
        </div>
        <div className={cx('flex flex-wrap items-center gap-1', issue.status === 'canceled' && 'text-fg-4 line-through')}>
          <Prefix issue={issue} />
          <span className="leading-snug">{issue.title}</span>
        </div>
        {issue.labels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {issue.labels.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
          </div>
        )}
      </motion.div>
    </IssueContextMenu>
  )
}
