import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  Bold,
  ChevronLeft,
  ChevronRight,
  Code2,
  Columns2,
  Copy,
  Eye,
  Heading2,
  History,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Lock,
  MapPin,
  MessageSquarePlus,
  MessagesSquare,
  MoreHorizontal,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Table,
  Trash2,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as Y from 'yjs'
import { useActions } from '../../lib/actions'
import { api } from '../../lib/api'
import { useIsMobile } from '../../lib/hooks'
import { useI18n } from '../../lib/i18n'
import { useDirectory, useMe } from '../../lib/session'
import { compressImage, uploadFile } from '../../lib/upload'
import { AvatarStack, UserAvatar, UserName } from '../../ui/avatar'
import { Button, IconButton } from '../../ui/button'
import { cx } from '../../ui/cx'
import { Dialog, confirm } from '../../ui/dialog'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/menu'
import { EmptyState, Skeleton } from '../../ui/misc'
import { Segmented } from '../../ui/tabs'
import { toast, toastError } from '../../ui/toast'
import { Tooltip } from '../../ui/tooltip'
import { FilesPanel } from '../files/files-panel'
import { authorRuns, b64ToAbs, relPosToB64, useAuthorsMap, useCollab, usePeers, useStatus, useText } from './collab'
import { CommentsPanel, type Draft, type NoteComment, type Thread } from './comments'
import { Editor, type EditorHandle, type FormatKind } from './editor'
import { HistoryPanel, VersionDialog } from './history'
import { NoteFormDialog, type NoteFields } from './note-form'
import { Preview, type CommentRange } from './preview'
import { RefPill } from './ref-pill'

export type NoteSearch = {
  mode?: 'edit' | 'split' | 'preview'
  authors?: boolean
  author?: string
  tab?: 'comments' | 'history' | 'files' | 'links'
  version?: string
  edit?: boolean
}

export type NoteDto = NoteFields & {
  id: string
  projectId: string | null
  visibility: 'site' | 'project'
  createdBy: string
  createdAt: number
  updatedAt: number
  version: number
  canEdit: boolean
  openComments: number
}

const PANEL_KEY = 'ms.note.panel'

export function NotePage({ id, search, setSearch }: { id: string; search: NoteSearch; setSearch(s: Partial<NoteSearch>, replace?: boolean): void }) {
  const q = useQuery({ queryKey: ['note', id], queryFn: () => api<{ note: NoteDto }>(`/api/notes/${id}`) })
  if (q.isPending)
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-96" />
      </div>
    )
  if (q.isError) throw q.error
  return <NoteView note={q.data.note} search={search} setSearch={setSearch} />
}

