const enc = new TextEncoder()

export const newId = () => crypto.randomUUID()

export function randomToken(bytes = 32) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes))
  return base64url(buf)
}

export function base64url(buf: Uint8Array) {
  let s = ''
  for (const b of buf) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sha256(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return base64url(new Uint8Array(digest))
}

/** Constant-time string compare for secrets. */
export function safeEqual(a: string, b: string) {
  const x = enc.encode(a)
  const y = enc.encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!
  return diff === 0
}
