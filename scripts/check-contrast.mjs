// WCAG contrast check for the theme tokens: every text/background pair the UI uses must reach
// 4.5:1 (normal text) in light and dark, for all five accent colours. Runs in `npm run lint`.
import { readFileSync } from 'node:fs'

const css = readFileSync('src/client/styles.css', 'utf8')
const ACCENTS = { indigo: [268, 0.19], emerald: [160, 0.14], amber: [62, 0.15], rose: [12, 0.19], slate: [250, 0.04] }

/** Token declarations of the first block whose selector matches. */
function block(selector) {
  const i = css.indexOf(selector)
  if (i < 0) throw new Error(`missing ${selector}`)
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i))
  return Object.fromEntries([...body.matchAll(/--(t-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}
const light = block(':root {\n  --h:')
const accentLight = block("[data-accent] {")
const dark = block("[data-mode='dark'] {")
const accentDark = block("[data-mode='dark'][data-accent],")

function rgb(value, h, c) {
  const m = /oklch\(\s*([\d.]+)\s+(calc\([^)]*\)|[\w.()-]+)\s+(var\(--h\)|[\d.]+)/.exec(value)
  if (!m) return null
  const chroma = m[2] === 'var(--c)' ? c : m[2].startsWith('calc(') ? c * Number(/\*\s*([\d.]+)/.exec(m[2])[1]) : Number(m[2])
  const hue = m[3] === 'var(--h)' ? h : Number(m[3])
  const L = Number(m[1])
  const a = chroma * Math.cos((hue * Math.PI) / 180)
  const b = chroma * Math.sin((hue * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (x) => Math.min(1, Math.max(0, x))
  return [clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s), clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s), clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s)]
}
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const ratio = (x, y) => {
  const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p)
  return (a + 0.05) / (b + 0.05)
}

// [text, background] pairs as they appear in the UI.
const PAIRS = [
  ['fg', 'canvas'], ['fg', 'surface'], ['fg-2', 'surface'], ['fg-2', 'surface-2'], ['fg-3', 'surface'], ['fg-3', 'canvas'], ['fg-3', 'surface-2'], ['fg-4', 'surface'], ['fg-4', 'canvas'], ['fg-4', 'surface-2'], ['accent-text', 'canvas'],
  ['accent-text', 'surface'], ['accent-text', 'accent-soft'], ['accent-fg', 'accent'],
  ['success', 'success-soft'], ['warning', 'warning-soft'], ['danger', 'danger-soft'], ['info', 'info-soft'],
  ['danger', 'surface'], ['warning', 'surface'], ['success', 'surface'], ['on-status', 'danger'], ['on-status', 'warning'],
  ...Array.from({ length: 8 }, (_, i) => [`label-${i + 1}-fg`, `label-${i + 1}-bg`]),
]

const failures = []
for (const [mode, base, accent] of [['light', light, accentLight], ['dark', { ...light, ...dark }, accentDark]]) {
  for (const [name, [h, c]] of Object.entries(ACCENTS)) {
    const t = { ...base, ...accent }
    for (const [fgKey, bgKey] of PAIRS) {
      const fg = rgb(t[`t-${fgKey}`] ?? '', h, c)
      const bg = rgb(t[`t-${bgKey}`] ?? '', h, c)
      if (!fg || !bg) continue
      const r = ratio(fg, bg)
      if (r < 4.5) failures.push(`${mode}/${name}: ${fgKey} on ${bgKey} = ${r.toFixed(2)}`)
    }
  }
}
if (failures.length) {
  console.error(`check-contrast: ${failures.length} pair(s) below 4.5:1\n  ` + failures.join('\n  '))
  process.exit(1)
}
console.log(`check-contrast: ${PAIRS.length} pairs × 2 modes × 5 accents ≥ 4.5:1`)
