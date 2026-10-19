import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { en } from './en'
import { zh } from './zh'

export type Locale = 'zh' | 'en'
export type MsgKey = keyof typeof zh
type Params = Record<string, string | number>

const dicts: Record<Locale, Record<MsgKey, string>> = { zh, en }
const STORAGE_KEY = 'ms.locale'

export function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    /* storage unavailable */
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function translate(locale: Locale, key: MsgKey, params?: Params) {
  const raw = dicts[locale][key] ?? key
  return params ? raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : raw
}

const intlLocale = (l: Locale) => (l === 'zh' ? 'zh-TW' : 'en-US')

function makeFormatters(locale: Locale) {
  const il = intlLocale(locale)
  const date = new Intl.DateTimeFormat(il, { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
  const dateTime = new Intl.DateTimeFormat(il, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: locale === 'en',
  })
  const time = new Intl.DateTimeFormat(il, { hour: '2-digit', minute: '2-digit', hour12: locale === 'en' })
  const rel = new Intl.RelativeTimeFormat(il, { numeric: 'auto', style: 'short' })
  const num = new Intl.NumberFormat(il)
  return {
    date: (ms: number) => date.format(ms),
    dateTime: (ms: number) => dateTime.format(ms),
    time: (ms: number) => time.format(ms),
    number: (n: number) => num.format(n),
    relative(ms: number) {
      const diff = (ms - Date.now()) / 1000
      const abs = Math.abs(diff)
      if (abs < 45) return rel.format(0, 'second')
      if (abs < 3600) return rel.format(Math.round(diff / 60), 'minute')
      if (abs < 86400) return rel.format(Math.round(diff / 3600), 'hour')
      if (abs < 86400 * 30) return rel.format(Math.round(diff / 86400), 'day')
      return date.format(ms)
    },
    bytes(n: number) {
      const u = ['B', 'KB', 'MB', 'GB']
      let i = 0
      while (n >= 1024 && i < u.length - 1) {
        n /= 1024
        i++
      }
      return `${num.format(Math.round(n * 10) / 10)} ${u[i]}`
    },
  }
}

type I18n = {
  locale: Locale
  setLocale(l: Locale): void
  t(key: MsgKey, params?: Params): string
  fmt: ReturnType<typeof makeFormatters>
}

const Ctx = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    document.documentElement.lang = l === 'zh' ? 'zh-Hant' : 'en'
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* ignore */
    }
  }, [])
  const value = useMemo<I18n>(
    () => ({ locale, setLocale, t: (k, p) => translate(locale, k, p), fmt: makeFormatters(locale) }),
    [locale, setLocale],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useI18n outside I18nProvider')
  return v
}

export const useT = () => useI18n().t
