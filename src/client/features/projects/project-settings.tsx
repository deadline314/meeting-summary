import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { TemplatesManager } from './templates'
import { Archive, CheckCircle2, ChevronDown, Lock, RotateCcw, Trash2, UserPlus, Users, UsersRound, X } from 'lucide-react'
import { useState } from 'react'
import { api, queryClient } from '../../lib/api'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { useDirectory, useMe } from '../../lib/session'
import { UserAvatar, UserName } from '../../ui/avatar'
import { Button, IconButton } from '../../ui/button'
import { cx } from '../../ui/cx'
import { Dialog, confirm } from '../../ui/dialog'
import { Field, Input, Select, Textarea } from '../../ui/field'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/menu'
import { Badge } from '../../ui/misc'
import { TabBar } from '../../ui/tabs'
import { toast, toastError } from '../../ui/toast'
import { UserPicker } from '../../ui/user-picker'
import { MAX_PROJECT_DEPTH, canManage, invalidateIssues, levelOf, subtreeIds, treeOrder, useLabels, useProjects, type ProjectDetail, type ProjectRole } from './model'
import { LabelChip } from './pickers'

export type SettingsTab = 'general' | 'members' | 'labels' | 'templates' | 'lifecycle'

const refresh = (key: string) => {
  queryClient.invalidateQueries({ queryKey: ['project', key] })
  queryClient.invalidateQueries({ queryKey: ['projects'] })
}

