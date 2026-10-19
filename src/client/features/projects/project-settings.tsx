import { useNavigate } from '@tanstack/react-router'
import { Archive, CheckCircle2, RotateCcw, Trash2, UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import { api, queryClient } from '../../lib/api'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { useDirectory, useMe } from '../../lib/session'
import { UserAvatar, UserName } from '../../ui/avatar'
import { Button, IconButton } from '../../ui/button'
import { cx } from '../../ui/cx'
import { Dialog, confirm } from '../../ui/dialog'
import { Field, Input, Select, Textarea } from '../../ui/field'
import { Badge } from '../../ui/misc'
import { TabBar } from '../../ui/tabs'
import { toast, toastError } from '../../ui/toast'
import { UserPicker } from '../../ui/user-picker'
import { canManage, invalidateIssues, useLabels, type ProjectDetail } from './model'
import { LabelChip } from './pickers'

export type SettingsTab = 'general' | 'members' | 'labels' | 'lifecycle'

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
          { value: 'lifecycle', label: t('settings.pm.lifecycle') },
        ]}
      />
      <div className="pt-5 pb-2">
        {tab === 'general' && <General p={project} />}
        {tab === 'members' && <Members p={project} />}
        {tab === 'labels' && <Labels p={project} />}
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
      {p.role === 'owner' && (
        <label className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-accent" checked={p.hiddenFromAdmins} onChange={(e) => save({ hiddenFromAdmins: e.target.checked })} />
          <span>
            <span className="font-medium">{t('settings.pm.hidden')}</span>
            <span className="block text-xs text-fg-4">{t('settings.pm.hiddenHint')}</span>
          </span>
        </label>
      )}
      {editable && (
        <Button variant="primary" className="self-end" loading={busy} onClick={() => save({ name: name.trim(), description, reviewerId: reviewerId || null, targetDate: target ? new Date(`${target}T23:59:00`).getTime() : null, staleDays })}>
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

function Members({ p }: { p: ProjectDetail }) {
  const { t } = useI18n()
  const me = useMe()
  const dir = useDirectory()
  const editable = canManage(p.role)
  const add = async (userId: string) => {
    try {
      const r = await api<{ becameShared: boolean }>(`/api/projects/${p.key}/members`, { method: 'POST', body: { userId, role: 'member' } })
      refresh(p.key)
      if (r.becameShared) toast(t('settings.pm.nowShared'), 'info')
    } catch (err) {
      toastError(err)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      {editable && (
        <UserPicker
          value={p.members.map((m) => m.userId)}
          onChange={(ids) => {
            const added = ids.find((id) => !p.members.some((m) => m.userId === id))
            if (added) add(added)
          }}
          trigger={
            <Button className="self-start" icon={<UserPlus className="size-4" />}>
              {t('settings.pm.addMember')}
            </Button>
          }
        />
      )}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {p.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 px-3 py-2.5">
            <UserAvatar id={m.userId} size="sm" />
            <UserName id={m.userId} className="flex-1 truncate text-sm" />
            {editable ? (
              <Select
                value={m.role}
                className="h-9 w-auto"
                aria-label={t('settings.role')}
                onChange={(e) =>
                  api(`/api/projects/${p.key}/members/${m.userId}`, { method: 'PATCH', body: { role: e.target.value } }).then(
                    () => refresh(p.key),
                    (err) => toastError(err),
                  )
                }
              >
                {(['viewer', 'member', 'owner'] as const).map((r) => (
                  <option key={r} value={r}>
                    {t(`role.project.${r}`)}
                  </option>
                ))}
              </Select>
            ) : (
              <Badge>{t(`role.project.${m.role}`)}</Badge>
            )}
            {(editable || m.userId === me.id) && (
              <IconButton
                label={t('settings.pm.removeMember')}
                icon={<X />}
                size="sm"
                onClick={async () => {
                  const name = dir.get(m.userId)?.name ?? ''
                  if (!(await confirm({ title: t('settings.pm.removeMember'), body: t('settings.pm.removeConfirm', { name }), danger: true }))) return
                  try {
                    await api(`/api/projects/${p.key}/members/${m.userId}`, { method: 'DELETE' })
                    refresh(p.key)
                    invalidateIssues()
                  } catch (err) {
                    toastError(err)
                  }
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

function Lifecycle({ p, onClose }: { p: ProjectDetail; onClose(): void }) {
  const { t } = useI18n()
  const me = useMe()
  const navigate = useNavigate()
  const [typed, setTyped] = useState('')
  const owner = canManage(p.role)
  const act = async (action: 'close' | 'reopen' | 'archive' | 'restore') => {
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
