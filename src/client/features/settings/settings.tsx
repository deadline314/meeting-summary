import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, KeyRound, Laptop, Monitor, Moon, Palette, ShieldCheck, Smartphone, Sun, User } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import type { UserDto } from '@shared/types'
import { usePrefs } from '../../app/prefs-sync'
import { api, queryClient } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { isAdminRole, refreshMe, useMe } from '../../lib/session'
import { ACCENTS, MODES, type Accent } from '../../lib/theme'
import { Avatar } from '../../ui/avatar'
import { Button } from '../../ui/button'
import { cx } from '../../ui/cx'
import { confirm } from '../../ui/dialog'
import { Field, Input } from '../../ui/field'
import { Badge, Card, PageHeader } from '../../ui/misc'
import { Segmented, TabBar } from '../../ui/tabs'
import { toast, toastError } from '../../ui/toast'
import { ApiKeysPanel } from './api-keys'

export type SettingsTab = 'profile' | 'appearance' | 'devices' | 'api' | 'admin'

export function SettingsPage({ tab, onTab }: { tab: SettingsTab; onTab(t: SettingsTab): void }) {
  const { t } = useI18n()
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title={t('settings.title')} />
      <TabBar
        value={tab}
        onChange={onTab}
        tabs={[
          { value: 'profile', label: t('settings.profile'), icon: <User /> },
          { value: 'appearance', label: t('settings.appearance'), icon: <Palette /> },
          { value: 'devices', label: t('settings.devices'), icon: <Laptop /> },
          { value: 'api', label: t('settings.apiKeys'), icon: <KeyRound /> },
          { value: 'admin', label: t('settings.adminKey'), icon: <ShieldCheck /> },
        ]}
      />
      <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="mt-6">
        {tab === 'profile' && <Profile />}
        {tab === 'appearance' && <Appearance />}
        {tab === 'devices' && <Devices />}
        {tab === 'api' && <ApiKeysPanel />}
        {tab === 'admin' && <AdminKey />}
      </motion.div>
    </div>
  )
}

function Profile() {
  const me = useMe()
  const { t } = useI18n()
  const [name, setName] = useState(me.name)
  const [avatar, setAvatar] = useState(me.avatarUrl ?? '')
  const save = useMutation({
    mutationFn: () => api<{ user: UserDto }>('/api/me', { method: 'PATCH', body: { name: name.trim(), avatarUrl: avatar.trim() || null } }),
    onSuccess: (r) => {
      refreshMe(r.user)
      toast(t('settings.renamed'))
    },
    onError: toastError,
  })
  const dirty = name.trim() !== me.name || (avatar.trim() || null) !== me.avatarUrl
  return (
    <Card className="p-5">
      <div className="mb-5 flex items-center gap-4">
        <Avatar id={me.id} name={name || me.name} src={avatar || null} size="xl" />
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold">{name || me.name}</div>
          <div className="truncate text-sm text-fg-3">{me.email}</div>
          <Badge tone={isAdminRole(me.role) ? 'accent' : 'neutral'} className="mt-1.5">
            {t(`role.${me.role}`)}
          </Badge>
        </div>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) save.mutate()
        }}
      >
        <Field label={t('settings.name')} hint={t('settings.nameHint')}>
          {(id) => <Input id={id} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t('settings.avatar')}>{(id) => <Input id={id} type="url" value={avatar} placeholder="https://" onChange={(e) => setAvatar(e.target.value)} />}</Field>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty || !name.trim()}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  )
}

const MODE_ICON = { light: <Sun />, dark: <Moon />, system: <Monitor /> }

