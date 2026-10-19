import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  CheckSquare,
  FileText,
  FolderKanban,
  Home,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Shield,
  WifiOff,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SITE_ICONS } from '../features/admin/site-settings'
import { AnnotateHost } from '../features/files/annotate'
import { api } from '../lib/api'
import { useOnline } from '../lib/hooks'
import { useT, type MsgKey } from '../lib/i18n'
import { isAdminRole, logout, useMe } from '../lib/session'
import { Avatar } from '../ui/avatar'
import { IconButton } from '../ui/button'
import { cx } from '../ui/cx'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../ui/menu'
import { Kbd } from '../ui/misc'
import { Tooltip } from '../ui/tooltip'
import { CommandPalette, ShortcutHelp, openPalette } from './palette'
import { NotificationBell } from './notifications'
import { PrefsSync } from './prefs-sync'

type NavItem = { to: string; key: MsgKey; icon: ReactNode; admin?: boolean; exact?: boolean }

const NAV: NavItem[] = [
  { to: '/', key: 'nav.home', icon: <Home />, exact: true },
  { to: '/notes', key: 'nav.notes', icon: <FileText /> },
  { to: '/tasks', key: 'nav.tasks', icon: <CheckSquare /> },
  { to: '/projects', key: 'nav.projects', icon: <FolderKanban /> },
  { to: '/admin', key: 'nav.admin', icon: <Shield />, admin: true },
]

const COLLAPSE_KEY = 'ms.sidebar.collapsed'

function useActive() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  return (item: NavItem) => (item.exact ? path === item.to : path === item.to || path.startsWith(item.to + '/'))
}

