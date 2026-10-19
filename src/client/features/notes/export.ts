import { api } from '../../lib/api'
import { renderMarkdown } from '../../lib/markdown'
import { makeZip } from '../../lib/zip'
import exportCss from './export.css?raw'

type FileRow = { id: string; name: string; mime: string; kind: 'image' | 'file' | 'drive'; driveUrl: string | null }
export type ExportStrings = { attachments: string; missing: string; source: string }
type Progress = (done: number, total: number) => void

const FILE_LINK = /(!?)\[([^\]]*)\]\(\/files\/([\w-]+)\)/g

/** Safe, readable file name: "2026-10-19_週會". */
export function exportName(title: string, startsAt: number) {
  const d = new Date(startsAt)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
  return `${day}_${title}`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120)
}

async function gather(noteId: string, locale: string) {
  // The markdown endpoint reads the live document, so unsynced edits are included.
  const md = await fetch(`/api/notes/${noteId}/markdown`, { headers: { 'x-locale': locale } }).then((r) => {
    if (!r.ok) throw new Error(String(r.status))
    return r.text()
  })
  const files = (await api<{ items: FileRow[] }>(`/api/files?parentType=note&parentId=${noteId}`)).items
  return { md, files }
}

async function fetchBytes(id: string) {
  const r = await fetch(`/files/${id}?download=1`)
  if (!r.ok) throw new Error(String(r.status))
  return new Uint8Array(await r.arrayBuffer())
}

function uniqueName(name: string, used: Set<string>) {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let n = name.replace(/[\\/:*?"<>|]/g, '_')
  for (let i = 2; used.has(n); i++) n = `${base}-${i}${ext}`
  used.add(n)
  return n
}

/** ZIP: note.md with relative image/attachment links + images/ + attachments/. */
export async function exportZip(noteId: string, base: string, locale: string, s: ExportStrings, onProgress: Progress) {
  const { md, files } = await gather(noteId, locale)
  const byId = new Map(files.map((f) => [f.id, f]))
  const referenced = [...new Set([...md.matchAll(FILE_LINK)].map((m) => m[3]!))]
  const stored = files.filter((f) => f.kind !== 'drive')
  const ids = [...new Set([...referenced, ...stored.map((f) => f.id)])]
  const used = new Set<string>()
  const path = new Map<string, string | null>()
  const entries: { name: string; data: Uint8Array }[] = []
  let done = 0
  for (const id of ids) {
    const f = byId.get(id)
    const folder = f?.mime.startsWith('image/') ? 'images' : 'attachments'
    try {
      const data = await fetchBytes(id)
      const name = `${folder}/${uniqueName(f?.name ?? id, used)}`
      entries.push({ name: `${base}/${name}`, data })
      path.set(id, name)
    } catch {
      path.set(id, null)
    }
    onProgress(++done, ids.length)
  }
  let body = md.replace(FILE_LINK, (all, bang: string, alt: string, id: string) => {
    const p = path.get(id)
    if (p) return `${bang}[${alt}](${encodeURI(p)})`
    return `${all} _（${s.missing}）_`
  })
  const list = [
    ...stored.filter((f) => path.get(f.id)).map((f) => `- [${f.name}](${encodeURI(path.get(f.id)!)})`),
    ...files.filter((f) => f.kind === 'drive').map((f) => `- [${f.name}](${f.driveUrl}) (Google Drive)`),
  ]
  if (list.length) body += `\n\n---\n\n## ${s.attachments}\n\n${list.join('\n')}\n`
  entries.unshift({ name: `${base}/${base}.md`, data: new TextEncoder().encode(body) })
  download(makeZip(entries), `${base}.zip`)
}

/** Single self-contained HTML: images inlined as data URIs, printable to PDF. */
export async function exportHtml(noteId: string, base: string, locale: string, title: string, s: ExportStrings, onProgress: Progress) {
  const { md, files } = await gather(noteId, locale)
  const byId = new Map(files.map((f) => [f.id, f]))
  const imageIds = [...new Set([...md.matchAll(FILE_LINK)].filter((m) => m[1] === '!').map((m) => m[3]!))]
  const inline = new Map<string, string>()
  let done = 0
  for (const id of imageIds) {
    try {
      const bytes = await fetchBytes(id)
      inline.set(id, `data:${byId.get(id)?.mime ?? 'image/png'};base64,${toBase64(bytes)}`)
    } catch {
      /* left as a link with a note */
    }
    onProgress(++done, imageIds.length)
  }
  const origin = location.origin
  const withImages = md.replace(FILE_LINK, (_all, bang: string, alt: string, id: string) => {
    if (bang && inline.has(id)) return `![${alt}](${inline.get(id)})`
    if (bang) return `[${alt}](${origin}/files/${id}) _（${s.missing}）_`
    return `[${alt}](${origin}/files/${id})`
  })
  const attachments = files
    .filter((f) => f.kind !== 'image')
    .map((f) => `<li><a href="${f.kind === 'drive' ? f.driveUrl : `${origin}/files/${f.id}`}">${escapeHtml(f.name)}</a></li>`)
    .join('')
  const html = `<!doctype html>
<html lang="${locale === 'zh' ? 'zh-Hant' : 'en'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${exportCss}</style>
</head>
<body>
<main>
${renderMarkdown(withImages)}
${attachments ? `<hr /><h2>${escapeHtml(s.attachments)}</h2><ul>${attachments}</ul>` : ''}
<footer>${escapeHtml(s.source)} · ${escapeHtml(origin)}/notes/${noteId}</footer>
</main>
</body>
</html>`
  download(new Blob([html], { type: 'text/html;charset=utf-8' }), `${base}.html`)
}

function toBase64(bytes: Uint8Array) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
}
