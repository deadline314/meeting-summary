import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Link2, MessageSquare, MoreHorizontal, Pencil, Reply, RotateCcw, Send, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { renderMarkdown } from '../../lib/markdown'
import { useMe } from '../../lib/session'
import { UserAvatar, UserName } from '../../ui/avatar'
import { Button, IconButton } from '../../ui/button'
import { ContextMenu, CtxItem, CtxSeparator, copyText, siteLink } from '../../ui/context-menu'
import { cx } from '../../ui/cx'
import { confirm } from '../../ui/dialog'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/menu'
import { EmptyState, Spinner } from '../../ui/misc'
import { Segmented } from '../../ui/tabs'
import { toastError } from '../../ui/toast'
import { annotateImage } from '../files/annotate'
import { compressImage, fileUrl, uploadFile } from '../../lib/upload'
import { Html } from './preview'
import { RefSuggestList, useRefSuggest } from './ref-suggest'

export type NoteComment = {
  id: string
  noteId: string
  parentId: string | null
  authorId: string
  body: string
  anchor: { start: string; end: string } | null
  quote: string | null
  resolvedAt: number | null
  resolvedBy: string | null
  createdAt: number
  editedAt: number | null
  deletedAt: number | null
}

export type Thread = NoteComment & { replies: NoteComment[]; from: number | null; to: number | null }
export type Draft = { from: number; to: number; quote: string; anchor: { start: string; end: string } }

type Filter = 'open' | 'resolved' | 'all'

