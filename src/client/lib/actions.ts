import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import type { MsgKey } from './i18n'

/**
 * Single action registry. Shortcuts, the command palette, the shortcut help and
 * tooltip key badges all read from here, so they can never disagree.
 */
export type Action = {
  id: string
  label: MsgKey
  /** e.g. "c", "mod+k", "g b", "shift+/" */
  keys?: string
  icon?: ReactNode
  group?: MsgKey
  /** Scope the action belongs to; only actions of the top scope (and "global") fire. */
  scope?: string
  /** Hidden from the palette (still fires by key). */
  hidden?: boolean
  run(): void
}

const registry = new Map<string, Action>()
const scopeStack: string[] = ['page']
let version = 0
const listeners = new Set<() => void>()
const emit = () => {
  version++
  listeners.forEach((l) => l())
}

export function useActionsVersion() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version,
  )
}

export const allActions = () => [...registry.values()]

/** Register actions for the lifetime of the calling component. */
export function useActions(actions: Action[]) {
  const ref = useRef(actions)
  useLayoutEffect(() => {
    ref.current = actions
  })
  const ids = actions.map((a) => a.id).join('|')
  useEffect(() => {
    for (const a of ref.current) registry.set(a.id, { ...a, run: () => ref.current.find((x) => x.id === a.id)?.run() })
    emit()
    return () => {
      for (const id of ids.split('|')) registry.delete(id)
      emit()
    }
  }, [ids])
}

/** Push a shortcut scope while mounted (dialogs): keys of lower scopes stop firing. */
export function useScope(scope: string, active = true) {
  useEffect(() => {
    if (!active) return
    scopeStack.push(scope)
    return () => {
      const i = scopeStack.lastIndexOf(scope)
      if (i >= 0) scopeStack.splice(i, 1)
    }
  }, [scope, active])
}

const topScope = () => scopeStack[scopeStack.length - 1]

function isTyping(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}

function chordOf(e: KeyboardEvent) {
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('mod')
  if (e.altKey) parts.push('alt')
  let k = e.key.toLowerCase()
  if (k === '?') k = 'shift+/'
  else if (e.shiftKey && k.length > 1) parts.push('shift')
  else if (e.shiftKey && /^[a-z]$/.test(k)) parts.push('shift')
  parts.push(k === ' ' ? 'space' : k)
  return parts.join('+').replace('shift+shift+', 'shift+')
}

let pendingPrefix: string | null = null
let prefixTimer: ReturnType<typeof setTimeout> | undefined

export function installKeyboard() {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return
    const chord = chordOf(e)
    const typing = isTyping(e.target)
    const scope = topScope()
    const candidates = allActions().filter((a) => a.keys && ((a.scope ?? 'page') === scope || a.scope === 'global'))
    const seq = pendingPrefix ? `${pendingPrefix} ${chord}` : chord
    const match = candidates.find((a) => a.keys === seq)
    if (match) {
      const single = !match.keys!.includes('mod+')
      if (typing && single) return
      e.preventDefault()
      pendingPrefix = null
      match.run()
      return
    }
    if (!typing && candidates.some((a) => a.keys?.startsWith(chord + ' '))) {
      pendingPrefix = chord
      clearTimeout(prefixTimer)
      prefixTimer = setTimeout(() => (pendingPrefix = null), 1000)
      return
    }
    pendingPrefix = null
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
