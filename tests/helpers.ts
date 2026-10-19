import { SELF } from 'cloudflare:test'

const BASE = 'http://localhost'

/** Signs in through the local dev login and returns a fetch bound to that session. */
export async function login(email: string, name = email.split('@')[0]!) {
  const res = await SELF.fetch(`${BASE}/auth/dev`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, name }),
  })
  if (!res.ok) throw new Error(`login failed ${res.status}`)
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const call = async <T = unknown>(path: string, init: { method?: string; body?: unknown } = {}) => {
    const r = await SELF.fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: { cookie, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const text = await r.text()
    return { status: r.status, body: (text ? JSON.parse(text) : null) as T }
  }
  return { cookie, call }
}

export const uniq = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}@example.com`
