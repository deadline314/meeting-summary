export const ACCENTS = ['indigo', 'emerald', 'amber', 'rose', 'slate'] as const
export const MODES = ['light', 'dark', 'system'] as const
export type Accent = (typeof ACCENTS)[number]
export type Mode = (typeof MODES)[number]

const KEY = 'ms.theme'

export function readTheme(): { accent: Accent; mode: Mode } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { accent?: Accent; mode?: Mode }
    return { accent: ACCENTS.includes(v.accent!) ? v.accent! : 'indigo', mode: MODES.includes(v.mode!) ? v.mode! : 'system' }
  } catch {
    return { accent: 'indigo', mode: 'system' }
  }
}

const media = () => window.matchMedia('(prefers-color-scheme: dark)')

/** Applies theme to <html>. index.html runs the same logic inline before paint to avoid a flash. */
export function applyTheme(t: { accent: Accent; mode: Mode }) {
  const el = document.documentElement
  const dark = t.mode === 'dark' || (t.mode === 'system' && media().matches)
  el.dataset.accent = t.accent
  el.dataset.mode = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(el).getPropertyValue('--t-canvas').trim())
  try {
    localStorage.setItem(KEY, JSON.stringify(t))
  } catch {
    /* ignore */
  }
}

export function watchSystemTheme(get: () => { accent: Accent; mode: Mode }) {
  const m = media()
  const on = () => get().mode === 'system' && applyTheme(get())
  m.addEventListener('change', on)
  return () => m.removeEventListener('change', on)
}
