import { useQuery } from '@tanstack/react-query'
import { Check, Copy, KeyRound, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { api, queryClient } from '../../lib/api'
import { useNow } from '../../lib/hooks'
import { useI18n, type MsgKey } from '../../lib/i18n'
import { Button, IconButton } from '../../ui/button'
import { cx } from '../../ui/cx'
import { Dialog, confirm } from '../../ui/dialog'
import { Field, Input } from '../../ui/field'
import { Badge, Card, EmptyState, Skeleton } from '../../ui/misc'
import { toast, toastError } from '../../ui/toast'
import { useProjects } from '../projects/model'

type Scope = 'read' | 'write' | 'manage'
type KeyRow = { id: string; name: string; prefix: string; scope: Scope; projectIds: string[] | null; expiresAt: number | null; lastUsedAt: number | null; revokedAt: number | null; createdAt: number }

export function ApiKeysPanel() {
  const { t, fmt } = useI18n()
  const q = useQuery({ queryKey: ['api-keys'], queryFn: async () => (await api<{ items: KeyRow[] }>('/api/me/api-keys')).items })
  const projects = useProjects()
  const [creating, setCreating] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null)
  const keyOf = (id: string) => projects.data?.find((p) => p.id === id)?.key ?? '?'
  const now = useNow(60_000)
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
            <KeyRound className="size-5" />
          </span>
          <div className="flex-1">
            <div className="font-semibold">{t('keys.title')}</div>
            <p className="text-sm text-fg-3">{t('keys.hint')}</p>
          </div>
        </div>
        <Button variant="primary" className="self-start" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          {t('keys.new')}
        </Button>
      </Card>
      <Card className="divide-y divide-line">
        {q.isPending ? (
          <Skeleton className="m-4 h-12" />
        ) : !q.data?.length ? (
          <EmptyState icon={<KeyRound />} title={t('keys.empty')} />
        ) : (
          q.data.map((k) => {
            const dead = !!k.revokedAt || (!!k.expiresAt && k.expiresAt < now)
            return (
              <div key={k.id} className={cx('flex flex-wrap items-center gap-3 px-4 py-3', dead && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {k.name}
                    <Badge tone={k.scope === 'read' ? 'neutral' : k.scope === 'write' ? 'info' : 'accent'}>{t(`keys.scope.${k.scope}`)}</Badge>
                    {k.revokedAt ? <Badge tone="danger">{t('keys.revoked')}</Badge> : k.expiresAt && k.expiresAt < now ? <Badge tone="warning">{t('keys.expired')}</Badge> : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-fg-4">
                    <span className="font-mono">{k.prefix}…</span>
                    <span>{k.projectIds ? k.projectIds.map(keyOf).join(', ') : t('keys.allProjects')}</span>
                    <span>{k.lastUsedAt ? t('keys.lastUsed', { time: fmt.relative(k.lastUsedAt) }) : t('keys.neverUsed')}</span>
                    {k.expiresAt && <span>{fmt.date(k.expiresAt)}</span>}
                  </div>
                </div>
                {!dead && (
                  <IconButton
                    label={t('keys.revoke')}
                    icon={<Trash2 />}
                    size="sm"
                    onClick={async () => {
                      if (!(await confirm({ title: `${t('keys.revoke')}「${k.name}」`, body: t('keys.revokeConfirm'), danger: true, confirmLabel: t('keys.revoke') }))) return
                      api(`/api/me/api-keys/${k.id}`, { method: 'DELETE' }).then(
                        () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
                        (e) => toastError(e),
                      )
                    }}
                  />
                )}
              </div>
            )
          })
        )}
      </Card>
      {creating && (
        <CreateKey
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            setCreating(false)
            setFresh(s)
            queryClient.invalidateQueries({ queryKey: ['api-keys'] })
          }}
        />
      )}
      {fresh && <ShowKey secret={fresh} onClose={() => setFresh(null)} />}
    </div>
  )
}

