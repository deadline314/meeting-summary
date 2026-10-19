import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { renderMarkdown } from '../../lib/markdown'
import { fileUrl } from '../../lib/upload'
import { Button } from '../../ui/button'
import { Dialog } from '../../ui/dialog'
import { Skeleton } from '../../ui/misc'
import { DataViewer } from '../data/data-viewer'
import { isTable } from '../data/parse'

type F = { id: string; name: string; mime: string; kind: string }

const CODE = /\.(py|js|ts|tsx|jsx|cpp|cc|c|h|hpp|java|go|rs|rb|sh|r|m|json|ya?ml|toml|sql|md|txt|log)$/i

export const isPreviewable = (f: F) =>
  f.mime.startsWith('image/') || f.mime === 'application/pdf' || f.mime.startsWith('video/') || CODE.test(f.name) || f.name.endsWith('.ipynb') || isTable(f.name)

export function FilePreviewDialog({ file, onClose }: { file: F; onClose(): void }) {
  const { t } = useI18n()
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="full"
      title={file.name}
      footer={
        <Button icon={<Download className="size-4" />} onClick={() => (location.href = `${fileUrl(file.id)}?download=1`)}>
          {t('files.download')}
        </Button>
      }
    >
      <Body file={file} />
    </Dialog>
  )
}

function Body({ file }: { file: F }) {
  if (file.mime.startsWith('image/')) return <img src={fileUrl(file.id)} alt={file.name} className="mx-auto max-h-[70vh] rounded-xl" />
  if (file.mime.startsWith('video/')) return <video src={fileUrl(file.id)} controls className="mx-auto max-h-[70vh] rounded-xl" />
  if (file.mime === 'application/pdf') return <iframe src={fileUrl(file.id)} title={file.name} className="h-[70vh] w-full rounded-xl border border-line" />
  if (file.name.endsWith('.ipynb')) return <Notebook id={file.id} />
  if (isTable(file.name))
    return (
      <div className="flex h-[66vh] flex-col max-md:h-[74dvh]">
        <DataViewer file={file} />
      </div>
    )
  return <Code id={file.id} name={file.name} />
}

function useText(id: string) {
  return useQuery({ queryKey: ['file-text', id], enabled: !!id, queryFn: () => fetch(`/api/files/${id}/text`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))) })
}

/** Syntax-highlighted source; highlight.js is loaded only when a preview opens. */
export function Code({ id, name, text }: { id?: string; name: string; text?: string }) {
  const q = useText(id ?? '')
  const src = text ?? q.data
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    if (src === undefined) return
    let live = true
    import('./highlight').then(({ highlight }) => live && setHtml(highlight(src, name)))
    return () => {
      live = false
    }
  }, [src, name])
  if (src === undefined && q.isPending) return <Skeleton className="h-64" />
  return (
    <pre className="hljs max-h-[70vh] overflow-auto rounded-xl border border-line bg-canvas p-4 font-mono text-[12.5px] leading-relaxed">
      {html ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{src}</code>}
    </pre>
  )
}

type Cell = { cell_type: 'markdown' | 'code' | 'raw'; source: string | string[]; outputs?: Output[] }
type Output = { output_type: string; text?: string | string[]; data?: Record<string, string | string[]>; ename?: string; evalue?: string }

const join = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join('') : (v ?? ''))

function Notebook({ id }: { id: string }) {
  const q = useText(id)
  const { t } = useI18n()
  if (q.isPending) return <Skeleton className="h-64" />
  let cells: Cell[]
  try {
    cells = (JSON.parse(q.data ?? '{}') as { cells?: Cell[] }).cells ?? []
  } catch {
    return <Code name="notebook.json" text={q.data ?? ''} />
  }
  return (
    <div className="flex flex-col gap-3">
      {cells.map((c, i) =>
        c.cell_type === 'markdown' ? (
          <div key={i} className="prose-md px-1" dangerouslySetInnerHTML={{ __html: renderMarkdown(join(c.source)) }} />
        ) : (
          <div key={i} className="flex flex-col gap-1.5">
            <Code name="cell.py" text={join(c.source)} />
            {c.outputs?.map((o, j) => <OutputView key={j} o={o} />)}
          </div>
        ),
      )}
      {!cells.length && <div className="py-8 text-center text-sm text-fg-4">{t('files.empty')}</div>}
    </div>
  )
}

function OutputView({ o }: { o: Output }) {
  const png = o.data?.['image/png']
  if (png) return <img src={`data:image/png;base64,${join(png).replace(/\s/g, '')}`} alt="" className="max-w-full rounded-lg border border-line bg-white" />
  if (o.output_type === 'error') return <pre className="rounded-lg bg-danger-soft p-2 font-mono text-xs text-danger">{`${o.ename}: ${o.evalue}`}</pre>
  const text = join(o.text) || join(o.data?.['text/plain'])
  return text ? <pre className="max-h-64 overflow-auto rounded-lg bg-surface-2 p-2 font-mono text-xs text-fg-2">{text}</pre> : null
}

