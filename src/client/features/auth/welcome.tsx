import { motion } from 'motion/react'
import { useState } from 'react'
import type { UserDto } from '@shared/types'
import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { refreshMe, useMe } from '../../lib/session'
import { Avatar } from '../../ui/avatar'
import { Button } from '../../ui/button'
import { Field, Input } from '../../ui/field'
import { Card } from '../../ui/misc'
import { toastError } from '../../ui/toast'
import { Backdrop } from './login'

export function WelcomePage({ next }: { next: string }) {
  const me = useMe()
  const t = useT()
  const [name, setName] = useState(me.name)
  const [busy, setBusy] = useState(false)
  const finish = async (useName: string | null) => {
    setBusy(true)
    try {
      const r = await api<{ user: UserDto }>('/api/me', { method: 'PATCH', body: { ...(useName ? { name: useName } : {}), onboarded: true } })
      refreshMe(r.user)
      location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/'
    } catch (err) {
      toastError(err)
      setBusy(false)
    }
  }
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      <Backdrop />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-sm">
        <Card className="p-6">
          <div className="mb-5 flex flex-col items-center gap-3 text-center">
            <motion.div initial={{ scale: 0.6, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}>
              <Avatar id={me.id} name={name || me.googleName} src={me.avatarUrl} size="xl" />
            </motion.div>
            <h1 className="text-xl font-bold">{t('welcome.title')}</h1>
            <p className="text-sm text-fg-3">{t('welcome.subtitle')}</p>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              finish(name.trim() || null)
            }}
          >
            <Field label={t('welcome.name')} hint={t('welcome.googleName', { name: me.googleName })}>
              {(id) => <Input id={id} autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Button type="submit" variant="primary" size="lg" loading={busy}>
              {t('welcome.submit')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => finish(null)} disabled={busy}>
              {t('common.skip')}
            </Button>
          </form>
        </Card>
      </motion.div>
    </div>
  )
}
