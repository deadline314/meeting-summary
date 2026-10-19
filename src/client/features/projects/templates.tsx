import { useQuery } from '@tanstack/react-query'
import { FileText, Plus, Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api, queryClient } from '../../lib/api'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { isAdminRole, useMe } from '../../lib/session'
import { Button, IconButton } from '../../ui/button'
import { confirm } from '../../ui/dialog'
import { Field, Input, Select, Textarea } from '../../ui/field'
import { Badge, Card, EmptyState } from '../../ui/misc'
import { toast, toastError } from '../../ui/toast'
import { canManage, type ProjectDetail } from './model'

export type Template = { id: string; scope: 'user' | 'project' | 'global'; ownerId: string | null; projectId: string | null; name: string; body: string; isDefault: boolean }

export const useTemplates = (key?: string) =>
  useQuery({
    queryKey: ['issue-templates', key ?? ''],
    queryFn: () => api<{ items: Template[]; defaultId: string | null }>(`/api/issue-templates${key ? `?key=${key}` : ''}`),
    staleTime: 60_000,
  })
const refresh = () => queryClient.invalidateQueries({ queryKey: ['issue-templates'] })

/** Project settings tab: my templates, this project's, and the site-wide ones. */
export function TemplatesManager({ p }: { p: ProjectDetail }) {
  const { t } = useI18n()
  const me = useMe()
  const q = useTemplates(p.key)
  const [editing, setEditing] = useState<Partial<Template> | null>(null)
  const canEdit = (x: Pick<Template, 'scope' | 'ownerId'>) => (x.scope === 'user' ? x.ownerId === me.id : x.scope === 'project' ? canManage(p.role) : isAdminRole(me.role))
  const scopes = (['user', 'project', 'global'] as const).filter((s) => canEdit({ scope: s, ownerId: me.id }))
  if (editing) return <TemplateForm p={p} value={editing} scopes={scopes} onDone={() => setEditing(null)} />
  const items = q.data?.items ?? []
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-3">{t('tpl.hint')}</p>
      <Button size="sm" variant="primary" className="self-start" icon={<Plus className="size-4" />} onClick={() => setEditing({ scope: 'user', name: '', body: '', isDefault: false })}>
        {t('tpl.new')}
      </Button>
      {items.length ? (
        <Card className="divide-y divide-line">
          {items.map((x) => (
            <div key={x.id} className="flex items-center gap-3 px-4 py-3">
              <FileText className="size-4 shrink-0 text-fg-4" />
              <button className="min-w-0 flex-1 text-left" disabled={!canEdit(x)} onClick={() => setEditing(x)}>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{x.name}</span>
                  <Badge>{t(`tpl.scope.${x.scope}` as MsgKey)}</Badge>
                  {x.id === q.data?.defaultId && (
                    <Badge tone="accent">
                      <Star className="mr-0.5 size-3" />
                      {t('tpl.default')}
                    </Badge>
                  )}
                </div>
                <div className="truncate text-xs text-fg-4">{x.body.split('\n')[0]}</div>
              </button>
              {canEdit(x) && (
                <IconButton
                  label={t('common.delete')}
                  icon={<Trash2 />}
                  size="sm"
                  onClick={async () => {
                    if (await confirm({ title: `${t('common.delete')}「${x.name}」`, danger: true })) api(`/api/issue-templates/${x.id}`, { method: 'DELETE' }).then(refresh, (e) => toastError(e))
                  }}
                />
              )}
            </div>
          ))}
        </Card>
      ) : (
        <EmptyState icon={<FileText />} title={t('tpl.empty')} hint={t('tpl.emptyHint')} />
      )}
    </div>
  )
}

function TemplateForm({ p, value, scopes, onDone }: { p: ProjectDetail; value: Partial<Template>; scopes: Template['scope'][]; onDone(): void }) {
  const { t } = useI18n()
  const [v, setV] = useState({ scope: value.scope ?? 'user', name: value.name ?? '', body: value.body ?? '', isDefault: value.isDefault ?? false })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await api(value.id ? `/api/issue-templates/${value.id}` : '/api/issue-templates', { method: value.id ? 'PUT' : 'POST', body: { ...v, key: p.key } })
      refresh()
      toast(t('common.saved'))
      onDone()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('tpl.name')}>{(id) => <Input id={id} autoFocus value={v.name} maxLength={60} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <Field label={t('tpl.scope')}>
          {(id) => (
            <Select id={id} value={v.scope} disabled={!!value.id} onChange={(e) => setV({ ...v, scope: e.target.value as Template['scope'] })}>
              {scopes.map((s) => (
                <option key={s} value={s}>
                  {t(`tpl.scope.${s}` as MsgKey)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label={t('tpl.body')}>{(id) => <Textarea id={id} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} className="min-h-48 font-mono text-[13px]" />}</Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-accent" checked={v.isDefault} onChange={(e) => setV({ ...v, isDefault: e.target.checked })} />
        {t('tpl.makeDefault')}
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" loading={busy} disabled={!v.name.trim()} onClick={save}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}
