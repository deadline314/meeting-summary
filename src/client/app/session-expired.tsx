import { useEffect, useSyncExternalStore } from 'react'
import { onSessionExpired, queryClient } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { Button } from '../ui/button'
import { Dialog } from '../ui/dialog'

let open = false
const listeners = new Set<() => void>()
const set = (v: boolean) => {
  open = v
  listeners.forEach((l) => l())
}
onSessionExpired(() => set(true))

/**
 * When the session runs out mid-work, sign in again in a small window so this page — and
 * whatever is being typed in it — stays exactly as it is. Requests resume afterwards.
 */
export function SessionExpiredHost() {
  const { t } = useI18n()
  const isOpen = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => open,
  )
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin || (e.data as { type?: string } | null)?.type !== 'signed-in') return
      set(false)
      queryClient.invalidateQueries()
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])
  const signIn = () => {
    const w = window.open('/login?next=/signed-in', 'lab-notes-login', 'width=480,height=680')
    // Popups blocked: fall back to this tab (drafts that are saved locally survive).
    if (!w) location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`
  }
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(v) => !v && set(false)}
      title={t('session.expired')}
      description={t('session.expiredHint')}
      footer={
        <Button variant="primary" onClick={signIn}>
          {t('session.signIn')}
        </Button>
      }
    />
  )
}

/** Landing page inside the sign-in window: tell the opener and close. */
export function SignedInPage() {
  useEffect(() => {
    if (window.opener) {
      window.opener.postMessage({ type: 'signed-in' }, location.origin)
      window.close()
    } else location.replace('/')
  }, [])
  return null
}
