import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, FileCode2, FileText, Film, HardDrive, Image as ImageIcon, Link2, Paperclip, Trash2, Upload, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState, type DragEvent } from 'react'
import { api } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { useMe, isAdminRole } from '../../lib/session'
import { compressImage, fileUrl, uploadFile, type Uploaded } from '../../lib/upload'
import { Button, IconButton } from '../../ui/button'
import { cx } from '../../ui/cx'
import { confirm } from '../../ui/dialog'
import { Input } from '../../ui/field'
import { EmptyState } from '../../ui/misc'
import { toastError } from '../../ui/toast'
import { FilePreviewDialog, isPreviewable } from './file-preview'

export type FileRow = Uploaded & { ownerId: string; createdAt: number; driveUrl: string | null }

type Pending = { key: string; name: string; pct: number; abort: AbortController }

export function useFiles(parentType: string, parentId: string) {
  return useQuery({
    queryKey: ['files', parentType, parentId],
    queryFn: async () => (await api<{ items: FileRow[] }>(`/api/files?parentType=${parentType}&parentId=${parentId}`)).items,
  })
}

export function iconFor(f: { mime: string; kind: string; name: string }) {
  if (f.kind === 'drive') return HardDrive
  if (f.mime.startsWith('image/')) return ImageIcon
  if (f.mime.startsWith('video/')) return Film
  if (/\.(py|ipynb|js|ts|tsx|cpp|c|h|java|go|rs|rb|sh|r|m|json|yaml|yml)$/i.test(f.name)) return FileCode2
  return FileText
}

