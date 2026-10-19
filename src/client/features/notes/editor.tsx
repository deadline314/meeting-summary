import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { EditorState, RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, keymap, placeholder as cmPlaceholder, type DecorationSet } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import * as Y from 'yjs'
import { driveKind } from '../../lib/markdown'
import { api } from '../../lib/api'
import type { DirectoryUser } from '@shared/types'

export type EditorHandle = {
  view: () => EditorView | null
  /** Wrap/prefix the selection with Markdown syntax (toolbar). */
  apply(kind: FormatKind): void
  insert(text: string): void
  focus(): void
}

export type FormatKind = 'h2' | 'bold' | 'italic' | 'list' | 'ordered' | 'task' | 'table' | 'code' | 'link' | 'addRow' | 'addCol'

type Props = {
  text: Y.Text
  awareness: unknown
  readOnly: boolean
  placeholder: string
  users: Map<string, DirectoryUser>
  comments: { id: string; from: number; to: number; active: boolean }[]
  onSelection(sel: { from: number; to: number } | null): void
  onFiles(files: File[], at: number): void
  /** A lone Google Drive URL was pasted (it is inserted as a card link). */
  onDriveUrl?(url: string): void
}

const setMarks = StateEffect.define<DecorationSet>()
const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) if (e.is(setMarks)) deco = e.value
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const highlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.35em', fontWeight: '700' },
  { tag: tags.heading2, fontSize: '1.18em', fontWeight: '650' },
  { tag: tags.heading3, fontWeight: '650' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--t-accent-text)' },
  { tag: tags.url, color: 'var(--t-fg-4)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', color: 'var(--t-fg-2)' },
  { tag: tags.processingInstruction, color: 'var(--t-fg-4)' },
  { tag: tags.quote, color: 'var(--t-fg-3)' },
  { tag: tags.list, color: 'var(--t-accent-text)' },
])

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '15px', color: 'var(--t-fg)', backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: 'var(--font-sans)', lineHeight: '1.75', overflow: 'auto' },
  '.cm-content': { padding: '20px 0 40vh', caretColor: 'var(--t-accent)' },
  '.cm-line': { padding: '0 24px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--t-accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--t-accent-soft) !important' },
  '.cm-placeholder': { color: 'var(--t-fg-4)' },
  '.cm-ySelectionInfo': { fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: '600', padding: '1px 5px', borderRadius: '6px 6px 6px 0', opacity: '1', top: '-1.45em' },
  '.cm-comment-mark': { backgroundColor: 'var(--t-highlight)', borderRadius: '3px' },
  '.cm-comment-mark.active': { outline: '2px solid var(--t-warning)' },
  '.cm-tooltip': { backgroundColor: 'var(--t-surface)', border: '1px solid var(--t-line)', borderRadius: '12px', boxShadow: 'var(--t-shadow)', overflow: 'hidden' },
  '.cm-tooltip-autocomplete ul li': { padding: '6px 10px !important', fontFamily: 'var(--font-sans)', fontSize: '13px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--t-accent-soft) !important', color: 'var(--t-fg) !important' },
  '.cm-completionDetail': { color: 'var(--t-fg-4)', fontStyle: 'normal', marginLeft: '8px' },
  '@media (max-width: 767px)': { '.cm-line': { padding: '0 16px' }, '&': { fontSize: '16px' } },
})

/** `@` → members, `#` → issues/tasks (via search). Inserts the stable id syntax. */
function refCompletions(users: () => Map<string, DirectoryUser>) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const m = ctx.matchBefore(/[@#][^\s@#[\]]*$/)
    if (!m || (m.from === m.to && !ctx.explicit)) return null
    const q = m.text.slice(1).toLowerCase()
    if (m.text.startsWith('@')) {
      const options = [...users().values()]
        .filter((u) => u.status === 'active' && u.name.toLowerCase().includes(q))
        .slice(0, 20)
        .map((u) => ({ label: `@${u.name}`, apply: `@[user:${u.id}] `, type: 'variable' }))
      return { from: m.from, options, filter: false }
    }
    if (!q) return null
    const r = await api<{ items: { type: string; id: string; title: string; subtitle?: string }[] }>(`/api/search?q=${encodeURIComponent(q)}`).catch(() => ({ items: [] }))
    const options = r.items
      .filter((h) => h.type === 'issue' || h.type === 'task')
      .map((h) => ({ label: `#${h.type === 'issue' ? h.id : h.title}`, detail: h.type === 'issue' ? h.title : h.subtitle, apply: `#[${h.type}:${h.id}] `, type: 'keyword' }))
    return { from: m.from, options, filter: false }
  }
}

