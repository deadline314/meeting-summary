import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../lib/i18n'
import { renderWithMarks, splitBlocks } from '../../lib/markdown'
import { useDirectory } from '../../lib/session'
import { AvatarStack, authorColor } from '../../ui/avatar'
import { cx } from '../../ui/cx'
import { Tooltip } from '../../ui/tooltip'
import { RefPill } from './ref-pill'
import type { ClientInfo, Run } from './collab'
import { authorsIn } from './collab'

export type CommentRange = { id: string; from: number; to: number; active: boolean }

type Props = {
  source: string
  runs: Run[] | null
  clients: ClientInfo | undefined
  onlyAuthor: string | null
  comments: CommentRange[]
  onCommentClick(id: string): void
  onSelection(sel: { from: number; to: number; quote: string } | null): void
  onImage(src: string, all: string[]): void
}

/**
 * Renders Markdown block by block. Each block knows its source offsets, which lets us
 * colour it by author, highlight comment ranges, and map a selection back to source.
 */
export function Preview(p: Props) {
  const blocks = useMemo(() => splitBlocks(p.source), [p.source])
  const container = useRef<HTMLDivElement>(null)

  const readSelection = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount || !container.current) return p.onSelection(null)
    const range = sel.getRangeAt(0)
    const el = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement) as HTMLElement | null
    const blockEl = el?.closest<HTMLElement>('[data-start]')
    if (!blockEl || !container.current.contains(blockEl)) return p.onSelection(null)
    const quote = sel.toString().trim()
    const start = Number(blockEl.dataset.start)
    const end = Number(blockEl.dataset.end)
    const raw = p.source.slice(start, end)
    const at = raw.indexOf(quote)
    if (!quote || at < 0) {
      // Formatting split the text; fall back to the first selected line within the block.
      const firstLine = quote.split('\n')[0]!.trim()
      const i = firstLine ? raw.indexOf(firstLine) : -1
      if (i < 0) return p.onSelection(null)
      return p.onSelection({ from: start + i, to: start + i + firstLine.length, quote: firstLine })
    }
    p.onSelection({ from: start + at, to: start + at + quote.length, quote })
  }

  // selectionchange covers mouse, keyboard and long-press selection on phones.
  const read = useRef(readSelection)
  useLayoutEffect(() => {
    read.current = readSelection
  })
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const on = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const sel = window.getSelection()
        const inside = sel?.anchorNode && container.current?.contains(sel.anchorNode)
        if (inside || sel?.isCollapsed) read.current()
      }, 120)
    }
    document.addEventListener('selectionchange', on)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', on)
    }
  }, [])

  const onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement
    const mark = t.closest<HTMLElement>('mark[data-c]')
    if (mark) return p.onCommentClick(mark.dataset.c!)
    if (t.tagName === 'IMG') {
      const all = [...(container.current?.querySelectorAll('img') ?? [])].map((i) => i.getAttribute('src') ?? '')
      p.onImage(t.getAttribute('src') ?? '', all)
    }
  }

  return (
    <div ref={container} onClick={onClick} className="prose-md px-4 py-5 md:px-8">
      {blocks.map((b) => (
        <BlockView
          key={`${b.start}:${b.raw.length}:${b.raw.slice(0, 24)}`}
          raw={b.raw}
          start={b.start}
          end={b.end}
          runs={p.runs}
          clients={p.clients}
          onlyAuthor={p.onlyAuthor}
          comments={p.comments}
        />
      ))}
    </div>
  )
}

const BlockView = memo(function BlockView({
  raw,
  start,
  end,
  runs,
  clients,
  onlyAuthor,
  comments,
}: {
  raw: string
  start: number
  end: number
  runs: Run[] | null
  clients: ClientInfo | undefined
  onlyAuthor: string | null
  comments: CommentRange[]
}) {
  const { t, fmt } = useI18n()
  const dir = useDirectory()
  const local = comments.filter((c) => c.to > start && c.from < end).map((c) => ({ id: c.id, from: c.from - start, to: c.to - start, active: c.active }))
  const key = JSON.stringify(local)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => renderWithMarks(raw, local), [raw, key])

  if (!runs)
    return (
      <div data-start={start} data-end={end}>
        <Html html={html} />
      </div>
    )
  const { ids, lastAt } = authorsIn(runs, clients, start, end)
  const dim = onlyAuthor && !ids.includes(onlyAuthor)
  const main = ids[0]
  const names = ids.map((id) => dir.get(id)?.name ?? t('common.unknownUser'))
  return (
    <div className={cx('group relative -ml-4 pl-4 transition-opacity md:-ml-6 md:pl-6', dim && 'opacity-30')} data-start={start} data-end={end}>
      {main && (
        <Tooltip label={`${names.join('、')}${lastAt ? ` · ${fmt.relative(lastAt)}` : ''}`} side="left">
          <span
            className="absolute top-0 bottom-0 left-0 w-1 rounded-full transition-[width] group-hover:w-1.5"
            style={{ background: ids.length > 1 ? `linear-gradient(${ids.slice(0, 4).map((id) => authorColor(id)).join(',')})` : authorColor(main) }}
            aria-label={names.join('、')}
          />
        </Tooltip>
      )}
      {ids.length > 1 && (
        <span className="pointer-events-none absolute top-0 right-0 opacity-0 transition-opacity group-hover:opacity-100">
          <AvatarStack ids={ids} max={3} size="xs" />
        </span>
      )}
      <Html html={html} />
    </div>
  )
})

/** Sanitized HTML whose `<span data-ref>` placeholders become live pills via portals (keeps app context). */
export function Html({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [slots, setSlots] = useState<{ el: HTMLElement; type: string; id: string }[]>([])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const found = [...el.querySelectorAll<HTMLElement>('span[data-ref]')].map((s) => ({ el: s, type: s.dataset.ref!, id: s.dataset.id! }))
    setSlots(found)
    // Fenced code gets syntax colours; the highlighter loads only when a page has code.
    const blocks = [...el.querySelectorAll<HTMLElement>('pre > code')]
    if (!blocks.length) return
    let live = true
    import('../files/highlight').then(({ highlightFence }) => {
      if (!live) return
      for (const b of blocks) {
        if (b.dataset.hl) continue
        b.innerHTML = highlightFence(b.textContent ?? '', /language-([\w+-]+)/.exec(b.className)?.[1])
        b.dataset.hl = '1'
        b.classList.add('hljs')
      }
    })
    return () => {
      live = false
    }
  }, [html])
  return (
    <>
      <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />
      {slots.map((s, i) => createPortal(<RefPill type={s.type as 'user'} id={s.id} />, s.el, `${i}:${s.id}`))}
    </>
  )
}
