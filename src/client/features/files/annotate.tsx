import { ArrowUpRight, Redo2, Square, Type, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useI18n } from '../../lib/i18n'
import { Button, IconButton } from '../../ui/button'
import { cx } from '../../ui/cx'
import { Dialog } from '../../ui/dialog'

type Tool = 'rect' | 'arrow' | 'text'
type Shape = { kind: Tool; x1: number; y1: number; x2: number; y2: number; text?: string }
type Req = { file: File; resolve(f: File): void }

let req: Req | null = null
const listeners = new Set<() => void>()
const set = (r: Req | null) => {
  req = r
  listeners.forEach((l) => l())
}

/** Opens the annotator for a pasted or dropped image; resolves with the marked-up copy, or the original if skipped. */
export function annotateImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return Promise.resolve(file)
  return new Promise((resolve) => set({ file, resolve }))
}

export function AnnotateHost() {
  const r = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => req,
  )
  return r ? <Annotator key={r.file.name + r.file.size} req={r} /> : null
}

function draw(ctx: CanvasRenderingContext2D, s: Shape, color: string, scale: number) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 4 * scale
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (s.kind === 'rect') ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1))
  if (s.kind === 'arrow') {
    const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
    const head = 18 * scale
    ctx.beginPath()
    ctx.moveTo(s.x1, s.y1)
    ctx.lineTo(s.x2, s.y2)
    ctx.moveTo(s.x2, s.y2)
    ctx.lineTo(s.x2 - head * Math.cos(a - 0.45), s.y2 - head * Math.sin(a - 0.45))
    ctx.moveTo(s.x2, s.y2)
    ctx.lineTo(s.x2 - head * Math.cos(a + 0.45), s.y2 - head * Math.sin(a + 0.45))
    ctx.stroke()
  }
  if (s.kind === 'text' && s.text) {
    ctx.font = `600 ${28 * scale}px system-ui, sans-serif`
    ctx.textBaseline = 'top'
    ctx.fillText(s.text, s.x1, s.y1)
  }
}

function Annotator({ req: r }: { req: Req }) {
  const { t } = useI18n()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<Tool>('rect')
  // Shapes and the redo stack change together, so they live in one state value.
  const [hist, setHist] = useState<{ shapes: Shape[]; redo: Shape[] }>({ shapes: [], redo: [] })
  const { shapes, redo } = hist
  const undoOne = () => setHist((h) => (h.shapes.length ? { shapes: h.shapes.slice(0, -1), redo: [...h.redo, h.shapes[h.shapes.length - 1]!] } : h))
  const redoOne = () => setHist((h) => (h.redo.length ? { shapes: [...h.shapes, h.redo[h.redo.length - 1]!], redo: h.redo.slice(0, -1) } : h))
  const [live, setLive] = useState<Shape | null>(null)
  const [typing, setTyping] = useState<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const [label, setLabel] = useState('')

  useEffect(() => {
    const url = URL.createObjectURL(r.file)
    const i = new Image()
    i.onload = () => setImg(i)
    i.src = url
    return () => URL.revokeObjectURL(url)
  }, [r.file])

  // Draw at the image's own resolution; CSS scales the canvas to fit the dialog.
  const scale = img ? Math.max(1, img.naturalWidth / 900) : 1
  const color = typeof window === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue('--color-danger').trim()
  useEffect(() => {
    const c = canvas.current
    if (!c || !img) return
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    for (const s of [...shapes, ...(live ? [live] : [])]) draw(ctx, s, color, scale)
  }, [img, shapes, live, color, scale])

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || (e.target as HTMLElement).tagName === 'INPUT') return
      e.preventDefault()
      if (e.shiftKey) redoOne()
      else undoOne()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const point = (e: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * canvas.current!.width, y: ((e.clientY - rect.top) / rect.height) * canvas.current!.height, cx: e.clientX - rect.left, cy: e.clientY - rect.top }
  }
  const commit = (s: Shape) => setHist((h) => ({ shapes: [...h.shapes, s], redo: [] }))
  const finish = (f: File) => {
    r.resolve(f)
    set(null)
  }
  const done = () =>
    canvas.current!.toBlob((b) => finish(b ? new File([b], r.file.name.replace(/\.\w+$/, '') + '.png', { type: 'image/png' }) : r.file), 'image/png')
  const tools: { id: Tool; icon: React.ReactNode; label: string }[] = [
    { id: 'rect', icon: <Square />, label: t('annotate.rect') },
    { id: 'arrow', icon: <ArrowUpRight />, label: t('annotate.arrow') },
    { id: 'text', icon: <Type />, label: t('annotate.text') },
  ]
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && finish(r.file)}
      title={t('annotate.title')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => finish(r.file)}>
            {t('annotate.skip')}
          </Button>
          <Button variant="primary" onClick={done} disabled={!img}>
            {t('annotate.done')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1">
          {tools.map((x) => (
            <IconButton key={x.id} label={x.label} icon={x.icon} size="sm" variant={tool === x.id ? 'soft' : 'ghost'} aria-pressed={tool === x.id} onClick={() => setTool(x.id)} />
          ))}
          <span className="mx-1 h-5 w-px bg-line" />
          <IconButton label={t('annotate.undo')} icon={<Undo2 />} size="sm" shortcut="mod+z" disabled={!shapes.length} onClick={undoOne} />
          <IconButton label={t('annotate.redo')} icon={<Redo2 />} size="sm" disabled={!redo.length} onClick={redoOne} />
        </div>
        <div className="relative overflow-hidden rounded-xl border border-line bg-canvas">
          <canvas
            ref={canvas}
            aria-label={t('annotate.title')}
            className={cx('block h-auto max-h-[60vh] w-full touch-none object-contain', tool === 'text' ? 'cursor-text' : 'cursor-crosshair')}
            onPointerDown={(e) => {
              // Drawing must not start the bottom sheet's drag-to-dismiss on phones.
              e.stopPropagation()
              const p = point(e)
              if (tool === 'text') {
                setTyping({ x: p.x, y: p.y, cx: p.cx, cy: p.cy })
                setLabel('')
                return
              }
              e.currentTarget.setPointerCapture(e.pointerId)
              setLive({ kind: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y })
            }}
            onPointerMove={(e) => live && setLive({ ...live, x2: point(e).x, y2: point(e).y })}
            onPointerUp={() => {
              if (live && Math.hypot(live.x2 - live.x1, live.y2 - live.y1) > 6) commit(live)
              setLive(null)
            }}
          />
          {typing && (
            <input
              autoFocus
              value={label}
              aria-label={t('annotate.text')}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setTyping(null)
                }
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              onBlur={() => {
                if (label.trim()) commit({ kind: 'text', x1: typing.x, y1: typing.y, x2: typing.x, y2: typing.y, text: label.trim() })
                setTyping(null)
              }}
              className="absolute h-8 min-w-32 rounded-md border border-danger bg-surface px-2 text-sm text-danger focus:outline-none"
              style={{ left: typing.cx, top: typing.cy }}
            />
          )}
        </div>
        <p className="text-xs text-fg-4">{t('annotate.hint')}</p>
      </div>
    </Dialog>
  )
}