/** Attachment list with drag-and-drop upload, per-file progress, Drive links and in-page preview. */
export function FilesPanel({ parentType, parentId, canUpload = true }: { parentType: string; parentId: string; canUpload?: boolean }) {
  const { t, fmt } = useI18n()
  const me = useMe()
  const qc = useQueryClient()
  const list = useFiles(parentType, parentId)
  const [pending, setPending] = useState<Pending[]>([])
  const [over, setOver] = useState(false)
  const [drive, setDrive] = useState(false)
  const [preview, setPreview] = useState<FileRow | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['files', parentType, parentId] })

  const upload = async (files: File[]) => {
    for (const raw of files) {
      const key = crypto.randomUUID()
      const abort = new AbortController()
      setPending((p) => [...p, { key, name: raw.name, pct: 0, abort }])
      try {
        const file = await compressImage(raw)
        await uploadFile(file, { parentType, parentId }, { signal: abort.signal, onProgress: (pct) => setPending((p) => p.map((x) => (x.key === key ? { ...x, pct } : x))) })
        refresh()
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) toastError(err, { label: t('common.retry'), run: () => upload([raw]) })
      } finally {
        setPending((p) => p.filter((x) => x.key !== key))
      }
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (canUpload) upload([...e.dataTransfer.files])
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-4 pt-3 pb-4" onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      {canUpload && (
        <div
          className={cx(
            'flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-4 text-center text-sm transition-colors',
            over ? 'border-accent bg-accent-soft text-accent-text' : 'border-line text-fg-3',
          )}
        >
          <Upload className="size-5" />
          <span>
            {t('files.drop')}{' '}
            <button className="font-semibold text-accent-text underline-offset-2 hover:underline" onClick={() => input.current?.click()}>
              {t('files.browse')}
            </button>
          </span>
          <input ref={input} type="file" multiple hidden onChange={(e) => (upload([...(e.target.files ?? [])]), (e.target.value = ''))} />
          <Button size="sm" variant="ghost" icon={<Link2 className="size-3.5" />} onClick={() => setDrive((d) => !d)}>
            {t('files.linkDrive')}
          </Button>
          <AnimatePresence>{drive && <DriveForm parentType={parentType} parentId={parentId} onDone={() => (setDrive(false), refresh())} />}</AnimatePresence>
        </div>
      )}
      <ul className="flex flex-col gap-1.5">
        <AnimatePresence initial={false}>
          {pending.map((p) => (
            <motion.li key={p.key} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="rounded-xl border border-line bg-surface p-2.5">
              <div className="flex items-center gap-2 text-sm">
                <Paperclip className="size-4 text-fg-4" />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-xs text-fg-4">{t('files.uploading', { pct: p.pct })}</span>
                <IconButton label={t('files.cancel')} icon={<X />} size="sm" onClick={() => p.abort.abort()} />
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
                <motion.div className="h-full bg-accent" animate={{ width: `${p.pct}%` }} />
              </div>
            </motion.li>
          ))}
          {list.data?.map((f) => {
            const Icon = iconFor(f)
            const canDelete = f.ownerId === me.id || isAdminRole(me.role)
            return (
              <motion.li key={f.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="group flex items-center gap-2.5 rounded-xl border border-line bg-surface p-2.5">
                {f.kind === 'image' ? (
                  <img src={fileUrl(f.id)} alt="" className="size-10 shrink-0 rounded-lg border border-line object-cover" loading="lazy" />
                ) : (
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-3">
                    <Icon className="size-5" />
                  </span>
                )}
                <button className="min-w-0 flex-1 text-left" onClick={() => (f.kind === 'drive' ? window.open(f.driveUrl!, '_blank', 'noopener') : isPreviewable(f) ? setPreview(f) : (location.href = `${fileUrl(f.id)}?download=1`))}>
                  <div className="truncate text-sm font-medium hover:text-accent-text">{f.name}</div>
                  <div className="text-xs text-fg-4">{f.kind === 'drive' ? 'Google Drive' : `${fmt.bytes(f.size)} · ${fmt.relative(f.createdAt)}`}</div>
                </button>
                {f.kind === 'drive' ? (
                  <IconButton label={t('files.preview')} icon={<ExternalLink />} size="sm" onClick={() => window.open(f.driveUrl!, '_blank', 'noopener')} />
                ) : (
                  <IconButton label={t('files.download')} icon={<Download />} size="sm" onClick={() => (location.href = `${fileUrl(f.id)}?download=1`)} />
                )}
                {canDelete && (
                  <IconButton
                    label={t('common.delete')}
                    icon={<Trash2 />}
                    size="sm"
                    className="opacity-60 group-hover:opacity-100"
                    onClick={async () => {
                      if (await confirm({ title: t('common.delete'), body: t('files.deleteConfirm', { name: f.name }), danger: true }))
                        api(`/api/files/${f.id}`, { method: 'DELETE' }).then(refresh, toastError)
                    }}
                  />
                )}
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
      {!canUpload && !pending.length && list.data?.length === 0 && <EmptyState icon={<Paperclip />} title={t('files.empty')} />}
      {preview && <FilePreviewDialog file={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

function DriveForm({ parentType, parentId, onDone }: { parentType: string; parentId: string; onDone(): void }) {
  const { t } = useI18n()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <motion.form
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="flex w-full flex-col gap-2 overflow-hidden text-left"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await api('/api/files/drive', { method: 'POST', body: { parentType, parentId, url, name: name || driveName(url) } })
          onDone()
        } catch (err) {
          toastError(err)
        } finally {
          setBusy(false)
        }
      }}
    >
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('files.drivePh')} aria-label={t('files.drivePh')} type="url" required />
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('files.driveName')} aria-label={t('files.driveName')} />
      <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!/^https:\/\/(drive|docs)\.google\.com\//.test(url)}>
        {t('common.save')}
      </Button>
    </motion.form>
  )
}

export function driveName(url: string) {
  const kind = /\/document\//.test(url) ? 'Google Docs' : /\/spreadsheets\//.test(url) ? 'Google Sheets' : /\/presentation\//.test(url) ? 'Google Slides' : 'Google Drive'
  return kind
}
