import { useNavigate } from '@tanstack/react-router'
import { CheckSquare, FileText, FolderKanban, Home, Keyboard, Languages, LogOut, Moon, Plus, Settings, Shield } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'
import type { UserDto } from '@shared/types'
import { useActions, type Action } from '../lib/actions'
import { api } from '../lib/api'
import { useI18n, type Locale } from '../lib/i18n'
import { isAdminRole, logout, refreshMe, useMe } from '../lib/session'
import { applyTheme, readTheme, watchSystemTheme, type Accent, type Mode } from '../lib/theme'
import { toastError } from '../ui/toast'
import { openPalette, openShortcutHelp } from './palette'

let theme = readTheme()
const listeners = new Set<() => void>()

export function useTheme() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => theme,
  )
}

function setThemeLocal(next: { accent: Accent; mode: Mode }) {
  theme = next
  applyTheme(next)
  listeners.forEach((l) => l())
}

/** Updates theme/locale locally right away, then saves to the account so other devices follow. */
export function usePrefs() {
  const { setLocale, locale } = useI18n()
  const save = (prefs: Partial<{ accent: Accent; mode: Mode; locale: Locale }>) => {
    if (prefs.accent || prefs.mode) setThemeLocal({ ...theme, ...(prefs.accent && { accent: prefs.accent }), ...(prefs.mode && { mode: prefs.mode }) })
    if (prefs.locale) setLocale(prefs.locale)
    api<{ user: UserDto }>('/api/me', { method: 'PATCH', body: { prefs } }).then((r) => refreshMe(r.user), toastError)
  }
  return { theme: useTheme(), locale, save }
}

export function PrefsSync() {
  const me = useMe()
  const { setLocale, locale } = useI18n()
  const navigate = useNavigate()
  const { save } = usePrefs()

  // Server prefs win on login / other-device changes.
  useEffect(() => {
    const p = me.prefs
    const next = { accent: (p.accent as Accent) ?? theme.accent, mode: (p.mode as Mode) ?? theme.mode }
    if (next.accent !== theme.accent || next.mode !== theme.mode) setThemeLocal(next)
    if (p.locale && p.locale !== locale) setLocale(p.locale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.prefs.accent, me.prefs.mode, me.prefs.locale])

  useEffect(() => watchSystemTheme(() => theme), [])

  const go = (to: string) => () => navigate({ to })
  const actions: Action[] = [
    { id: 'palette', label: 'action.palette', keys: 'mod+k', scope: 'global', hidden: true, run: openPalette },
    { id: 'shortcuts', label: 'action.shortcuts', keys: 'shift+/', icon: <Keyboard />, run: openShortcutHelp },
    { id: 'go-home', label: 'action.goHome', keys: 'g h', icon: <Home />, group: 'group.navigation', run: go('/') },
    { id: 'go-notes', label: 'action.goNotes', keys: 'g n', icon: <FileText />, group: 'group.navigation', run: go('/notes') },
    { id: 'go-tasks', label: 'action.goTasks', keys: 'g k', icon: <CheckSquare />, group: 'group.navigation', run: go('/tasks') },
    { id: 'go-projects', label: 'action.goProjects', keys: 'g p', icon: <FolderKanban />, group: 'group.navigation', run: go('/projects') },
    { id: 'go-settings', label: 'action.goSettings', keys: 'g s', icon: <Settings />, group: 'group.navigation', run: go('/settings') },
    ...(isAdminRole(me.role)
      ? [{ id: 'go-admin', label: 'action.goAdmin', keys: 'g a', icon: <Shield />, group: 'group.navigation', run: go('/admin') } satisfies Action]
      : []),
    { id: 'new-note', label: 'action.newNote', icon: <Plus />, group: 'group.create', run: () => navigate({ to: '/notes', search: { create: true } }) },
    {
      id: 'toggle-mode',
      label: 'action.toggleMode',
      icon: <Moon />,
      run: () => save({ mode: document.documentElement.dataset.mode === 'dark' ? 'light' : 'dark' }),
    },
    { id: 'switch-language', label: 'action.switchLanguage', icon: <Languages />, run: () => save({ locale: locale === 'zh' ? 'en' : 'zh' }) },
    { id: 'logout', label: 'action.logout', icon: <LogOut />, run: () => logout() },
  ]
  useActions(actions)
  return null
}
