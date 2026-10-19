import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { Activity, Ban, Gauge, MoreHorizontal, Settings2, RotateCcw, Shield, ShieldOff, Trash2, UserCheck, Users } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import type { Page, Role, UserDto } from '@shared/types'
import { api, queryClient } from '../../lib/api'
import { useDebounced } from '../../lib/hooks'
import { useI18n } from '../../lib/i18n'
import { useMe } from '../../lib/session'
import { Avatar } from '../../ui/avatar'
import { Button, IconButton } from '../../ui/button'
import { confirm } from '../../ui/dialog'
import { Input, Select } from '../../ui/field'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/menu'
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '../../ui/misc'
import { TabBar } from '../../ui/tabs'
import { toast, toastError } from '../../ui/toast'
import { ActivityFeed } from './activity'
import { MemberPage } from './member'
import { SiteSettingsPanel } from './site-settings'
import { UsagePanel, UsageWarning, usageQuery } from './usage'

export type AdminTab = 'members' | 'activity' | 'usage' | 'site'
export type AdminSearch = { tab: AdminTab; member?: string; actor?: string; type?: string; from?: string; to?: string }

export function AdminPage({ search, setSearch }: { search: AdminSearch; setSearch(s: AdminSearch, replace?: boolean): void }) {
  const { t } = useI18n()
  const tab = search.tab
  const onTab = (tab: AdminTab) => setSearch({ tab })
  const usage = useQuery(usageQuery)
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title={t('admin.title')} />
      <TabBar
        value={tab}
        onChange={onTab}
        tabs={[
          { value: 'members', label: t('admin.members'), icon: <Users /> },
          { value: 'activity', label: t('admin.activity'), icon: <Activity /> },
          { value: 'usage', label: t('admin.usage'), icon: <Gauge /> },
          { value: 'site', label: t('admin.settings'), icon: <Settings2 /> },
        ]}
      />
      {tab !== 'usage' && !!usage.data?.warn.length && (
        <div className="mt-4">
          <UsageWarning warn={usage.data.warn} />
        </div>
      )}
      <motion.div key={tab + (search.member ?? '')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="mt-6">
        {tab === 'members' && (search.member ? <MemberPage id={search.member} onBack={() => setSearch({ tab: 'members' }, false)} /> : <Members onOpen={(id) => setSearch({ tab: 'members', member: id }, false)} />)}
        {tab === 'activity' && <ActivityFeed filters={search} onFilters={(f) => setSearch({ ...search, ...f })} />}
        {tab === 'usage' && <UsagePanel />}
        {tab === 'site' && <SiteSettingsPanel />}
      </motion.div>
    </div>
  )
}

const PAGE = 50

