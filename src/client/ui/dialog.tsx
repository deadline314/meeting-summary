import { X } from 'lucide-react'
import { Dialog as D } from 'radix-ui'
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { useT } from '../lib/i18n'
import { useIsMobile } from '../lib/hooks'
import { Button, IconButton } from './button'
import { cx } from './cx'

type DialogProps = {
  open: boolean
  onOpenChange(open: boolean): void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'full'
  /** Return false to keep the dialog open (e.g. unsaved draft prompt). */
  onRequestClose?: () => boolean
}

/** Centered dialog on desktop, bottom sheet on phones. */
export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md', onRequestClose }: DialogProps) {
  const mobile = useIsMobile()
  const t = useT()
  const guard = (e: Event) => {
    if (onRequestClose && !onRequestClose()) e.preventDefault()
  }
  const width = { sm: 'md:max-w-sm', md: 'md:max-w-lg', lg: 'md:max-w-3xl', full: 'md:max-w-5xl' }[size]
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="anim-fade fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
        <D.Content
          data-layer
          onEscapeKeyDown={guard}
          // Keep focus where the content put it (autoFocus); otherwise focus the panel, not the close button.
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            const panel = e.currentTarget as HTMLElement
            if (!panel.contains(document.activeElement)) panel.focus()
          }}
          onPointerDownOutside={guard}
          aria-describedby={description ? undefined : undefined}
          className={cx(
            'fixed z-50 flex flex-col bg-surface shadow-card focus:outline-none',
            mobile
              ? cx('anim-sheet inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl pb-safe', size === 'full' && 'top-0 max-h-none rounded-none pt-safe')
              : cx('anim-pop top-[12vh] left-1/2 max-h-[76vh] w-[calc(100%-2rem)] -translate-x-1/2 rounded-2xl border border-line', width),
          )}
        >
          {mobile && size !== 'full' && <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line-strong" aria-hidden />}
          <div className="flex items-start gap-3 px-5 pt-4 pb-2">
            <div className="min-w-0 flex-1">
              <D.Title className="text-base font-semibold text-fg">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1 text-sm text-fg-3">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{title}</D.Description>
              )}
            </div>
            <D.Close asChild>
              <IconButton label={t('common.close')} shortcut="Esc" icon={<X />} size="sm" className="-mr-1.5" />
            </D.Close>
          </div>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">{children}</div>}
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

// ---------- confirm() ----------

type ConfirmReq = {
  title: string
  body?: ReactNode
  confirmLabel?: string
  danger?: boolean
  resolve(ok: boolean): void
}

let pending: ConfirmReq | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Themed replacement for window.confirm. Always describe the consequence in `body`. */
export function confirm(o: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    pending?.resolve(false)
    pending = { ...o, resolve }
    emit()
  })
}

export function ConfirmHost() {
  const req = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => pending,
  )
  const t = useT()
  const [busy, setBusy] = useState(false)
  const close = (ok: boolean) => {
    req?.resolve(ok)
    pending = null
    setBusy(false)
    emit()
  }
  return (
    <Dialog
      open={!!req}
      onOpenChange={(o) => !o && close(false)}
      title={req?.title ?? ''}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={req?.danger ? 'danger' : 'primary'}
            loading={busy}
            autoFocus
            onClick={() => {
              setBusy(true)
              close(true)
            }}
          >
            {req?.confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      {req?.body && <div className="text-sm leading-relaxed text-fg-2">{req.body}</div>}
    </Dialog>
  )
}
