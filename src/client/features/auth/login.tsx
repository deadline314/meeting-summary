import { useQuery } from '@tanstack/react-query'
import { ArrowRight, FlaskConical } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { Logo } from '../../app/shell'
import { Avatar } from '../../ui/avatar'
import { Button } from '../../ui/button'
import { Field, Input } from '../../ui/field'
import { Card } from '../../ui/misc'
import { toastError } from '../../ui/toast'

type Search = { next?: string; cancelled?: number; error?: string }

export function LoginPage({ search }: { search: Search }) {
  const t = useT()
  const config = useQuery({ queryKey: ['config'], queryFn: () => api<{ devLogin: boolean; google: boolean; version: string }>('/api/config') })
  const hint = useQuery({
    queryKey: ['auth-hint'],
    queryFn: () => api<{ hint: { email: string; name: string | null; avatarUrl: string | null } | null }>('/api/auth/hint'),
  })
  const next = search.next ?? '/'
  const googleHref = (switchAccount: boolean) => `/auth/google?next=${encodeURIComponent(next)}${switchAccount ? '&switch=1' : ''}`
  const notice = search.cancelled
    ? t('auth.cancelled')
    : search.error === 'disabled'
      ? t('auth.disabled')
      : search.error === 'expired'
        ? t('auth.expired')
        : search.error
          ? t('auth.failed')
          : null
  const h = hint.data?.hint

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <Backdrop />
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-sm"
      >
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo className="size-12 rounded-2xl [&_svg]:size-7" />
          <h1 className="text-2xl font-bold tracking-tight">{t('app.name')}</h1>
          <p className="text-sm text-fg-3">{t('app.tagline')}</p>
        </div>
        <Card className="p-5">
          {notice && <div className="mb-4 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">{notice}</div>}
          {config.data && !config.data.google && <div className="mb-4 rounded-xl bg-info-soft px-3 py-2 text-xs text-info">{t('auth.notConfigured')}</div>}
          {config.data?.google && (
            <div className="flex flex-col gap-2">
              {h ? (
                <>
                  <a
                    href={googleHref(false)}
                    className="group flex items-center gap-3 rounded-xl border border-line p-3 transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:border-accent hover:shadow-card"
                  >
                    <Avatar id={h.email} name={h.name ?? h.email} src={h.avatarUrl} size="md" />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-medium">{t('auth.continueAs', { email: h.name ?? h.email })}</span>
                      <span className="block truncate text-xs text-fg-4">{h.email}</span>
                    </span>
                    <ArrowRight className="size-4 text-fg-4 transition-transform group-hover:translate-x-0.5" />
                  </a>
                  <Button asChild variant="ghost" size="md">
                    <a href={googleHref(true)}>{t('auth.otherAccount')}</a>
                  </Button>
                </>
              ) : (
                <Button asChild variant="primary" size="lg" icon={<GoogleIcon />}>
                  <a href={googleHref(false)}>{t('auth.google')}</a>
                </Button>
              )}
            </div>
          )}
          {config.data?.devLogin && <DevLogin next={next} defaultEmail={h?.email} />}
        </Card>
        {config.data && <p className="mt-6 text-center text-xs text-fg-4">v{config.data.version}</p>}
      </motion.div>
    </div>
  )
}

function DevLogin({ next, defaultEmail }: { next: string; defaultEmail?: string }) {
  const t = useT()
  const [email, setEmail] = useState(defaultEmail ?? 'student@example.com')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="mt-1 flex flex-col gap-3 first:mt-0 [&:not(:first-child)]:mt-5 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-line [&:not(:first-child)]:pt-5"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          const r = await api<{ onboarded: boolean }>('/auth/dev', { method: 'POST', body: { email, name: name || email.split('@')[0] } })
          location.href = r.onboarded ? next : `/welcome?next=${encodeURIComponent(next)}`
        } catch (err) {
          toastError(err)
          setBusy(false)
        }
      }}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <FlaskConical className="size-4 text-accent-text" /> {t('auth.devTitle')}
      </div>
      <p className="-mt-2 text-xs text-fg-4">{t('auth.devHint')}</p>
      <Field label={t('auth.devEmail')}>{(id) => <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <Field label={t('auth.devName')}>{(id) => <Input id={id} value={name} placeholder={email.split('@')[0]} onChange={(e) => setName(e.target.value)} />}</Field>
      <Button type="submit" variant="primary" loading={busy}>
        {t('auth.devSubmit')}
      </Button>
    </form>
  )
}

export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div
        className="absolute -top-32 -left-24 size-[28rem] rounded-full bg-accent-soft blur-3xl"
        animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -right-24 -bottom-40 size-[32rem] rounded-full bg-info-soft blur-3xl"
        animate={{ x: [0, -30, 0], y: [0, -40, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden fill="currentColor">
      <path d="M21.35 11.1H12v2.9h5.35c-.23 1.5-1.66 4.4-5.35 4.4-3.22 0-5.85-2.67-5.85-5.95S8.78 6.5 12 6.5c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.67 3.94 14.55 3 12 3 7.03 3 3 7.03 3 12s4.03 9 9 9c5.2 0 8.65-3.65 8.65-8.8 0-.6-.07-1.05-.15-1.5z" />
    </svg>
  )
}