export function CommentsPanel({
  noteId,
  threads,
  activeId,
  onActivate,
  draft,
  onDraftDone,
}: {
  noteId: string
  threads: Thread[]
  activeId: string | null
  onActivate(id: string | null): void
  draft: Draft | null
  onDraftDone(): void
}) {
  const { t } = useI18n()
  const [filter, setFilter] = useState<Filter>('open')
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['note-comments', noteId] })
  const shown = threads.filter((th) => th.id === activeId || (filter === 'all' ? true : filter === 'open' ? !th.resolvedAt : !!th.resolvedAt))
  const counts = { open: threads.filter((x) => !x.resolvedAt).length, resolved: threads.filter((x) => x.resolvedAt).length }
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!activeId) return
    listRef.current?.querySelector(`[data-thread="${activeId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId])

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-3 pb-2">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: `${t('comments.open')} ${counts.open || ''}` },
            { value: 'resolved', label: `${t('comments.resolved')} ${counts.resolved || ''}` },
            { value: 'all', label: t('common.all') },
          ]}
        />
      </div>
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-6">
        <AnimatePresence initial={false}>
          {draft && (
            <motion.div key="draft" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border border-accent bg-surface p-3 shadow-card">
              <Quote text={draft.quote} />
              <Composer
                autoFocus
                upload={{ parentType: 'note', parentId: noteId }}
                placeholder={t('comments.placeholder')}
                onCancel={onDraftDone}
                onSend={async (body) => {
                  await api(`/api/notes/${noteId}/comments`, { method: 'POST', body: { body, anchor: draft.anchor, quote: draft.quote } })
                  onDraftDone()
                  setFilter('open')
                  refresh()
                }}
              />
            </motion.div>
          )}
          {shown.map((th) => (
            <motion.div key={th.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}>
              <ThreadCard th={th} noteId={noteId} active={th.id === activeId} onActivate={() => onActivate(th.id)} refresh={refresh} />
            </motion.div>
          ))}
        </AnimatePresence>
        {!draft && shown.length === 0 && <EmptyState icon={<MessageSquare />} title={t('comments.empty')} hint={t('comments.emptyHint')} />}
      </div>
    </div>
  )
}

function Quote({ text, deleted }: { text: string | null; deleted?: boolean }) {
  const { t } = useI18n()
  return (
    <div className={cx('mb-2 border-l-2 pl-2.5 text-[13px]', deleted ? 'border-line-strong text-fg-4' : 'border-warning text-fg-3')}>
      {deleted && <span className="mr-1 font-medium">{t('comments.quoteDeleted')}：</span>}
      <span className="line-clamp-3">{text}</span>
    </div>
  )
}

function ThreadCard({ th, noteId, active, onActivate, refresh }: { th: Thread; noteId: string; active: boolean; onActivate(): void; refresh(): void }) {
  const { t } = useI18n()
  const [replying, setReplying] = useState(false)
  const resolve = useMutation({
    mutationFn: (resolved: boolean) => api(`/api/notes/${noteId}/comments/${th.id}`, { method: 'PATCH', body: { resolved } }),
    onSuccess: refresh,
    onError: (e) => toastError(e),
  })
  const deleted = th.from === null || th.to === null || th.to <= th.from
  return (
    <div
      data-thread={th.id}
      onClick={onActivate}
      className={cx(
        'cursor-pointer rounded-2xl border bg-surface p-3 transition-all',
        active ? 'border-warning shadow-card' : 'border-line hover:border-line-strong',
        !!th.resolvedAt && 'opacity-75',
      )}
    >
      <Quote text={th.quote} deleted={deleted} />
      <Message c={th} noteId={noteId} refresh={refresh} onReply={() => setReplying(true)} />
      {th.replies.map((r) => (
        <div key={r.id} className="mt-3 border-t border-line pt-3">
          <Message c={r} noteId={noteId} refresh={refresh} onReply={() => setReplying(true)} />
        </div>
      ))}
      <div className="mt-3 flex items-center gap-1">
        {!replying && (
          <Button size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), setReplying(true))}>
            {t('comments.reply')}
          </Button>
        )}
        <div className="flex-1" />
        {th.resolvedAt ? (
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} loading={resolve.isPending} onClick={(e) => (e.stopPropagation(), resolve.mutate(false))}>
            {t('comments.reopen')}
          </Button>
        ) : (
          <Button size="sm" variant="soft" icon={<Check className="size-3.5" />} loading={resolve.isPending} onClick={(e) => (e.stopPropagation(), resolve.mutate(true))}>
            {t('comments.resolve')}
          </Button>
        )}
      </div>
      {replying && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <Composer
            autoFocus
            upload={{ parentType: 'note', parentId: noteId }}
            placeholder={t('comments.replyPh')}
            onCancel={() => setReplying(false)}
            onSend={async (body) => {
              await api(`/api/notes/${noteId}/comments`, { method: 'POST', body: { body, parentId: th.id } })
              setReplying(false)
              refresh()
            }}
          />
        </div>
      )}
    </div>
  )
}

function Message({ c, noteId, refresh, onReply }: { c: NoteComment; noteId: string; refresh(): void; onReply(): void }) {
  const me = useMe()
  const { t, fmt } = useI18n()
  const [editing, setEditing] = useState(false)
  if (c.deletedAt) return <div className="text-[13px] text-fg-4 italic">{t('comments.deleted')}</div>
  const remove = async () => {
    if (await confirm({ title: t('common.delete'), body: t('comments.deleteConfirm'), danger: true })) api(`/api/notes/${noteId}/comments/${c.id}`, { method: 'DELETE' }).then(refresh, toastError)
  }
  return (
    <ContextMenu
      disabled={editing}
      menu={
        <>
          <CtxItem icon={<Reply />} onSelect={onReply}>
            {t('comments.reply')}
          </CtxItem>
          <CtxItem icon={<Copy />} onSelect={() => copyText(c.body, t('common.copied'))}>
            {t('ctx.copyText')}
          </CtxItem>
          <CtxItem icon={<Link2 />} onSelect={() => copyText(siteLink(`/notes/${noteId}?tab=comments`), t('common.copied'))}>
            {t('pm.copyLink')}
          </CtxItem>
          {c.authorId === me.id && (
            <>
              <CtxSeparator />
              <CtxItem icon={<Pencil />} onSelect={() => setEditing(true)}>
                {t('common.edit')}
              </CtxItem>
              <CtxItem icon={<Trash2 />} danger onSelect={remove}>
                {t('common.delete')}
              </CtxItem>
            </>
          )}
        </>
      }
    >
    <div className="flex gap-2.5">
      <UserAvatar id={c.authorId} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <UserName id={c.authorId} className="font-semibold text-fg" />
          <span className="text-fg-4" title={fmt.dateTime(c.createdAt)}>
            {fmt.relative(c.createdAt)}
          </span>
          {c.editedAt && <span className="text-fg-4">（{t('common.edited')}）</span>}
          <div className="flex-1" />
          {c.authorId === me.id && !editing && (
            <Menu>
              <MenuTrigger asChild>
                <IconButton label={t('common.edit')} icon={<MoreHorizontal />} size="sm" className="-my-1 size-6" onClick={(e) => e.stopPropagation()} />
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
                  {t('common.edit')}
                </MenuItem>
                <MenuItem icon={<Trash2 />} danger onSelect={remove}>
                  {t('common.delete')}
                </MenuItem>
              </MenuContent>
            </Menu>
          )}
        </div>
        {editing ? (
          <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
            <Composer
              autoFocus
              initial={c.body}
              onCancel={() => setEditing(false)}
              onSend={async (body) => {
                await api(`/api/notes/${noteId}/comments/${c.id}`, { method: 'PATCH', body: { body } })
                setEditing(false)
                refresh()
              }}
            />
          </div>
        ) : (
          <Html html={renderMarkdown(c.body)} className="prose-md mt-0.5 text-[13.5px] leading-relaxed" />
        )}
      </div>
    </div>
    </ContextMenu>
  )
}

/** Auto-growing textarea (to 40% of the viewport); ⌘/Ctrl+Enter sends. */
export function Composer({
  onSend,
  onCancel,
  placeholder,
  initial = '',
  autoFocus,
  userIds,
  upload,
}: {
  onSend(body: string): Promise<unknown>
  onCancel?(): void
  placeholder?: string
  initial?: string
  autoFocus?: boolean
  /** Limit @-suggestions to these people (e.g. the issue's project members). */
  userIds?: string[]
  /** Where pasted images are stored; without it pasting images is plain text. */
  upload?: { parentType: 'note' | 'issue'; parentId: string }
}) {
  const { t } = useI18n()
  const [v, setV] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const s = useRefSuggest(userIds)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`
  }, [v])
  const send = async () => {
    if (!v.trim() || busy || uploading) return
    setBusy(true)
    try {
      await onSend(v.trim())
      setV('')
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }
  // The caret to restore right after React writes a programmatic change, before the next keystroke.
  const caret = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (caret.current === null || !ref.current) return
    ref.current.focus()
    ref.current.setSelectionRange(caret.current, caret.current)
    caret.current = null
  })
  const insertAtCaret = (text: string) => {
    const el = ref.current
    const at = el?.selectionStart ?? v.length
    caret.current = at + text.length
    setV((cur) => cur.slice(0, at) + text + cur.slice(el?.selectionEnd ?? at))
  }
  const pick = (insert: string) => {
    const r = s.pick(v, ref.current!.selectionStart, insert)
    caret.current = r.caret
    setV(r.value)
  }
  const pasteImages = async (files: File[]) => {
    for (const raw of files) {
      setUploading((n) => n + 1)
      try {
        const f = await uploadFile(await compressImage(await annotateImage(raw)), upload!)
        insertAtCaret(`![${f.name}](${fileUrl(f.id)})\n`)
      } catch (err) {
        toastError(err)
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <RefSuggestList s={s} onPick={pick} />
        <textarea
          ref={ref}
          autoFocus={autoFocus}
          value={v}
          rows={2}
          placeholder={placeholder}
          onChange={(e) => {
            setV(e.target.value)
            s.update(e.target.value, e.target.selectionStart)
          }}
          onClick={(e) => s.update(v, e.currentTarget.selectionStart)}
          onBlur={() => s.close()}
          onPaste={(e) => {
            const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
            if (!upload || !imgs.length) return
            e.preventDefault()
            pasteImages(imgs)
          }}
          onKeyDown={(e) => {
            if (s.open) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                s.setActive((s.active + (e.key === 'ArrowDown' ? 1 : s.options.length - 1)) % s.options.length)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                pick(s.options[s.active]!.insert)
                return
              }
              if (e.key === 'Escape') {
                e.stopPropagation()
                s.close()
                return
              }
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            } else if (e.key === 'Escape' && onCancel) {
              e.stopPropagation()
              onCancel()
            }
          }}
          className="w-full resize-none overflow-y-auto rounded-xl border border-line bg-canvas px-3 py-2 text-sm leading-relaxed focus:border-accent focus:outline-none max-md:text-base"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        {uploading > 0 && <Spinner className="mr-auto size-4" />}
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        <Button size="sm" variant="primary" icon={<Send className="size-3.5" />} loading={busy} disabled={!v.trim() || uploading > 0} onClick={send} title="Ctrl/⌘ + Enter">
          {t('comments.send')}
        </Button>
      </div>
    </div>
  )
}
