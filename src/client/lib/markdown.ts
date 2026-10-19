import DOMPurify from 'dompurify'
import { Marked, type Token } from 'marked'

const marked = new Marked({ gfm: true, breaks: true })

// References: @[user:id], #[issue:KEY-12], #[task:id] → placeholders hydrated by the preview.
const REF = /([@#])\[(user|issue|task):([\w-]+)\]/g

function withRefs(html: string) {
  return html.replace(REF, (_, _sigil, type: string, id: string) => `<span data-ref="${type}" data-id="${id}"></span>`)
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
  if (node.tagName === 'INPUT') node.setAttribute('disabled', '')
})

export function renderMarkdown(md: string) {
  return DOMPurify.sanitize(withRefs(marked.parse(md, { async: false }) as string), {
    ADD_ATTR: ['data-ref', 'data-id', 'data-c', 'target'],
  })
}

export type Block = { start: number; end: number; html: string; type: Token['type'] }

/**
 * Splits Markdown into top-level blocks with source offsets, so the preview can show
 * who wrote each block and map a selection back to the source text.
 */
export function splitBlocks(md: string): { start: number; end: number; raw: string; type: string }[] {
  const tokens = marked.lexer(md)
  const out: { start: number; end: number; raw: string; type: string }[] = []
  let pos = 0
  for (const t of tokens) {
    const start = pos
    pos += t.raw.length
    if (t.type === 'space') continue
    out.push({ start, end: pos, raw: t.raw, type: t.type })
  }
  return out
}

// Private-use sentinels that survive Markdown rendering; replaced by <mark> afterwards.
const OPEN = String.fromCharCode(0xe000)
const SEP = String.fromCharCode(0xe001)
const CLOSE = String.fromCharCode(0xe002)
const MARK_RE = new RegExp(`${OPEN}([\\w-]+)${SEP}`, 'g')

/** Wraps comment ranges (relative to `raw`) in <mark data-c="id"> after rendering. */
export function renderWithMarks(raw: string, ranges: { id: string; from: number; to: number; active?: boolean }[]) {
  if (!ranges.length) return renderMarkdown(raw)
  const inserts: { at: number; text: string }[] = []
  for (const r of ranges) {
    const from = Math.max(0, Math.min(raw.length, r.from))
    const to = Math.max(from, Math.min(raw.length, r.to))
    if (to === from) continue
    inserts.push({ at: from, text: `${OPEN}${r.id}${SEP}` }, { at: to, text: CLOSE })
  }
  inserts.sort((a, b) => b.at - a.at)
  let s = raw
  for (const i of inserts) s = s.slice(0, i.at) + i.text + s.slice(i.at)
  const active = new Set(ranges.filter((r) => r.active).map((r) => r.id))
  return renderMarkdown(s)
    .replace(MARK_RE, (_, id: string) => `<mark class="comment-mark${active.has(id) ? ' active' : ''}" data-c="${id}">`)
    .replaceAll(CLOSE, '</mark>')
}
