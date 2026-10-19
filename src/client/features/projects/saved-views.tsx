import { useQuery } from '@tanstack/react-query'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { Bookmark, BookmarkPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api, queryClient } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { Button, IconButton } from '../../ui/button'
import { cx } from '../../ui/cx'
import { Dialog, confirm } from '../../ui/dialog'
import { Field, Input } from '../../ui/field'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/menu'
import { toast, toastError } from '../../ui/toast'

type View = { id: string; name: string; url: string }
const KEY = ['saved-views']
export const useViews = () => useQuery({ queryKey: KEY, queryFn: async () => (await api<{ items: View[] }>('/api/saved-views')).items })
const refresh = () => queryClient.invalidateQueries({ queryKey: KEY })

function NameDialog({ title, initial, onSubmit, onClose }: { title: string; initial: string; onSubmit(name: string): Promise<void>; onClose(): void }) {
  const { t } = useI18n()
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await onSubmit(name.trim())
      onClose()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={submit}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={t('views.name')}>{(id) => <Input id={id} autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />}</Field>
    </Dialog>
  )
}

/** Toolbar button: names the current URL (filters, sort and view all live there). */
export function SaveViewButton() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton label={t('views.save')} icon={<BookmarkPlus />} variant="secondary" onClick={() => setOpen(true)} />
      {open && (
        <NameDialog
          title={t('views.save')}
          initial=""
          onClose={() => setOpen(false)}
          onSubmit={async (name) => {
            await api('/api/saved-views', { method: 'POST', body: { name, url: location.pathname + location.search } })
            refresh()
            toast(t('views.saved', { name }))
          }}
        />
      )}
    </>
  )
}

/** Sidebar section listing saved views; each can be renamed or deleted from its menu. */
export function SavedViewsNav() {
  const { t } = useI18n()
  const q = useViews()
  const here = useRouterState({ select: (s) => s.location.href })
  const router = useRouter()
  const [renaming, setRenaming] = useState<View | null>(null)
  if (!q.data?.length) return null
  return (
    <>
      <div className="mt-4 mb-1 px-2.5 text-[11px] font-semibold tracking-wide text-fg-4 uppercase">{t('views.title')}</div>
      {q.data.map((v) => (
        <div key={v.id} className="group flex items-center">
          <a
            href={v.url}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey) return
              e.preventDefault()
              router.history.push(v.url)
            }}
            className={cx('flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2.5 text-sm transition-colors [&_svg]:size-4', here === v.url ? 'bg-accent-soft font-medium text-accent-text' : 'text-fg-2 hover:bg-surface-2')}
          >
            <Bookmark className="shrink-0" />
            <span className="truncate">{v.name}</span>
          </a>
          <Menu>
            <MenuTrigger asChild>
              <IconButton label={t('common.more')} icon={<MoreHorizontal />} size="sm" className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100" />
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<Pencil />} onSelect={() => setRenaming(v)}>
                {t('views.rename')}
              </MenuItem>
              <MenuItem
                icon={<Trash2 />}
                danger
                onSelect={async () => {
                  if (await confirm({ title: `${t('common.delete')}「${v.name}」`, danger: true })) api(`/api/saved-views/${v.id}`, { method: 'DELETE' }).then(refresh, (e) => toastError(e))
                }}
              >
                {t('common.delete')}
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      ))}
      {renaming && (
        <NameDialog
          title={t('views.rename')}
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          onSubmit={async (name) => {
            await api(`/api/saved-views/${renaming.id}`, { method: 'PATCH', body: { name } })
            refresh()
          }}
        />
      )}
    </>
  )
}
