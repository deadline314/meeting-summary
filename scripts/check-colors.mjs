// Fails when a colour literal or a Tailwind palette class appears outside the token file.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

const ROOT = 'src/client'
// Token file, and the stylesheet of exported standalone HTML (a separate document, not app UI).
const ALLOW = new Set(['src/client/styles.css', 'src/client/features/notes/export.css'])
const LITERAL = /#[0-9a-fA-F]{3,8}\b(?![\w-])|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\(/
const PALETTE = /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|shadow)-(?:red|blue|green|yellow|gray|slate|zinc|neutral|stone|orange|amber|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose|black)-\d{2,3}\b/

const files = []
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f).split(sep).join('/')
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(tsx?|css)$/.test(p) && !ALLOW.has(p)) files.push(p)
  }
}
walk(ROOT)

const bad = []
for (const f of files) {
  readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return
      if (LITERAL.test(line) || PALETTE.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`)
    })
}
if (bad.length) {
  console.error('Hard-coded colours found (use semantic tokens from styles.css):\n' + bad.join('\n'))
  process.exit(1)
}
console.log(`check-colors: ${files.length} files clean`)