function Members({ onOpen }: { onOpen(id: string): void }) {
  const { t, fmt } = useI18n()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<Role | ''>('')
  const [offset, setOffset] = useState(0)
  const ds = useDebounced(search)
  const q = useQuery({
    queryKey: ['admin-members', ds, role, offset],
    queryFn: () =>
      api<Page<UserDto>>(`/api/admin/members?${new URLSearchParams({ search: ds, ...(role && { role }), offset: String(offset), limit: String(PAGE) })}`),
    placeholderData: keepPreviousData,
  })
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setOffset(0)
          }}
          placeholder={t('admin.searchMembers')}
          aria-label={t('admin.searchMembers')}
          className="max-w-xs flex-1"
        />
        <Select
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role | '')
            setOffset(0)
          }}
          aria-label={t('settings.role')}
          className="w-auto"
        >
          <option value="">{t('admin.allRoles')}</option>
          <option value="student">{t('role.student')}</option>
          <option value="admin">{t('role.admin')}</option>
          <option value="owner">{t('role.owner')}</option>
        </Select>
        {q.data && <span className="self-center text-sm text-fg-4">{t('admin.memberCount', { n: q.data.total })}</span>}
      </div>
      <Card className="overflow-hidden">
        {q.isPending ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : q.data?.items.length ? (
          <ul className="divide-y divide-line">
            {q.data.items.map((u, i) => (
              <motion.li
                key={u.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.2) }}
                className="flex items-center gap-3 px-4 py-3 max-md:py-3.5"
              >
                <button onClick={() => onOpen(u.id)} aria-label={`${t('member.open')}：${u.name}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left">
                <Avatar id={u.id} name={u.name} src={u.avatarUrl} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{u.name}</span>
                    <Badge tone={u.role === 'student' ? 'neutral' : 'accent'}>{t(`role.${u.role}`)}</Badge>
                    {u.status === 'disabled' && <Badge tone="danger">{t('status.disabled')}</Badge>}
                  </div>
                  <div className="truncate text-xs text-fg-4">{u.email}</div>
                </div>
                <div className="hidden text-right text-xs text-fg-4 sm:block">
                  <div>
                    {t('admin.joined')} {fmt.date(u.createdAt)}
                  </div>
                  <div>
                    {t('admin.lastSeen')} {u.lastSeenAt ? fmt.relative(u.lastSeenAt) : t('admin.never')}
                  </div>
                </div>
                </button>
                <MemberMenu u={u} />
              </motion.li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Users />} title={t('common.noResults')} />
        )}
      </Card>
      {q.data && q.data.total > PAGE && (
        <div className="flex justify-center gap-2">
          <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            {t('common.prev')}
          </Button>
          <Button size="sm" disabled={offset + PAGE >= q.data.total} onClick={() => setOffset(offset + PAGE)}>
            {t('common.next')}
          </Button>
        </div>
      )}
    </div>
  )
}

function MemberMenu({ u }: { u: UserDto }) {
  const me = useMe()
  const { t } = useI18n()
  const update = useMutation({
    mutationFn: (body: { role?: Role; status?: UserDto['status'] }) => api<{ user: UserDto }>(`/api/admin/members/${u.id}`, { method: 'PATCH', body }),
    onSuccess: (r, body) => {
      queryClient.invalidateQueries({ queryKey: ['admin-members'] })
      queryClient.invalidateQueries({ queryKey: ['users'] })
      if (r.user.id === me.id) queryClient.invalidateQueries({ queryKey: ['me'] })
      if (body.role) toast(t('admin.roleUpdated', { name: u.name, role: t(`role.${body.role}`) }))
    },
    onError: (e) => toastError(e),
  })
  const canTouchOwner = me.role === 'owner'
  if (u.role === 'owner' && !canTouchOwner) return <span className="size-10" />
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label={t('common.edit')} icon={<MoreHorizontal />} size="sm" />
      </MenuTrigger>
      <MenuContent>
        {u.role !== 'admin' && <MenuItem icon={<Shield />} onSelect={() => update.mutate({ role: 'admin' })}>{t('admin.makeAdmin')}</MenuItem>}
        {u.role !== 'student' && <MenuItem icon={<ShieldOff />} onSelect={() => update.mutate({ role: 'student' })}>{t('admin.makeStudent')}</MenuItem>}
        {canTouchOwner && u.role !== 'owner' && <MenuItem icon={<UserCheck />} onSelect={() => update.mutate({ role: 'owner' })}>{t('admin.makeOwner')}</MenuItem>}
        <MenuSeparator />
        {u.status === 'active' ? (
          <MenuItem
            icon={<Ban />}
            danger
            onSelect={async () => {
              if (await confirm({ title: t('admin.disable'), body: t('admin.disableConfirm', { name: u.name }), danger: true, confirmLabel: t('admin.disable') }))
                update.mutate({ status: 'disabled' })
            }}
          >
            {t('admin.disable')}
          </MenuItem>
        ) : (
          <MenuItem icon={<RotateCcw />} onSelect={() => update.mutate({ status: 'active' })}>
            {t('admin.enable')}
          </MenuItem>
        )}
        <MenuItem
          icon={<Trash2 />}
          danger
          onSelect={async () => {
            if (await confirm({ title: t('admin.remove'), body: t('admin.removeConfirm', { name: u.name }), danger: true, confirmLabel: t('admin.remove') }))
              update.mutate({ status: 'removed' })
          }}
        >
          {t('admin.remove')}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
