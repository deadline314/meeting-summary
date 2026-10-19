// Parses a table off the main thread so opening a large file never freezes the page.
import { parseTable, profile, type Parsed, type Profile } from './parse'

export type WorkerResult = { ok: true; parsed: Parsed; profiles: Profile[][] } | { ok: false; error: string }

self.onmessage = async (e: MessageEvent<{ buf: ArrayBuffer; name: string }>) => {
  let out: WorkerResult
  try {
    const parsed = await parseTable(new Uint8Array(e.data.buf), e.data.name)
    out = { ok: true, parsed, profiles: parsed.sheets.map((s) => s.header.map((_, i) => profile(s.rows, i))) }
  } catch (err) {
    out = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  self.postMessage(out)
}