export function ProjectSettings({ project, tab, onTab, onClose }: { project: ProjectDetail; tab: SettingsTab; onTab(t: SettingsTab): void; onClose(): void }) {
  const { t } = useI18n()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${t('pm.settings')} · ${project.key}`} size="lg">
      <TabBar
        value={tab}
        onChange={onTab}
        tabs={[
          { value: 'general', label: t('settings.pm.general') },
          { value: 'members', label: t('settings.pm.members') },
          { value: 'labels', label: t('settings.pm.labels') },
          { value: 'templates', label: t('tpl.title') },
          { value: 'lifecycle', label: t('settings.pm.lifecycle') },
        ]}
      />
      <div className="pt-5 pb-2">
        {tab === 'general' && <General p={project} />}
        {tab === 'members' && <Members p={project} />}
        {tab === 'labels' && <Labels p={project} />}
        {tab === 'templates' && <TemplatesManager p={project} />}
        {tab === 'lifecycle' && <Lifecycle p={project} onClose={onClose} />}
      </div>
    </Dialog>
  )
}

function General({ p }: { p: ProjectDetail }) {
  const { t } = useI18n()
  const editable = canManage(p.role)
  const [name, setName] = useState(p.name)
  const [description, setDescription] = useState(p.description)
  const [reviewerId, setReviewer] = useState(p.reviewerId ?? '')
  const [target, setTarget] = useState(p.targetDate ? new Date(p.targetDate).toISOString().slice(0, 10) : '')
  const [staleDays, setStaleDays] = useState(p.staleDays)
  const [parentId, setParentId] = useState(p.parentId ?? '')
  const parents = useParentOptions(p.id)
  const [busy, setBusy] = useState(false)
  const save = async (patch: Record<string, unknown>) => {
    setBusy(true)
    try {
      await api(`/api/projects/${p.key}`, { method: 'PATCH', body: { version: p.version, ...patch } })
      refresh(p.key)
      toast(t('common.saved'))
    } catch (err) {
      toastError(err)
      refresh(p.key)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <Field label={t('pm.field.name')}>{(id) => <Input id={id} value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label={t('pm.field.description')}>{(id) => <Textarea id={id} value={description} disabled={!editable} onChange={(e) => setDescription(e.target.value)} />}</Field>
      <Field label={t('pm.field.parent')} hint={t('pm.parent.hint', { n: MAX_PROJECT_DEPTH })}>
        {(id) => (
          <Select id={id} value={parentId} disabled={p.role !== 'owner'} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{t('pm.parent.none')}</option>
            {/* The current parent stays listed even when it is not offered as a new choice. */}
            {[...parents, ...(p.parentId && !parents.some((x) => x.id === p.parentId) ? [{ id: p.parentId, key: p.ancestors.at(-1)?.key ?? '…', name: p.ancestors.at(-1)?.name ?? '', depth: 0 }] : [])].map((x) => (
              <option key={x.id} value={x.id}>
                {'\u00a0\u00a0'.repeat(x.depth)}
                {x.key} · {x.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('pm.field.reviewer')}>
        {(id) => (
          <Select id={id} value={reviewerId} disabled={!editable} onChange={(e) => setReviewer(e.target.value)}>
            <option value="">{t('common.none')}</option>
            {p.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {/* names resolve live from the directory */}
                <UserNameText id={m.userId} />
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('pm.field.target')}>
          {(id) => <Input id={id} type="date" value={target} disabled={!editable} onChange={(e) => setTarget(e.target.value)} />}
        </Field>
        <Field label={t('pm.field.stale')} hint={t('pm.field.staleHint')}>
          {(id) => (
            <Select id={id} value={staleDays} disabled={!editable} onChange={(e) => setStaleDays(Number(e.target.value))}>
              {[3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {t('tl.days', { n: d })}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {editable && (
        <Button variant="primary" className="self-end" loading={busy} onClick={() => save({ name: name.trim(), description, reviewerId: reviewerId || null, targetDate: target ? new Date(`${target}T23:59:00`).getTime() : null, staleDays, ...(p.role === 'owner' && parentId !== (p.parentId ?? '') ? { parentId: parentId || null } : {}) })}>
          {t('common.save')}
        </Button>
      )}
    </div>
  )
}

function UserNameText({ id }: { id: string }) {
  const dir = useDirectory()
  return <>{dir.get(id)?.name ?? '…'}</>
}

/** Projects this one may move under: ones I work in, outside its own subtree, within the depth limit. */
export function useParentOptions(selfId?: string) {
  const all = useProjects().data ?? []
  const below = selfId ? subtreeIds(all, selfId) : new Set<string>()
  const height = selfId ? Math.max(0, ...[...below].map((id) => levelOf(all, id) - levelOf(all, selfId))) : 0
  return treeOrder(all)
    .filter(({ p: x }) => x.state === 'active' && (x.role === 'member' || x.role === 'owner' || x.role === 'admin') && !below.has(x.id) && levelOf(all, x.id) + 1 + height <= MAX_PROJECT_DEPTH)
    .map(({ p: x, depth }) => ({ id: x.id, key: x.key, name: x.name, depth }))
}

const ROLES = ['viewer', 'member', 'owner'] as const

/** Role dropdown where each role says what it allows. */
export function RoleSelect({ value, onChange, disabled }: { value: ProjectRole; onChange(r: ProjectRole): void; disabled?: boolean }) {
  const { t } = useI18n()
  if (disabled) return <Badge>{t(`role.project.${value}`)}</Badge>
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="sm" aria-label={t('settings.role')} className="min-w-24 justify-between">
          {t(`role.project.${value}`)}
          <ChevronDown className="size-4 text-fg-4" />
        </Button>
      </MenuTrigger>
      <MenuContent className="w-64">
        {ROLES.map((r) => (
          <MenuItem key={r} checked={r === value} hint={t(`role.project.${r}.hint`)} onSelect={() => r !== value && onChange(r)}>
            {t(`role.project.${r}`)}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}

/** Who can open this project right now, in one line, with the owner's switch for admins. */
function WhoCanSee({ p, onHidden }: { p: ProjectDetail; onHidden(v: boolean): void }) {
  const { t } = useI18n()
  const n = p.members.length
  const [icon, title] = n <= 1 ? [<Lock key="i" />, t('pm.who.private')] : p.hiddenFromAdmins ? [<Users key="i" />, t('pm.who.members', { n })] : [<UsersRound key="i" />, t('pm.who.shared', { n })]
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-surface-2 p-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-fg-3">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-xs text-fg-4">{n <= 1 ? t('pm.who.privateHint') : t('pm.who.hint')}</div>
      </div>
      {p.role === 'owner' && n > 1 && (
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-fg-2 md:min-h-0">
          <input type="checkbox" className="size-4 accent-accent" checked={p.hiddenFromAdmins} onChange={(e) => onHidden(e.target.checked)} />
          {t('settings.pm.hidden')}
        </label>
      )}
    </div>
  )
}

function Members({ p }: { p: ProjectDetail }) {
  const { t } = useI18n()
  const me = useMe()
  const dir = useDirectory()
  const editable = canManage(p.role)
  const [pending, setPending] = useState<string[]>([])
  const [role, setRole] = useState<ProjectRole>('member')
  const [busy, setBusy] = useState(false)
  const memberIds = new Set(p.members.map((m) => m.userId))
  // Changes show at once; a refusal (e.g. the last owner) puts the old list back and says why.
  const optimistic = async (next: (m: ProjectDetail['members']) => ProjectDetail['members'], send: () => Promise<unknown>) => {
    queryClient.cancelQueries({ queryKey: ['project', p.key] })
    const prev = queryClient.getQueryData<ProjectDetail>(['project', p.key])
    queryClient.setQueryData<ProjectDetail>(['project', p.key], (d) => (d ? { ...d, members: next(d.members) } : d))
    try {
      await send()
      return true
    } catch (err) {
      queryClient.setQueryData(['project', p.key], prev)
      toastError(err)
      return false
    } finally {
      refresh(p.key)
    }
  }
  const addAll = async () => {
    setBusy(true)
    const ids = pending
    const ok = await optimistic(
      (m) => [...m, ...ids.map((userId) => ({ userId, role }))],
      () => api(`/api/projects/${p.key}/members`, { method: 'POST', body: { userIds: ids, role } }),
    )
    setBusy(false)
    if (!ok) return
    setPending([])
    if (memberIds.size <= 1) toast(t('settings.pm.nowShared'), 'info')
  }
  return (
    <div className="flex flex-col gap-3">
      <WhoCanSee
        p={p}
        onHidden={(v) => {
          // An in-flight refetch would land after this and undo it.
          queryClient.cancelQueries({ queryKey: ['project', p.key] })
          const prev = queryClient.getQueryData<ProjectDetail>(['project', p.key])
          queryClient.setQueryData<ProjectDetail>(['project', p.key], (d) => (d ? { ...d, hiddenFromAdmins: v } : d))
          api(`/api/projects/${p.key}`, { method: 'PATCH', body: { hiddenFromAdmins: v } }).then(
            () => refresh(p.key),
            (err) => (queryClient.setQueryData(['project', p.key], prev), toastError(err)),
          )
        }}
      />
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <UserPicker
            multiple
            value={pending}
            onChange={setPending}
            filter={(id) => !memberIds.has(id)}
            trigger={<Button icon={<UserPlus className="size-4" />}>{t('settings.pm.addMember')}</Button>}
          />
          {pending.length > 0 && (
            <>
              {pending.map((id) => (
                <span key={id} className="anim-rise inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface-2 pr-1 pl-1">
                  <UserAvatar id={id} size="xs" />
                  <UserName id={id} className="text-[13px]" />
                  <button type="button" aria-label={t('common.delete')} onClick={() => setPending((p) => p.filter((x) => x !== id))} className="rounded-full p-0.5 text-fg-4 hover:bg-surface-3 hover:text-fg">
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
              <RoleSelect value={role} onChange={setRole} />
              <Button variant="primary" size="sm" loading={busy} onClick={addAll}>
                {t('settings.pm.addN', { n: pending.length })}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPending([])}>
                {t('common.cancel')}
              </Button>
            </>
          )}
        </div>
      )}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {p.members.map((m) => (
          <li key={m.userId} className="anim-rise flex min-h-14 items-center gap-3 px-3 py-2">
            <UserAvatar id={m.userId} size="sm" />
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <UserName id={m.userId} className="truncate text-sm" />
              {m.userId === me.id && <span className="shrink-0 text-xs text-fg-4">{t('settings.pm.you')}</span>}
            </span>
            <RoleSelect
              value={m.role}
              disabled={!editable}
              onChange={(r) =>
                optimistic(
                  (list) => list.map((x) => (x.userId === m.userId ? { ...x, role: r } : x)),
                  () => api(`/api/projects/${p.key}/members/${m.userId}`, { method: 'PATCH', body: { role: r } }),
                )
              }
            />
            {(editable || m.userId === me.id) && (
              <IconButton
                label={m.userId === me.id ? t('settings.pm.leave') : t('settings.pm.removeMember')}
                icon={<X />}
                size="sm"
                onClick={async () => {
                  const self = m.userId === me.id
                  const name = dir.get(m.userId)?.name ?? ''
                  const ok = await confirm({
                    title: self ? t('settings.pm.leave') : t('settings.pm.removeMember'),
                    body: self ? t('settings.pm.leaveConfirm') : t('settings.pm.removeConfirm', { name }),
                    confirmLabel: self ? t('settings.pm.leave') : t('settings.pm.removeMember'),
                    danger: true,
                  })
                  if (!ok) return
                  if (await optimistic((list) => list.filter((x) => x.userId !== m.userId), () => api(`/api/projects/${p.key}/members/${m.userId}`, { method: 'DELETE' }))) invalidateIssues()
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Labels({ p }: { p: ProjectDetail }) {
  const { t } = useI18n()
  const labels = useLabels(p.key)
  const editable = canManage(p.role)
  const [name, setName] = useState('')
  const [color, setColor] = useState(1)
  const reload = () => queryClient.invalidateQueries({ queryKey: ['labels', p.key] })
  return (
    <div className="flex flex-col gap-4">
      {editable && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!name.trim()) return
            try {
              await api(`/api/projects/${p.key}/labels`, { method: 'POST', body: { name: name.trim(), color } })
              setName('')
              reload()
            } catch (err) {
              toastError(err)
            }
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.pm.newLabel')} aria-label={t('settings.pm.newLabel')} className="w-48" />
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`color ${c}`}
                onClick={() => setColor(c)}
                className={cx('size-7 rounded-full border-2 transition-transform', color === c ? 'scale-110 border-fg' : 'border-transparent')}
                style={{ background: `var(--t-label-${c}-fg)` }}
              />
            ))}
          </div>
          <Button type="submit" variant="primary" size="sm" disabled={!name.trim()}>
            {t('common.create')}
          </Button>
        </form>
      )}
      <div className="flex flex-wrap gap-2">
        {labels.data?.map((l) => (
          <span key={l.id} className="inline-flex items-center gap-1">
            <LabelChip label={l} />
            {editable && (
              <button aria-label={t('common.delete')} className="text-fg-4 hover:text-danger" onClick={() => api(`/api/projects/${p.key}/labels/${l.id}`, { method: 'DELETE' }).then(reload, (e) => toastError(e))}>
                <X className="size-3.5" />
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Soft-deleted issues; owners bring them back with their number, history and comments intact. */
function DeletedIssues({ projectKey }: { projectKey: string }) {
  const { t, fmt } = useI18n()
  const q = useQuery({ queryKey: ['trash', projectKey], queryFn: async () => (await api<{ items: { ref: string; title: string; deletedAt: number }[] }>(`/api/projects/${projectKey}/trash`)).items })
  if (!q.data?.length) return null
  return (
    <div className="rounded-xl border border-line">
      <div className="border-b border-line px-4 py-2.5 font-semibold">{t('trash.title')}</div>
      <ul className="divide-y divide-line">
        {q.data.map((i) => (
          <li key={i.ref} className="flex items-center gap-3 px-4 py-2">
            <span className="font-mono text-xs text-fg-4">{i.ref}</span>
            <span className="min-w-0 flex-1 truncate">{i.title}</span>
            <span className="hidden text-xs text-fg-4 sm:inline">{fmt.relative(i.deletedAt)}</span>
            <Button
              size="sm"
              icon={<RotateCcw className="size-3.5" />}
              onClick={() =>
                api(`/api/issues/${i.ref}/restore`, { method: 'POST' }).then(() => {
                  toast(t('trash.restored', { ref: i.ref }))
                  queryClient.invalidateQueries({ queryKey: ['trash', projectKey] })
                  invalidateIssues()
                }, toastError)
              }
            >
              {t('trash.restore')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Lifecycle({ p, onClose }: { p: ProjectDetail; onClose(): void }) {
  const { t } = useI18n()
  const me = useMe()
  const navigate = useNavigate()
  const [typed, setTyped] = useState('')
  const owner = canManage(p.role)
  const act = async (action: 'close' | 'reopen' | 'archive' | 'restore') => {
    if ((action === 'close' || action === 'archive') && p.children.length > 0) {
      const ok = await confirm({
        title: action === 'close' ? t('settings.pm.close') : t('settings.pm.archive'),
        body: t('settings.pm.childrenStay', { list: p.children.map((c) => c.key).join('、') }),
      })
      if (!ok) return
    }
    try {
      await api(`/api/projects/${p.key}/state`, { method: 'POST', body: { action } })
      refresh(p.key)
      invalidateIssues()
    } catch (err) {
      toastError(err)
    }
  }
  const canClose = owner || p.reviewerId === me.id
  return (
    <div className="flex flex-col gap-4 text-sm">
      {owner && p.state === 'active' && <DeletedIssues projectKey={p.key} />}
      <div className="flex items-center gap-2">
        {t('issue.status')}：<Badge tone={p.state === 'active' ? 'success' : 'neutral'}>{t(`settings.pm.state.${p.state}` as MsgKey)}</Badge>
      </div>
      {p.state === 'active' && canClose && (
        <Row hint={t('settings.pm.closeHint')}>
          <Button icon={<CheckCircle2 className="size-4" />} onClick={() => act('close')}>
            {t('settings.pm.close')}
          </Button>
        </Row>
      )}
      {p.state === 'closed' && owner && (
        <Row hint={t('settings.pm.closeHint')}>
          <Button icon={<RotateCcw className="size-4" />} onClick={() => act('reopen')}>
            {t('settings.pm.reopen')}
          </Button>
        </Row>
      )}
      {p.state !== 'archived' && owner && (
        <Row hint={t('settings.pm.archiveHint')}>
          <Button icon={<Archive className="size-4" />} onClick={() => act('archive')}>
            {t('settings.pm.archive')}
          </Button>
        </Row>
      )}
      {p.state === 'archived' && owner && (
        <>
          <Row hint={t('settings.pm.archiveHint')}>
            <Button icon={<RotateCcw className="size-4" />} onClick={() => act('restore')}>
              {t('settings.pm.restore')}
            </Button>
          </Row>
          <div className="rounded-xl border border-danger p-4">
            <div className="mb-2 font-semibold text-danger">{t('settings.pm.delete')}</div>
            <p className="mb-3 text-fg-3">{t('settings.pm.deleteHint', { key: p.key })}</p>
            <div className="flex gap-2">
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={p.key} aria-label={t('pm.field.key')} className="w-40 font-mono uppercase" />
              <Button
                variant="danger"
                icon={<Trash2 className="size-4" />}
                disabled={typed.toUpperCase() !== p.key}
                onClick={async () => {
                  try {
                    await api(`/api/projects/${p.key}`, { method: 'DELETE', body: { confirmKey: typed } })
                    queryClient.invalidateQueries({ queryKey: ['projects'] })
                    onClose()
                    navigate({ to: '/projects' })
                  } catch (err) {
                    toastError(err)
                  }
                }}
              >
                {t('settings.pm.delete')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const Row = ({ hint, children }: { hint: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
    {children}
    <span className="text-xs text-fg-4">{hint}</span>
  </div>
)
