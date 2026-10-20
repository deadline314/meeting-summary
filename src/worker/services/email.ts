import { and, gt, inArray, isNull } from 'drizzle-orm'
import { en } from '../../client/lib/i18n/en'
import { zh } from '../../client/lib/i18n/zh'
import { getDb } from '../db'
import { notifications, users } from '../db/schema'
import { errorFields, log } from '../lib/log'
import { readSettings } from './site'

/** A notice unread this long goes out by email; reading it in the app first cancels the email. */
export const EMAIL_DELAY = 10 * 60_000
/** Older notices are never mailed, so switching email on does not flush the backlog. */
const MAX_AGE = 24 * 60 * 60_000
const RETRY_MS = 15 * 60_000
/** Resend's batch endpoint takes at most 100 messages. */
const BATCH = 100

export const emailEnabled = (env: Env) => !!(env.RESEND_API_KEY && env.EMAIL_FROM)

type Notice = typeof notifications.$inferSelect
type Dict = Record<keyof typeof zh, string>

const translator = (locale: string | undefined) => {
  const dict: Dict = locale === 'en' ? en : zh
  return (key: string, params?: Record<string, string>) =>
    (dict[key as keyof Dict] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => params?.[k] ?? `{${k}}`)
}

function href(n: Notice) {
  const ref = String(n.data.ref ?? '')
  if (n.entityType === 'issue' && ref) return `/projects/${ref.split('-')[0]}/${ref}`
  if (n.entityType === 'note') return `/notes/${n.entityId}?tab=comments`
  if (n.entityType === 'task') return `/tasks/${n.entityId}?tab=submit`
  if (n.entityType === 'site') return '/admin?tab=usage'
  return '/'
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** One email listing a person's unread notices, in their interface language. */
export function digest(o: { locale?: string; siteName: string; origin: string; items: Notice[]; names: Map<string, string> }) {
  const t = translator(o.locale)
  const site = o.siteName || t('app.name')
  const lines = o.items.map((n) => {
    const d = n.data as Record<string, string>
    const text = t(Number(d.count) > 1 ? 'notice.merged' : `notice.${n.type}`, {
      n: String(d.count ?? ''),
      actor: n.actorId ? (o.names.get(n.actorId) ?? '') : site,
      ref: d.ref ?? '',
      title: d.title ?? '',
      to: d.to ? t(`status.${d.to}`) : '',
      status: d.status ? t(`submission.${d.status}`) : '',
      metric: d.metric ? t(`usage.${d.metric}`) : '',
      pct: String(d.pct ?? ''),
    })
    return { text, url: o.origin + href(n) }
  })
  const n = String(lines.length)
  const settings = `${o.origin}/settings?tab=notifications`
  return {
    subject: t('email.subject', { site, n }),
    html: [
      `<p>${esc(t('email.intro', { n }))}</p>`,
      `<ul>${lines.map((l) => `<li style="margin:0 0 8px"><a href="${esc(l.url)}">${esc(l.text)}</a></li>`).join('')}</ul>`,
      `<p style="font-size:12px"><a href="${esc(settings)}">${esc(t('email.manage'))}</a></p>`,
    ].join(''),
    text: [t('email.intro', { n }), '', ...lines.map((l) => `- ${l.text}\n  ${l.url}`), '', `${t('email.manage')}: ${settings}`].join('\n'),
  }
}

async function chunked<T>(list: T[], size: number, run: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < list.length; i += size) await run(list.slice(i, i + size))
}

/**
 * Email every person their notices that have stayed unread for EMAIL_DELAY, one message each.
 * Returns when to run next (the earliest notice not yet due), or null when nothing is waiting.
 */
export async function sendDigests(env: Env, now = Date.now()): Promise<number | null> {
  if (!emailEnabled(env)) return null
  const db = getDb(env.DB)
  const pending = await db
    .select()
    .from(notifications)
    .where(and(isNull(notifications.emailAt), isNull(notifications.readAt), gt(notifications.createdAt, now - MAX_AGE)))
    .all()
  const waiting = pending.filter((n) => n.createdAt > now - EMAIL_DELAY)
  let next = waiting.length ? Math.min(...waiting.map((n) => n.createdAt)) + EMAIL_DELAY : null
  const due = pending.filter((n) => n.createdAt <= now - EMAIL_DELAY)
  if (!due.length) return next

  // ponytail: whole user table (a lab is tens of people); select by id when it grows past a few thousand.
  const people = new Map((await db.select({ id: users.id, name: users.name, email: users.email, prefs: users.prefs }).from(users).all()).map((u) => [u.id, u]))
  const names = new Map([...people].map(([id, u]) => [id, u.name]))
  const site = (await readSettings({ db })).site
  const origin = env.SITE_URL ?? ''
  const from = `"${(site.name || zh['app.name']).replace(/["<>]/g, '')}" <${env.EMAIL_FROM}>`

  const byUser = new Map<string, Notice[]>()
  for (const n of due) byUser.set(n.userId, [...(byUser.get(n.userId) ?? []), n])
  const messages: { ids: string[]; body: Record<string, unknown> }[] = []
  const skipped: string[] = []
  for (const [userId, items] of byUser) {
    const u = people.get(userId)
    if (!u?.email || u.prefs.emailOff) {
      skipped.push(...items.map((n) => n.id))
      continue
    }
    items.sort((a, b) => b.createdAt - a.createdAt)
    messages.push({ ids: items.map((n) => n.id), body: { from, to: [u.email], ...digest({ locale: u.prefs.locale, siteName: site.name, origin, items, names }) } })
  }

  const done = [...skipped]
  await chunked(messages, BATCH, async (part) => {
    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(part.map((m) => m.body)),
      })
      if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 300)}`)
      done.push(...part.flatMap((m) => m.ids))
    } catch (err) {
      // Left unmarked, so the next run tries again (until MAX_AGE).
      log('warn', 'email digest failed', { count: part.length, ...errorFields(err) })
      next = Math.min(next ?? Infinity, now + RETRY_MS)
    }
  })
  // D1 allows 100 bound parameters per statement.
  await chunked(done, 90, (ids) => db.update(notifications).set({ emailAt: now }).where(inArray(notifications.id, ids)))
  return next
}
