import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import { api } from '../../lib/api'
import { useMe } from '../../lib/session'
import { authorColor } from '../../ui/avatar'

export type Peer = { clientId: number; id: string; name: string; color: string }
export type Collab = {
  doc: Y.Doc
  text: Y.Text
  provider: WebsocketProvider
}

// One Y.Doc + connection per note, shared and ref-counted so React StrictMode's
// mount → unmount → mount (and quick back/forward navigation) don't drop the socket.
const rooms = new Map<string, { c: Collab; refs: number; timer?: ReturnType<typeof setTimeout> }>()

function room(noteId: string) {
  let r = rooms.get(noteId)
  if (!r) {
    const doc = new Y.Doc()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const provider = new WebsocketProvider(`${proto}://${location.host}/ws/doc`, noteId, doc, { maxBackoffTime: 5000 })
    r = { c: { doc, text: doc.getText('content'), provider }, refs: 0 }
    rooms.set(noteId, r)
  }
  return r
}

export function useCollab(noteId: string): Collab {
  const me = useMe()
  const c = room(noteId).c
  useEffect(() => {
    const r = room(noteId)
    clearTimeout(r.timer)
    r.refs++
    return () => {
      r.refs--
      if (r.refs === 0)
        r.timer = setTimeout(() => {
          r.c.provider.destroy()
          r.c.doc.destroy()
          rooms.delete(noteId)
        }, 1500)
    }
  }, [noteId])
  useEffect(() => {
    c.provider.awareness.setLocalStateField('user', { id: me.id, name: me.name, color: authorColor(me.id) })
  }, [c, me.id, me.name])
  return c
}

export type Status = 'connecting' | 'connected' | 'disconnected'

export function useStatus(p: WebsocketProvider) {
  const [status, setStatus] = useState<Status>('connecting')
  const [synced, setSynced] = useState(false)
  useEffect(() => {
    const onStatus = (e: { status: Status }) => setStatus(e.status)
    const onSync = (s: boolean) => setSynced(s)
    p.on('status', onStatus)
    p.on('sync', onSync)
    return () => {
      p.off('status', onStatus)
      p.off('sync', onSync)
    }
  }, [p])
  return { status, synced }
}

export function usePeers(p: WebsocketProvider): Peer[] {
  const aw = p.awareness
  const snapshot = useSyncExternalStore(
    (cb) => {
      aw.on('change', cb)
      return () => aw.off('change', cb)
    },
    () => {
      const ids: string[] = []
      aw.getStates().forEach((s, k) => s.user && ids.push(`${k}:${s.user.id}:${s.user.name}`))
      return ids.sort().join('|')
    },
  )
  return useMemo(() => {
    const seen = new Set<string>()
    const out: Peer[] = []
    aw.getStates().forEach((s, clientId) => {
      const u = s.user as { id: string; name: string; color: string } | undefined
      if (!u || seen.has(u.id)) return
      seen.add(u.id)
      out.push({ clientId, ...u })
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot])
}

/** Re-renders (throttled) whenever the shared text changes; returns the current string. */
export function useText(text: Y.Text, ms = 120) {
  const [v, setV] = useState(() => text.toString())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const on = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        setV(text.toString())
      }, ms)
    }
    text.observe(on)
    on()
    return () => {
      text.unobserve(on)
      if (timer) clearTimeout(timer)
    }
  }, [text, ms])
  return v
}

export type ClientInfo = Record<string, { userId: string; lastAt: number }>

export function useAuthorsMap(noteId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['note-authors', noteId],
    queryFn: async () => (await api<{ clients: ClientInfo }>(`/api/notes/${noteId}/authors`)).clients,
    enabled,
    refetchInterval: enabled ? 15_000 : false,
  })
}

export type Run = { start: number; end: number; client: number }

/** Character runs of the live text with the Yjs client that inserted them. */
export function authorRuns(text: Y.Text): Run[] {
  const runs: Run[] = []
  let pos = 0
  // Walk Yjs' internal item list; only countable, non-deleted string content takes space.
  let item = (text as unknown as { _start: YItem | null })._start
  while (item) {
    if (!item.deleted && item.countable) {
      const len = item.length
      const last = runs[runs.length - 1]
      if (last && last.client === item.id.client && last.end === pos) last.end += len
      else runs.push({ start: pos, end: pos + len, client: item.id.client })
      pos += len
    }
    item = item.right
  }
  return runs
}

type YItem = { deleted: boolean; countable: boolean; length: number; id: { client: number }; right: YItem | null }

/** Who wrote [from, to): user ids by share, plus the latest edit time of the clients involved. */
export function authorsIn(runs: Run[], info: ClientInfo | undefined, from: number, to: number) {
  const chars = new Map<string, number>()
  let lastAt = 0
  for (const r of runs) {
    if (r.end <= from || r.start >= to) continue
    const n = Math.min(r.end, to) - Math.max(r.start, from)
    const ci = info?.[String(r.client)]
    const uid = ci?.userId ?? (r.client === 1 ? 'system' : 'unknown')
    chars.set(uid, (chars.get(uid) ?? 0) + n)
    if (ci && ci.lastAt > lastAt) lastAt = ci.lastAt
  }
  chars.delete('system')
  const ids = [...chars.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  return { ids, lastAt }
}

export const relPosToB64 = (p: Y.RelativePosition) => btoa(String.fromCharCode(...Y.encodeRelativePosition(p)))
export const b64ToAbs = (doc: Y.Doc, b64: string) => {
  try {
    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
    return Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(bin), doc)?.index ?? null
  } catch {
    return null
  }
}
