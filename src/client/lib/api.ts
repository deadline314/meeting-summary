import { QueryClient } from '@tanstack/react-query'
import type { ApiErrorBody, ErrorCode } from '@shared/errors'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'network',
    message: string,
    readonly requestId?: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message)
  }
}

type Opts = { method?: string; body?: unknown; signal?: AbortSignal; raw?: BodyInit; headers?: Record<string, string> }

const RETRYABLE = new Set([502, 503, 504])

/** JSON fetch with unified errors. Idempotent requests retry with backoff on network/5xx gateway failures. */
export async function api<T>(path: string, o: Opts = {}): Promise<T> {
  const method = o.method ?? 'GET'
  // Writes carrying an operationId are de-duplicated by the server, so they may retry too.
  const idempotent = method === 'GET' || method === 'PUT' || method === 'DELETE' || !!(o.body && typeof o.body === 'object' && 'operationId' in o.body)
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(path, {
        method,
        signal: o.signal,
        credentials: 'same-origin',
        headers: o.raw ? o.headers : { 'content-type': 'application/json', ...o.headers },
        body: o.raw ?? (o.body === undefined ? undefined : JSON.stringify(o.body)),
      })
    } catch (err) {
      if (o.signal?.aborted) throw err
      if (idempotent && attempt < 3) {
        await sleep(300 * 2 ** attempt)
        continue
      }
      throw new ApiError(0, 'network', 'Network error')
    }
    if (RETRYABLE.has(res.status) && idempotent && attempt < 3) {
      await sleep(300 * 2 ** attempt)
      continue
    }
    if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T
    let body: ApiErrorBody | null = null
    try {
      body = (await res.json()) as ApiErrorBody
    } catch {
      /* not json */
    }
    const e = body?.error
    throw new ApiError(res.status, e?.code ?? 'internal', e?.message ?? res.statusText, e?.requestId, e?.params)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (n, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && n < 2,
      refetchOnWindowFocus: true,
    },
  },
})