function NoteView({ note, search, setSearch }: { note: NoteDto; search: NoteSearch; setSearch(s: Partial<NoteSearch>, replace?: boolean): void }) {
  const { t } = useI18n()
  const mobile = useIsMobile()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const dir = useDirectory()
  const collab = useCollab(note.id)
  const { status, synced } = useStatus(collab.provider)
  const peers = usePeers(collab.provider)
  const source = useText(collab.text)
  const editor = useRef<EditorHandle>(null)
  const canEdit = note.canEdit
  // Phones open in reading mode; editing is one tap away.
  const mode = mobile ? (search.mode === 'edit' && canEdit ? 'edit' : 'preview') : (search.mode ?? (canEdit ? 'split' : 'preview'))
  const showEditor = canEdit && mode !== 'preview'
  const showPreview = mode !== 'edit'
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) !== '0'
    } catch {
      return true
    }
  })
  const tab = search.tab ?? 'comments'
  const openPanel = (tb: NonNullable<NoteSearch['tab']>) => {
    setSearch({ tab: tb }, true)
    if (!mobile) setPanel(true)
    else setSheet(true)
  }
  const setPanel = (v: boolean) => {
    setPanelOpen(v)
    try {
      localStorage.setItem(PANEL_KEY, v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }
  const [sheet, setSheet] = useState(false)

  // ----- authorship -----
  const authorsOn = !!search.authors
  const authors = useAuthorsMap(note.id, authorsOn)
  const runs = useMemo(() => (authorsOn ? authorRuns(collab.text) : null), [authorsOn, source, collab.text]) // eslint-disable-line react-hooks/exhaustive-deps
  const authorIds = useMemo(() => {
    const ids = new Set<string>()
    for (const v of Object.values(authors.data ?? {})) ids.add(v.userId)
    return [...ids]
  }, [authors.data])

  // ----- comments -----
  const commentsQ = useQuery({
    queryKey: ['note-comments', note.id],
    queryFn: async () => (await api<{ items: NoteComment[] }>(`/api/notes/${note.id}/comments`)).items,
    refetchInterval: 20_000,
  })
  const [activeId, setActiveId] = useState<string | null>(null)
  const threads: Thread[] = useMemo(() => {
    const all = commentsQ.data ?? []
    const roots = all.filter((c) => !c.parentId)
    return roots
      .map((r) => {
        const from = r.anchor ? b64ToAbs(collab.doc, r.anchor.start) : null
        const to = r.anchor ? b64ToAbs(collab.doc, r.anchor.end) : null
        return { ...r, from, to, replies: all.filter((c) => c.parentId === r.id) }
      })
      .sort((a, b) => (a.from ?? Infinity) - (b.from ?? Infinity) || a.createdAt - b.createdAt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsQ.data, source])
  const ranges: CommentRange[] = threads
    .filter((th) => !th.resolvedAt && th.from !== null && th.to !== null && th.to > th.from)
    .map((th) => ({ id: th.id, from: th.from!, to: th.to!, active: th.id === activeId }))
  const openCount = threads.filter((th) => !th.resolvedAt).length

  // ----- selection → comment bubble -----
  const [sel, setSel] = useState<{ from: number; to: number; quote: string; x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const onEditorSelection = (s: { from: number; to: number } | null) => {
    if (!s) return setSel(null)
    const v = editor.current?.view()
    const c = v?.coordsAtPos(s.to)
    setSel({ ...s, quote: v?.state.sliceDoc(s.from, s.to) ?? '', x: c?.left ?? 0, y: c?.bottom ?? 0 })
  }
  const onPreviewSelection = (s: { from: number; to: number; quote: string } | null) => {
    if (!s) return setSel(null)
    const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect()
    setSel({ ...s, x: rect ? rect.right : 0, y: rect ? rect.bottom : 0 })
  }
  const startComment = () => {
    if (!sel) return
    const start = relPosToB64(Y.createRelativePositionFromTypeIndex(collab.text, sel.from, 0))
    const end = relPosToB64(Y.createRelativePositionFromTypeIndex(collab.text, sel.to, -1))
    setDraft({ from: sel.from, to: sel.to, quote: sel.quote.slice(0, 500), anchor: { start, end } })
    setSel(null)
    window.getSelection()?.removeAllRanges()
    openPanel('comments')
  }

  // ----- uploads into the text -----
  const onFiles = async (files: File[], at: number) => {
    let pos = at
    for (const raw of files) {
      const key = crypto.randomUUID().slice(0, 8)
      const token = `![${t('files.imageUploading')}](uploading:${key})`
      const insertAt = Math.min(pos, collab.text.length)
      editor.current?.view()?.dispatch({ changes: { from: insertAt, insert: token + '\n' } })
      pos = insertAt + token.length + 1
      const replace = (withText: string) => {
        const i = collab.text.toString().indexOf(token)
        if (i < 0) return
        collab.doc.transact(() => {
          collab.text.delete(i, token.length + (withText ? 0 : 1))
          if (withText) collab.text.insert(i, withText)
        })
      }
      try {
        const file = await compressImage(raw)
        const f = await uploadFile(file, { parentType: 'note', parentId: note.id })
        const safe = f.name.replace(/[[\]]/g, '')
        replace(f.kind === 'image' ? `![${safe}](/files/${f.id})` : `[📎 ${safe}](/files/${f.id})`)
        qc.invalidateQueries({ queryKey: ['files', 'note', note.id] })
      } catch (err) {
        replace('')
        toastError(err, { label: t('common.retry'), run: () => onFiles([raw], Math.min(insertAt, collab.text.length)) })
      }
    }
  }
  const imageInput = useRef<HTMLInputElement>(null)

  // ----- lightbox -----
  const [lightbox, setLightbox] = useState<{ src: string; all: string[] } | null>(null)

  useActions([
    { id: 'note-comment', label: 'comments.add', keys: 'mod+alt+m', icon: <MessageSquarePlus />, run: startComment },
    { id: 'note-authors', label: 'notes.authors', icon: <Users />, run: () => setSearch({ authors: !authorsOn || undefined }, true) },
    { id: 'note-history', label: 'notes.panel.history', icon: <History />, run: () => openPanel('history') },
  ])

  const meta = (
    <NoteHeader
      note={note}
      peers={peers.map((p) => p.id)}
      status={status}
      synced={synced}
      onEdit={() => setSearch({ edit: true }, true)}
      onDelete={async () => {
        if (!(await confirm({ title: t('common.delete'), body: t('notes.deleteConfirm'), danger: true }))) return
        try {
          await api(`/api/notes/${note.id}`, { method: 'DELETE' })
          toast(t('notes.deleted'))
          navigate({ to: '/notes' })
        } catch (err) {
          toastError(err)
        }
      }}
    />
  )

  const toolbar = (
    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-line px-3 py-2 [scrollbar-width:none] md:px-5">
      {canEdit && (
        <Segmented
          value={mode}
          onChange={(m) => setSearch({ mode: m }, true)}
          options={
            mobile
              ? [
                  { value: 'edit', label: t('notes.mode.edit'), icon: <Pencil /> },
                  { value: 'preview', label: t('notes.mode.preview'), icon: <Eye /> },
                ]
              : [
                  { value: 'edit', label: t('notes.mode.edit'), icon: <Pencil /> },
                  { value: 'split', label: t('notes.mode.split'), icon: <Columns2 /> },
                  { value: 'preview', label: t('notes.mode.preview'), icon: <Eye /> },
                ]
          }
        />
      )}
      <Tooltip label={t('notes.authorsHint')}>
        <Button
          size="sm"
          variant={authorsOn ? 'soft' : 'ghost'}
          icon={<Users className="size-4" />}
          onClick={() => setSearch({ authors: !authorsOn || undefined, author: undefined, mode: !authorsOn && mode === 'edit' ? (mobile ? 'preview' : 'split') : search.mode }, true)}
        >
          {t('notes.authors')}
        </Button>
      </Tooltip>
      {authorsOn && authorIds.length > 0 && (
        <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-1">
          <button
            onClick={() => setSearch({ author: undefined }, true)}
            className={cx('h-8 rounded-lg px-2 text-xs', !search.author ? 'bg-surface-3 font-semibold text-fg' : 'text-fg-3 hover:bg-surface-2')}
          >
            {t('notes.allAuthors')}
          </button>
          {authorIds.map((uid) => (
            <Tooltip key={uid} label={`${t('notes.onlyAuthor')} ${dir.get(uid)?.name ?? ''}`}>
              <button onClick={() => setSearch({ author: search.author === uid ? undefined : uid }, true)} className={cx('rounded-full transition-transform', search.author === uid ? 'scale-110 ring-2 ring-accent' : 'opacity-80 hover:opacity-100')}>
                <UserAvatar id={uid} size="sm" />
              </button>
            </Tooltip>
          ))}
        </motion.div>
      )}
      {showEditor && (
        <>
          <span className="mx-1 h-5 w-px shrink-0 bg-line" />
          <FormatButtons onApply={(k) => editor.current?.apply(k)} onImage={() => imageInput.current?.click()} />
          <input
            ref={imageInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const v = editor.current?.view()
              onFiles([...(e.target.files ?? [])], v?.state.selection.main.head ?? collab.text.length)
              e.target.value = ''
            }}
          />
        </>
      )}
      <div className="flex-1" />
      {!mobile && (
        <div className="flex items-center gap-0.5">
          <PanelTab icon={<MessagesSquare />} label={t('notes.panel.comments')} badge={openCount} onClick={() => openPanel('comments')} active={panelOpen && tab === 'comments'} />
          <PanelTab icon={<History />} label={t('notes.panel.history')} onClick={() => openPanel('history')} active={panelOpen && tab === 'history'} />
          <PanelTab icon={<Paperclip />} label={t('notes.panel.files')} onClick={() => openPanel('files')} active={panelOpen && tab === 'files'} />
          <PanelTab icon={<Link2 />} label={t('notes.panel.links')} onClick={() => openPanel('links')} active={panelOpen && tab === 'links'} />
          <IconButton label={panelOpen ? t('notes.panel.hide') : t('notes.panel.show')} icon={panelOpen ? <PanelRightClose /> : <PanelRightOpen />} size="sm" onClick={() => setPanel(!panelOpen)} />
        </div>
      )}
    </div>
  )

  const panel = (
    <div className="flex h-full min-h-0 flex-col">
      {tab === 'comments' && <CommentsPanel noteId={note.id} threads={threads} activeId={activeId} onActivate={setActiveId} draft={draft} onDraftDone={() => setDraft(null)} />}
      {tab === 'history' && <HistoryPanel noteId={note.id} onOpen={(v) => setSearch({ version: v })} />}
      {tab === 'files' && <FilesPanel parentType="note" parentId={note.id} />}
      {tab === 'links' && <LinksPanel source={source} />}
    </div>
  )

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col max-md:-mb-24 md:h-dvh">
      {meta}
      {toolbar}
      {!canEdit && (
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-5 py-1.5 text-xs text-fg-3">
          <Lock className="size-3.5" /> {t('notes.readOnly')}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className={cx('grid min-h-0 min-w-0 flex-1', showEditor && showPreview ? 'grid-cols-2 divide-x divide-line' : 'grid-cols-1')}>
          {showEditor && (
            <div className="min-h-0 overflow-hidden">
              {synced ? (
                <Editor
                  ref={editor}
                  text={collab.text}
                  awareness={collab.provider.awareness}
                  readOnly={!canEdit}
                  placeholder={t('notes.emptyHint')}
                  users={dir}
                  comments={ranges}
                  onSelection={onEditorSelection}
                  onFiles={onFiles}
                />
              ) : (
                <div className="flex flex-col gap-3 p-6">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="h-5 w-3/4" />
                </div>
              )}
            </div>
          )}
          {showPreview && (
            <div className="min-h-0 overflow-y-auto">
              <Preview
                source={source}
                runs={runs}
                clients={authors.data}
                onlyAuthor={search.author ?? null}
                comments={ranges}
                onCommentClick={(cid) => {
                  setActiveId(cid)
                  openPanel('comments')
                }}
                onSelection={onPreviewSelection}
                onImage={(src, all) => setLightbox({ src, all })}
              />
            </div>
          )}
        </div>
        <AnimatePresence initial={false}>
          {!mobile && panelOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 360, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              className="min-h-0 shrink-0 overflow-hidden border-l border-line bg-surface/60"
            >
              <div className="h-full w-[360px]">{panel}</div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile panel buttons */}
      {mobile && (
        <div className="fixed right-4 bottom-20 z-20 flex flex-col gap-2">
          <FloatBtn icon={<MessagesSquare />} label={t('notes.panel.comments')} badge={openCount} onClick={() => openPanel('comments')} />
          <FloatBtn icon={<MoreHorizontal />} label={t('notes.panel.history')} onClick={() => openPanel(tab === 'comments' ? 'history' : tab)} />
        </div>
      )}
      {mobile && (
        <Dialog open={sheet} onOpenChange={setSheet} title={t(`notes.panel.${tab}`)} size="md">
          <div className="-mx-5 -mb-3 flex h-[65dvh] flex-col">
            <div className="flex gap-1 px-4 pb-2">
              {(['comments', 'history', 'files', 'links'] as const).map((k) => (
                <button key={k} onClick={() => setSearch({ tab: k }, true)} className={cx('h-9 flex-1 rounded-lg text-[13px] font-medium', tab === k ? 'bg-accent-soft text-accent-text' : 'text-fg-3')}>
                  {t(`notes.panel.${k}`)}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">{panel}</div>
          </div>
        </Dialog>
      )}

      {/* Floating comment bubble for the current selection */}
      <AnimatePresence>
        {sel && !draft && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed z-40"
            style={mobile ? { left: '50%', bottom: 150, transform: 'translateX(-50%)' } : { left: Math.min(sel.x, window.innerWidth - 140), top: sel.y + 8 }}
          >
            <Button data-testid="comment-bubble" variant="primary" size="sm" icon={<MessageSquarePlus className="size-4" />} onMouseDown={(e) => e.preventDefault()} onClick={startComment} className="shadow-card">
              {t('comments.add')}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {search.edit && (
        <NoteFormDialog
          open
          onOpenChange={(v) => !v && setSearch({ edit: undefined }, true)}
          title={t('notes.editMeta')}
          submitLabel={t('common.save')}
          initial={note}
          onSubmit={async (f) => {
            try {
              const r = await api<{ note: NoteDto }>(`/api/notes/${note.id}`, { method: 'PATCH', body: { ...f, version: note.version } })
              qc.setQueryData(['note', note.id], r)
              setSearch({ edit: undefined }, true)
            } catch (err) {
              toastError(err)
              qc.invalidateQueries({ queryKey: ['note', note.id] })
            }
          }}
        />
      )}
      {search.version && <VersionDialog noteId={note.id} versionId={search.version} canEdit={canEdit} onClose={() => setSearch({ version: undefined }, true)} />}
      {lightbox && <Lightbox {...lightbox} onClose={() => setLightbox(null)} />}
    </div>
  )
}

function NoteHeader({
  note,
  peers,
  status,
  synced,
  onEdit,
  onDelete,
}: {
  note: NoteDto
  peers: string[]
  status: string
  synced: boolean
  onEdit(): void
  onDelete(): void
}) {
  const { t, fmt, locale } = useI18n()
  const me = useMe()
  const isUrl = /^https?:\/\//.test(note.location)
  const end = note.endsAt ? fmt.time(note.endsAt) : null
  return (
    <div className="border-b border-line px-4 pt-4 pb-3 md:px-5">
      <div className="flex items-start gap-2">
        <IconButton label={t('common.back')} icon={<ArrowLeft />} size="sm" onClick={() => history.back()} className="-ml-1 hidden md:inline-flex" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold tracking-tight md:text-xl">{note.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-fg-3">
            <span>
              {fmt.dateTime(note.startsAt)}
              {end && ` – ${end}`}
            </span>
            {note.location && (
              <span className="flex min-w-0 items-center gap-1">
                <MapPin className="size-3.5 shrink-0" />
                {isUrl ? (
                  <a href={note.location} target="_blank" rel="noopener noreferrer" className="truncate text-accent-text hover:underline">
                    {note.location.replace(/^https?:\/\//, '').slice(0, 40)}
                  </a>
                ) : (
                  <span className="truncate">{note.location}</span>
                )}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Pencil className="size-3.5" />
              <UserName id={note.recorderId} />
            </span>
            <span className="flex items-center gap-1.5">
              {t('notes.field.attendees')}
              <AvatarStack ids={note.attendeeIds} max={5} size="xs" />
            </span>
            {note.absentees.length > 0 && (
              <span className="truncate text-fg-4">
                {t('notes.field.absentees')}：{note.absentees.map((a) => `${a.name ?? ''}${a.reason ? `（${a.reason}）` : ''}`).join(locale === 'zh' ? '、' : ', ')}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Tooltip label={status === 'connected' ? (synced ? t('notes.synced') : t('notes.connecting')) : t('notes.offlineEditing')}>
            <span className={cx('flex size-8 items-center justify-center rounded-full', status === 'connected' ? 'text-success' : 'text-warning')}>
              {status === 'connected' ? <Wifi className="size-4" /> : <WifiOff className="size-4 animate-pulse" />}
            </span>
          </Tooltip>
          {peers.length > 0 && (
            <Tooltip label={t('notes.online', { n: peers.length })}>
              <span className="hidden sm:flex">
                <AvatarStack ids={peers} max={4} size="sm" />
              </span>
            </Tooltip>
          )}
          <Menu>
            <MenuTrigger asChild>
              <IconButton label={t('common.edit')} icon={<MoreHorizontal />} size="sm" />
            </MenuTrigger>
            <MenuContent>
              {note.canEdit && (
                <MenuItem icon={<Pencil />} onSelect={onEdit}>
                  {t('notes.editMeta')}
                </MenuItem>
              )}
              <MenuItem
                icon={<Copy />}
                onSelect={async () => {
                  const md = await fetch(`/api/notes/${note.id}/markdown`, { headers: { 'x-locale': locale } }).then((r) => r.text())
                  await navigator.clipboard.writeText(md)
                  toast(t('common.copied'))
                }}
              >
                {t('notes.copyMarkdown')}
              </MenuItem>
              {(note.createdBy === me.id || me.role !== 'student') && (
                <>
                  <MenuSeparator />
                  <MenuItem icon={<Trash2 />} danger onSelect={onDelete}>
                    {t('common.delete')}
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        </div>
      </div>
    </div>
  )
}

function FormatButtons({ onApply, onImage }: { onApply(k: FormatKind): void; onImage(): void }) {
  const { t } = useI18n()
  const items: [FormatKind, ReactNode, string, string?][] = [
    ['h2', <Heading2 />, t('toolbar.h2')],
    ['bold', <Bold />, t('toolbar.bold'), 'mod+b'],
    ['italic', <Italic />, t('toolbar.italic'), 'mod+i'],
    ['list', <List />, t('toolbar.list')],
    ['ordered', <ListOrdered />, t('toolbar.ordered')],
    ['task', <ListChecks />, t('toolbar.task')],
    ['table', <Table />, t('toolbar.table')],
    ['code', <Code2 />, t('toolbar.code')],
    ['link', <Link2 />, t('toolbar.link')],
  ]
  return (
    <div className="flex items-center gap-0.5">
      {items.map(([k, icon, label, sc]) => (
        <IconButton key={k} label={label} shortcut={sc} icon={icon} size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => onApply(k)} />
      ))}
      <Menu>
        <MenuTrigger asChild>
          <IconButton label={t('toolbar.table')} icon={<MoreHorizontal />} size="sm" onMouseDown={(e) => e.preventDefault()} />
        </MenuTrigger>
        <MenuContent align="start">
          <MenuItem onSelect={() => onApply('addRow')}>{t('toolbar.addRow')}</MenuItem>
          <MenuItem onSelect={() => onApply('addCol')}>{t('toolbar.addCol')}</MenuItem>
        </MenuContent>
      </Menu>
      <IconButton label={t('toolbar.image')} icon={<ImagePlus />} size="sm" onMouseDown={(e) => e.preventDefault()} onClick={onImage} />
    </div>
  )
}

function PanelTab({ icon, label, badge, onClick, active }: { icon: ReactNode; label: string; badge?: number; onClick(): void; active: boolean }) {
  return (
    <Tooltip label={label}>
      <button
        aria-label={label}
        onClick={onClick}
        className={cx('relative flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] [&_svg]:size-4', active ? 'bg-accent-soft text-accent-text' : 'text-fg-3 hover:bg-surface-2')}
      >
        {icon}
        {!!badge && <span className="min-w-4 rounded-full bg-warning px-1 text-[10px] font-bold text-white">{badge}</span>}
      </button>
    </Tooltip>
  )
}

function FloatBtn({ icon, label, badge, onClick }: { icon: ReactNode; label: string; badge?: number; onClick(): void }) {
  return (
    <button aria-label={label} onClick={onClick} className="relative flex size-12 items-center justify-center rounded-full border border-line bg-surface text-fg-2 shadow-card active:scale-95 [&_svg]:size-5">
      {icon}
      {!!badge && <span className="absolute -top-1 -right-1 min-w-5 rounded-full bg-warning px-1 text-center text-[11px] font-bold text-white">{badge}</span>}
    </button>
  )
}

function LinksPanel({ source }: { source: string }) {
  const { t } = useI18n()
  const refs = useMemo(() => {
    const seen = new Set<string>()
    const out: { type: 'issue' | 'task'; id: string }[] = []
    for (const m of source.matchAll(/#\[(issue|task):([\w-]+)\]/g)) {
      const k = `${m[1]}:${m[2]}`
      if (!seen.has(k)) {
        seen.add(k)
        out.push({ type: m[1] as 'issue', id: m[2]! })
      }
    }
    return out
  }, [source])
  if (!refs.length) return <EmptyState icon={<Link2 />} title={t('links.empty')} hint={t('links.hint')} />
  return (
    <ul className="flex flex-col gap-2 overflow-y-auto p-4">
      {refs.map((r) => (
        <li key={`${r.type}:${r.id}`} className="text-sm">
          <RefPill type={r.type} id={r.id} />
        </li>
      ))}
    </ul>
  )
}

function Lightbox({ src, all, onClose }: { src: string; all: string[]; onClose(): void }) {
  const [i, setI] = useState(Math.max(0, all.indexOf(src)))
  const { t } = useI18n()
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setI((x) => Math.min(x + 1, all.length - 1))
      if (e.key === 'ArrowLeft') setI((x) => Math.max(x - 1, 0))
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [all.length])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${i + 1} / ${all.length}`} size="full">
      <div className="relative flex items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.img key={all[i]} src={all[i]} alt="" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="max-h-[72vh] max-w-full rounded-xl" />
        </AnimatePresence>
        {i > 0 && <IconButton label={t('common.prev')} icon={<ChevronLeft />} variant="secondary" className="absolute left-0" onClick={() => setI(i - 1)} />}
        {i < all.length - 1 && <IconButton label={t('common.next')} icon={<ChevronRight />} variant="secondary" className="absolute right-0" onClick={() => setI(i + 1)} />}
      </div>
    </Dialog>
  )
}