export function AppShell() {
  const siteName = useSite().name
  const me = useMe()
  const t = useT()
  const isActive = useActive()
  const online = useOnline()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])
  const nav = NAV.filter((n) => !n.admin || isAdminRole(me.role))
  const section = useRouterState({ select: (s) => '/' + (s.location.pathname.split('/')[1] ?? '') })

  return (
    <div className="flex min-h-dvh bg-canvas">
      <PrefsSync />
      <CommandPalette />
      <AnnotateHost />
      <ShortcutHelp />
      {/* Desktop sidebar */}
      <motion.aside
        animate={{ width: collapsed ? 68 : 232 }}
        transition={{ type: 'spring', stiffness: 400, damping: 40 }}
        className="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface/70 backdrop-blur md:flex"
      >
        <div className="flex h-14 items-center gap-2.5 px-4">
          <Logo />
          {!collapsed && (
            <>
              <span className="flex-1 truncate text-[15px] font-bold tracking-tight">{siteName}</span>
              <NotificationBell />
            </>
          )}
        </div>
        <div className="px-3 pb-2">
          <Tooltip label={collapsed ? t('nav.commandHint') : undefined} shortcut="mod+k" side="right">
            <button
              onClick={openPalette}
              aria-label={t('nav.commandHint')}
              className="flex h-9 w-full items-center gap-2 rounded-xl border border-line bg-canvas px-2.5 text-[13px] text-fg-4 transition-colors hover:border-line-strong hover:text-fg-3"
            >
              <Search className="size-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 truncate text-left">{t('common.search')}</span>
                  <Kbd keys="mod+k" />
                </>
              )}
            </button>
          </Tooltip>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {nav.map((n) => {
            const active = isActive(n)
            return (
              <Tooltip key={n.to} label={collapsed ? t(n.key) : undefined} side="right">
                <Link
                  to={n.to}
                  className={cx(
                    'relative flex h-9 items-center gap-3 rounded-xl px-2.5 text-sm font-medium transition-colors [&_svg]:size-[18px] [&_svg]:shrink-0',
                    active ? 'text-fg' : 'text-fg-3 hover:bg-surface-2 hover:text-fg-2',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-xl bg-accent-soft"
                      transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                    />
                  )}
                  <span className={cx('relative', active && 'text-accent-text')}>{n.icon}</span>
                  {!collapsed && <span className="relative truncate">{t(n.key)}</span>}
                </Link>
              </Tooltip>
            )
          })}
        </nav>
        <div className="flex flex-col gap-1 border-t border-line p-3">
          {collapsed && <NotificationBell side="right" />}
          <AccountMenu collapsed={collapsed} />
          <IconButton
            label={collapsed ? t('nav.expand') : t('nav.collapse')}
            icon={collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            size="sm"
            side="right"
            onClick={() => setCollapsed((c) => !c)}
            className="self-start"
          />
        </div>
      </motion.aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="pt-safe sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/85 px-4 backdrop-blur md:hidden">
          <div className="flex h-14 flex-1 items-center gap-2.5">
            <Logo />
            <span className="text-[15px] font-bold tracking-tight">{siteName}</span>
          </div>
          <IconButton label={t('nav.commandHint')} icon={<Search />} onClick={openPalette} />
          <NotificationBell />
          <AccountMenu collapsed />
        </header>

        <AnimatePresence>
          {!online && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden bg-warning-soft text-warning"
            >
              <div className="flex items-center justify-center gap-2 py-1.5 text-xs font-medium">
                <WifiOff className="size-3.5" /> {t('common.offline')}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <main className="min-w-0 flex-1 pb-24 md:pb-0">
          {/* Pure-CSS enter fade, re-run per section. Unlike the previous exit animation
              (AnimatePresence mode="wait"), content is mounted immediately and visible by default,
              so a stalled animation can never leave the page blank. */}
          <div key={section} className="anim-page">
            <Outlet />
          </div>
        </main>

        {/* Mobile bottom nav */}
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/90 backdrop-blur md:hidden">
          {nav.map((n) => {
            const active = isActive(n)
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cx(
                  'relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-medium [&_svg]:size-[22px]',
                  active ? 'text-accent-text' : 'text-fg-4',
                )}
              >
                {active && (
                  <motion.span layoutId="bottom-active" className="absolute top-0 h-0.5 w-10 rounded-full bg-accent" />
                )}
                <motion.span animate={{ scale: active ? 1.08 : 1 }}>{n.icon}</motion.span>
                {t(n.key)}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}

/** Site name and icon chosen in admin settings (empty name = the default). */
export function useSite() {
  const t = useT()
  const q = useQuery({ queryKey: ['config'], queryFn: () => api<{ siteName?: string; siteIcon?: string }>('/api/config'), staleTime: 300_000 })
  return { name: q.data?.siteName || t('app.name'), icon: q.data?.siteIcon ?? 'doc' }
}

export function Logo({ className }: { className?: string }) {
  const { icon } = useSite()
  const Custom = icon !== 'doc' ? SITE_ICONS[icon] : undefined
  return (
    <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-accent text-accent-fg shadow-sm', className)}>
      {Custom ? <Custom className="size-[18px]" /> : <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M7 4h7l4 4v12H7z" />
        <path d="M14 4v4h4M10 13h5M10 16.5h3" />
      </svg>}
    </span>
  )
}

function AccountMenu({ collapsed }: { collapsed: boolean }) {
  const me = useMe()
  const t = useT()
  const navigate = useNavigate()
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          aria-label={t('nav.account')}
          className={cx('flex items-center gap-2.5 rounded-xl text-left transition-colors hover:bg-surface-2', collapsed ? 'p-1' : 'p-1.5')}
        >
          <Avatar id={me.id} name={me.name} src={me.avatarUrl} size="md" />
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">{me.name}</span>
              <span className="block truncate text-xs text-fg-4">{t(`role.${me.role}`)}</span>
            </span>
          )}
        </button>
      </MenuTrigger>
      <MenuContent align={collapsed ? 'end' : 'start'}>
        <MenuLabel>{me.email}</MenuLabel>
        <MenuItem icon={<Settings />} onSelect={() => navigate({ to: '/settings', search: { tab: 'profile' } })}>
          {t('nav.settings')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<LogOut />} onSelect={() => logout()}>
          {t('nav.logout')}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