function Appearance() {
  const { t, locale } = useI18n()
  const { theme, save } = usePrefs()
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-5 p-5">
        <div>
          <div className="mb-2 text-[13px] font-medium text-fg-2">{t('settings.mode')}</div>
          <Segmented
            value={theme.mode}
            onChange={(mode) => save({ mode })}
            options={MODES.map((m) => ({ value: m, label: t(`settings.mode.${m}`), icon: MODE_ICON[m] }))}
          />
        </div>
        <div>
          <div className="mb-2 text-[13px] font-medium text-fg-2">{t('settings.accent')}</div>
          <div className="flex flex-wrap gap-3">
            {ACCENTS.map((a) => (
              <AccentSwatch key={a} accent={a} active={theme.accent === a} onClick={() => save({ accent: a })} label={t(`settings.accent.${a}`)} />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[13px] font-medium text-fg-2">{t('settings.language')}</div>
          <Segmented
            value={locale}
            onChange={(l) => save({ locale: l })}
            options={[
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'English' },
            ]}
          />
        </div>
      </Card>
      <Card className="p-5">
        <div className="mb-3 text-[13px] font-medium text-fg-2">{t('settings.preview')}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">{t('common.create')}</Button>
          <Button>{t('common.cancel')}</Button>
          <Button variant="soft">{t('common.edit')}</Button>
          <Badge tone="success">{t('common.done')}</Badge>
          <Badge tone="warning">{t('common.loading')}</Badge>
          <Badge tone="danger">{t('common.delete')}</Badge>
          <Badge tone="info">{t('common.new')}</Badge>
        </div>
      </Card>
    </div>
  )
}

function AccentSwatch({ accent, active, onClick, label }: { accent: Accent; active: boolean; onClick(): void; label: string }) {
  return (
    <button onClick={onClick} className="group flex flex-col items-center gap-1.5" aria-pressed={active}>
      <span
        data-accent={accent}
        className={cx(
          'flex size-11 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-sm transition-transform group-hover:scale-105 group-active:scale-95',
          active && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
        )}
      >
        {active && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
            <Check className="size-5" />
          </motion.span>
        )}
      </span>
      <span className={cx('text-xs', active ? 'font-semibold text-fg' : 'text-fg-3')}>{label}</span>
    </button>
  )
}

type SessionRow = { id: string; userAgent: string | null; createdAt: number; lastUsedAt: number; current: boolean }

function Devices() {
  const { t, fmt } = useI18n()
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ items: SessionRow[] }>('/api/me/sessions') })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sessions'] })
  const others = (q.data?.items ?? []).filter((s) => !s.current).length
  return (
    <Card className="divide-y divide-line">
      {q.data?.items.map((s) => {
        const mobile = /Mobile|Android|iPhone/.test(s.userAgent ?? '')
        return (
          <div key={s.id} className="flex items-center gap-3 p-4">
            <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-fg-3 [&_svg]:size-5">{mobile ? <Smartphone /> : <Laptop />}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="truncate">{browserName(s.userAgent)}</span>
                {s.current && <Badge tone="success">{t('settings.thisDevice')}</Badge>}
              </div>
              <div className="text-xs text-fg-4">{t('settings.lastActive', { time: fmt.relative(s.lastUsedAt) })}</div>
            </div>
            {!s.current && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => api(`/api/me/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' }).then(refresh, toastError)}
              >
                {t('settings.signOutDevice')}
              </Button>
            )}
          </div>
        )
      })}
      {others > 0 && (
        <div className="flex justify-end p-4">
          <Button
            variant="secondary"
            onClick={async () => {
              if (await confirm({ title: t('settings.signOutOthers'), body: t('settings.signOutOthersConfirm'), danger: true }))
                api('/api/me/sessions', { method: 'DELETE' }).then(refresh, toastError)
            }}
          >
            {t('settings.signOutOthers')}
          </Button>
        </div>
      )}
    </Card>
  )
}

function browserName(ua: string | null) {
  if (!ua) return '—'
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${b} · ${os}` : b
}

function AdminKey() {
  const me = useMe()
  const { t } = useI18n()
  const [key, setKey] = useState('')
  const redeem = useMutation({
    mutationFn: () => api<{ user: UserDto }>('/api/me/admin-key', { method: 'POST', body: { key } }),
    onSuccess: (r) => {
      refreshMe(r.user)
      toast(t('settings.adminKeySuccess'))
      setKey('')
    },
    onError: toastError,
  })
  if (isAdminRole(me.role))
    return (
      <Card className="flex items-center gap-3 p-5 text-sm">
        <ShieldCheck className="size-5 text-success" /> {t('settings.adminKeyDone')}
      </Card>
    )
  return (
    <Card className="p-5">
      <p className="mb-4 text-sm text-fg-3">{t('settings.adminKeyHint')}</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (key.trim()) redeem.mutate()
        }}
      >
        <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('settings.adminKeyInput')} aria-label={t('settings.adminKeyInput')} autoComplete="off" />
        <Button type="submit" variant="primary" loading={redeem.isPending} disabled={!key.trim()}>
          {t('settings.adminKeySubmit')}
        </Button>
      </form>
    </Card>
  )
}