function CreateKey({ onClose, onCreated }: { onClose(): void; onCreated(secret: string): void }) {
  const { t } = useI18n()
  const projects = useProjects()
  const [name, setName] = useState('')
  const [scope, setScope] = useState<Scope>('write')
  const [projectIds, setProjectIds] = useState<string[]>([])
  const [expires, setExpires] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('keys.new')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim()}
            onClick={async () => {
              setBusy(true)
              try {
                const r = await api<{ secret: string }>('/api/me/api-keys', {
                  method: 'POST',
                  body: { name: name.trim(), scope, projectIds: projectIds.length ? projectIds : null, expiresAt: expires ? new Date(`${expires}T23:59:59`).getTime() : null },
                })
                onCreated(r.secret)
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
        <Field label={t('keys.name')}>{(id) => <Input id={id} autoFocus value={name} maxLength={60} placeholder={t('keys.namePh')} onChange={(e) => setName(e.target.value)} />}</Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-fg-2">{t('keys.scope')}</span>
          {(['read', 'write', 'manage'] as const).map((s) => (
            <label key={s} className={cx('flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors', scope === s ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong')}>
              <input type="radio" name="scope" checked={scope === s} onChange={() => setScope(s)} className="mt-0.5 accent-accent" />
              <span>
                <span className="block text-sm font-medium">{t(`keys.scope.${s}`)}</span>
                <span className="block text-xs text-fg-4">{t(`keys.scope.${s}.hint` as MsgKey)}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-fg-2">{t('keys.projects')}</span>
          <div className="flex flex-wrap gap-1.5">
            {(projects.data ?? []).map((p) => {
              const on = projectIds.includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProjectIds((x) => (on ? x.filter((v) => v !== p.id) : [...x, p.id]))}
                  className={cx('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px]', on ? 'border-accent bg-accent-soft text-accent-text' : 'border-line text-fg-3')}
                >
                  {on && <Check className="size-3.5" />}
                  <span className="font-mono">{p.key}</span>
                </button>
              )
            })}
          </div>
          {!projectIds.length && <span className="text-xs text-fg-4">{t('keys.allProjects')}</span>}
        </div>
        <Field label={t('keys.expires')} hint={expires ? undefined : t('keys.never')}>
          {(id) => <Input id={id} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="w-auto" />}
        </Field>
      </div>
    </Dialog>
  )
}

function ShowKey({ secret, onClose }: { secret: string; onClose(): void }) {
  const { t } = useI18n()
  const origin = location.origin
  const cli = `claude mcp add --transport http lab-notes ${origin}/mcp --header "Authorization: Bearer ${secret}"`
  const url = `${origin}/mcp/k/${secret}`
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('keys.createdTitle')} description={t('keys.once')} size="lg" footer={<Button variant="primary" onClick={onClose}>{t('common.done')}</Button>}>
      <div className="flex flex-col gap-4">
        <CopyBlock label={t('keys.claudeCode')} value={cli} />
        <CopyBlock label={t('keys.urlForm')} value={url} warn={t('keys.urlWarn')} />
        <CopyBlock label="API Key" value={secret} />
      </div>
    </Dialog>
  )
}

function CopyBlock({ label, value, warn }: { label: string; value: string; warn?: string }) {
  const { t } = useI18n()
  const [done, setDone] = useState(false)
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-fg-2">{label}</span>
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2.5 font-mono text-xs break-all">{value}</code>
        <Button
          icon={done ? <Check className="size-4" /> : <Copy className="size-4" />}
          onClick={() =>
            navigator.clipboard.writeText(value).then(() => {
              setDone(true)
              toast(t('common.copied'))
              setTimeout(() => setDone(false), 1500)
            })
          }
        >
          {t('keys.copy')}
        </Button>
      </div>
      {warn && (
        <span className="flex items-center gap-1.5 text-xs text-warning">
          <ShieldAlert className="size-3.5" /> {warn}
        </span>
      )}
    </motion.div>
  )
}
