import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import cpp from 'highlight.js/lib/languages/cpp'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import yaml from 'highlight.js/lib/languages/yaml'
import './highlight.css'

for (const [name, lang] of Object.entries({ bash, cpp, java, javascript, json, python, r, sql, typescript, yaml })) hljs.registerLanguage(name, lang)

const BY_EXT: Record<string, string> = {
  py: 'python', ipynb: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  c: 'cpp', cc: 'cpp', cpp: 'cpp', h: 'cpp', hpp: 'cpp', java: 'java', sh: 'bash', r: 'r', json: 'json', yml: 'yaml', yaml: 'yaml', sql: 'sql',
}

export function highlight(src: string, name: string) {
  const lang = BY_EXT[name.split('.').pop()?.toLowerCase() ?? '']
  return lang ? hljs.highlight(src, { language: lang }).value : hljs.highlightAuto(src).value
}

const ALIAS: Record<string, string> = { py: 'python', js: 'javascript', ts: 'typescript', sh: 'bash', shell: 'bash', yml: 'yaml', 'c++': 'cpp', c: 'cpp' }

/** Fenced-code highlighting for rendered Markdown (` ```python `). Unknown languages are auto-detected. */
export function highlightFence(src: string, lang: string | undefined) {
  const l = lang && (ALIAS[lang] ?? lang)
  return l && hljs.getLanguage(l) ? hljs.highlight(src, { language: l }).value : hljs.highlightAuto(src).value
}