export const Editor = forwardRef<EditorHandle, Props>(function Editor(p, ref) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const props = useRef(p)
  useEffect(() => {
    props.current = p
  })

  useEffect(() => {
    const undo = new Y.UndoManager(p.text)
    const ext: Extension[] = [
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(highlight),
      EditorView.lineWrapping,
      theme,
      marksField,
      cmPlaceholder(p.placeholder),
      keymap.of([...yUndoManagerKeymap, ...defaultKeymap, indentWithTab]),
      yCollab(p.text, p.awareness as never, { undoManager: undo }),
      autocompletion({ override: [refCompletions(() => props.current.users)], icons: false }),
      EditorState.readOnly.of(p.readOnly),
      EditorView.editable.of(!p.readOnly),
      EditorView.updateListener.of((u) => {
        if (!u.selectionSet && !u.focusChanged) return
        const s = u.state.selection.main
        props.current.onSelection(s.empty ? null : { from: s.from, to: s.to })
      }),
      EditorView.domEventHandlers({
        paste(e, v) {
          const files = [...(e.clipboardData?.files ?? [])]
          const text = e.clipboardData?.getData('text/plain').trim() ?? ''
          if (!files.length && /^https:\/\/(drive|docs)\.google\.com\/\S+$/.test(text)) {
            e.preventDefault()
            const s = v.state.selection.main
            const insert = `[${driveKind(text)}](${text})`
            v.dispatch({ changes: { from: s.from, to: s.to, insert }, selection: { anchor: s.from + insert.length } })
            props.current.onDriveUrl?.(text)
            return true
          }
          if (!files.length) return false
          e.preventDefault()
          props.current.onFiles(files, v.state.selection.main.head)
          return true
        },
        drop(e, v) {
          const files = [...(e.dataTransfer?.files ?? [])]
          if (!files.length) return false
          e.preventDefault()
          const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head
          props.current.onFiles(files, pos)
          return true
        },
      }),
    ]
    view.current = new EditorView({ parent: host.current!, state: EditorState.create({ doc: p.text.toString(), extensions: ext }) })
    return () => {
      view.current?.destroy()
      view.current = null
      undo.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.text, p.readOnly])

  // Comment highlights
  useEffect(() => {
    const v = view.current
    if (!v) return
    const len = v.state.doc.length
    const ranges = p.comments
      .filter((c) => c.to > c.from && c.to <= len)
      .sort((a, b) => a.from - b.from)
      .map((c) => Decoration.mark({ class: c.active ? 'cm-comment-mark active' : 'cm-comment-mark', attributes: { 'data-c': c.id } }).range(c.from, c.to))
    v.dispatch({ effects: setMarks.of(RangeSet.of(ranges, true)) })
  }, [p.comments])

  useImperativeHandle(ref, () => ({
    view: () => view.current,
    focus: () => view.current?.focus(),
    insert(text) {
      const v = view.current
      if (!v) return
      const s = v.state.selection.main
      v.dispatch({ changes: { from: s.from, to: s.to, insert: text }, selection: { anchor: s.from + text.length } })
      v.focus()
    },
    apply(kind) {
      const v = view.current
      if (!v) return
      const s = v.state.selection.main
      const sel = v.state.sliceDoc(s.from, s.to)
      const line = v.state.doc.lineAt(s.from)
      const wrap = (l: string, r: string, fallback: string) => {
        const inner = sel || fallback
        v.dispatch({ changes: { from: s.from, to: s.to, insert: l + inner + r }, selection: { anchor: s.from + l.length, head: s.from + l.length + inner.length } })
      }
      const prefix = (pre: string) => {
        const lines = []
        for (let n = line.number; n <= v.state.doc.lineAt(s.to).number; n++) lines.push(v.state.doc.line(n))
        v.dispatch({ changes: lines.map((l) => ({ from: l.from, insert: pre })) })
      }
      switch (kind) {
        case 'bold':
          wrap('**', '**', 'text')
          break
        case 'italic':
          wrap('_', '_', 'text')
          break
        case 'code':
          wrap('\n```\n', '\n```\n', 'code')
          break
        case 'link':
          wrap('[', '](https://)', 'link')
          break
        case 'h2':
          prefix('## ')
          break
        case 'list':
          prefix('- ')
          break
        case 'ordered':
          prefix('1. ')
          break
        case 'task':
          prefix('- [ ] ')
          break
        case 'table':
          v.dispatch({ changes: { from: line.to, insert: '\n\n|  |  |\n|---|---|\n|  |  |\n' } })
          break
        case 'addRow':
        case 'addCol':
          tableEdit(v, kind)
          break
      }
      v.focus()
    },
  }))

  return <div ref={host} className="h-full min-h-0" />
})

/** Adds a row below / a column right of the table row under the cursor. */
function tableEdit(v: EditorView, kind: 'addRow' | 'addCol') {
  const doc = v.state.doc
  const cur = doc.lineAt(v.state.selection.main.head)
  if (!cur.text.trim().startsWith('|')) return
  let first = cur.number
  let last = cur.number
  while (first > 1 && doc.line(first - 1).text.trim().startsWith('|')) first--
  while (last < doc.lines && doc.line(last + 1).text.trim().startsWith('|')) last++
  if (kind === 'addRow') {
    const cols = cur.text.split('|').length - 2
    v.dispatch({ changes: { from: cur.to, insert: '\n|' + '  |'.repeat(Math.max(cols, 1)) } })
    return
  }
  const changes = []
  for (let n = first; n <= last; n++) {
    const l = doc.line(n)
    const isSep = /^\s*\|[\s:-]+\|/.test(l.text) && !/[^\s|:-]/.test(l.text)
    changes.push({ from: l.to, insert: isSep ? '------|' : '  |' })
  }
  v.dispatch({ changes })
}
