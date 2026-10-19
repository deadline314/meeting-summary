/**
 * Google Drive file picker (only the files the user picks: `drive.file` scope). Loaded on demand
 * from Google's script CDN; asks for consent the first time and silently afterwards.
 * Resolves with `null` when the user cancels or declines access — callers show guidance, not an error.
 */
export type PickerConfig = { apiKey: string; appId: string; clientId: string }
export type PickedFile = { name: string; mime: string; url: string; owner: string | null }

type Gapi = { load(name: string, cb: () => void): void }
type TokenResponse = { access_token?: string; error?: string }
type Google = {
  accounts: { oauth2: { initTokenClient(o: { client_id: string; scope: string; prompt?: string; callback(r: TokenResponse): void; error_callback?(e: unknown): void }): { requestAccessToken(o?: { prompt?: string }): void } } }
  picker: {
    PickerBuilder: new () => PickerBuilder
    DocsView: new () => { setIncludeFolders(v: boolean): unknown }
    Action: { PICKED: string; CANCEL: string }
    Feature: { MULTISELECT_ENABLED: string }
  }
}
type PickerBuilder = {
  addView(v: unknown): PickerBuilder
  setOAuthToken(t: string): PickerBuilder
  setDeveloperKey(k: string): PickerBuilder
  setAppId(id: string): PickerBuilder
  setLocale(l: string): PickerBuilder
  enableFeature(f: string): PickerBuilder
  setCallback(cb: (d: { action: string; docs?: { id: string; name: string; mimeType: string; url: string }[] }) => void): PickerBuilder
  build(): { setVisible(v: boolean): void }
}
declare global {
  interface Window {
    gapi?: Gapi
    google?: Google
  }
}

const SCOPE = 'https://www.googleapis.com/auth/drive.file'
let token: { value: string; expires: number } | null = null

function script(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`failed to load ${src}`))
    document.head.append(s)
  })
}

async function load() {
  await Promise.all([script('https://apis.google.com/js/api.js'), script('https://accounts.google.com/gsi/client')])
  await new Promise<void>((resolve) => window.gapi!.load('picker', resolve))
}

function accessToken(cfg: PickerConfig): Promise<string | null> {
  if (token && token.expires > Date.now() + 60_000) return Promise.resolve(token.value)
  return new Promise((resolve) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: SCOPE,
      callback: (r) => {
        if (!r.access_token) return resolve(null)
        token = { value: r.access_token, expires: Date.now() + 55 * 60_000 }
        resolve(r.access_token)
      },
      error_callback: () => resolve(null),
    })
    client.requestAccessToken({ prompt: token ? '' : undefined })
  })
}

async function ownerOf(id: string, t: string) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=owners(displayName),webViewLink`, { headers: { authorization: `Bearer ${t}` } }).catch(() => null)
  if (!r?.ok) return { owner: null, url: null }
  const j = (await r.json()) as { owners?: { displayName: string }[]; webViewLink?: string }
  return { owner: j.owners?.[0]?.displayName ?? null, url: j.webViewLink ?? null }
}

/** `undefined` = cancelled, `null` = access not granted (or revoked), otherwise the picked files. */
export async function pickDriveFiles(cfg: PickerConfig, locale: string): Promise<PickedFile[] | null | undefined> {
  await load()
  const t = await accessToken(cfg)
  if (!t) return null
  const g = window.google!.picker
  const docs = await new Promise<{ id: string; name: string; mimeType: string; url: string }[] | undefined>((resolve) => {
    new g.PickerBuilder()
      .addView(new g.DocsView().setIncludeFolders(false))
      .setOAuthToken(t)
      .setDeveloperKey(cfg.apiKey)
      .setAppId(cfg.appId)
      .setLocale(locale === 'zh' ? 'zh-TW' : 'en')
      .enableFeature(g.Feature.MULTISELECT_ENABLED)
      .setCallback((d) => {
        if (d.action === g.Action.PICKED) resolve(d.docs ?? [])
        else if (d.action === g.Action.CANCEL) resolve(undefined)
      })
      .build()
      .setVisible(true)
  })
  if (!docs) return undefined
  return Promise.all(
    docs.map(async (d) => {
      const extra = await ownerOf(d.id, t)
      return { name: d.name, mime: d.mimeType, url: extra.url ?? d.url, owner: extra.owner }
    }),
  )
}

/** Drop the cached token, e.g. after Google reports it revoked. */
export const forgetDriveToken = () => (token = null)
