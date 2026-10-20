import { env, runInDurableObject } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMAIL_DELAY, sendDigests } from '../src/worker/services/email'
import { login, projectKey, uniq } from './helpers'

type Mail = { from: string; to: string[]; subject: string; html: string; text: string }
const wait = () => new Promise((r) => setTimeout(r, 50))
const later = () => Date.now() + EMAIL_DELAY + 1000

/** Captures what would go to Resend; `fail` makes the next call answer 500. */
function resend(fail = false) {
  const sent: Mail[] = []
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    expect(String(url)).toBe('https://api.resend.com/emails/batch')
    if (fail) return new Response('down', { status: 500 })
    sent.push(...(JSON.parse(String(init?.body)) as Mail[]))
    return Response.json({ data: [] })
  })
  return { sent, spy, to: (email: string) => sent.filter((m) => m.to.includes(email)) }
}

async function team() {
  const a = await login(uniq('ea'))
  const bEmail = uniq('eb')
  const b = await login(bEmail)
  const bId = (await b.call<{ user: { id: string } }>('/api/me')).body.user.id
  const k = projectKey('E')
  await a.call('/api/projects', { method: 'POST', body: { key: k, name: 'mail' } })
  await a.call(`/api/projects/${k}/members`, { method: 'POST', body: { userId: bId, role: 'member' } })
  const assign = async (title: string) => (await a.call<{ issue: { ref: string; id: string } }>(`/api/projects/${k}/issues`, { method: 'POST', body: { title, assigneeIds: [bId] } })).body.issue
  return { a, b, bEmail, assign }
}

afterEach(() => vi.restoreAllMocks())

describe('email digests', () => {
  it('mails notices left unread for the delay once, merged per person, and again after new activity', async () => {
    const { a, bEmail, assign } = await team()
    const one = await assign('first task')
    const two = await assign('second task')
    await wait()

    // Not due yet: nothing goes out, and the next run is scheduled for when it is.
    let r = resend()
    const next = await sendDigests(env, Date.now())
    expect(r.to(bEmail)).toHaveLength(0)
    expect(next).toBeGreaterThan(Date.now())
    expect(next).toBeLessThanOrEqual(Date.now() + EMAIL_DELAY)

    r = resend()
    await sendDigests(env, later())
    const [mail, ...rest] = r.to(bEmail)
    expect(rest).toHaveLength(0)
    expect(mail!.subject).toContain('2')
    expect(mail!.html).toContain(`/projects/${one.ref.split('-')[0]}/${one.ref}`)
    expect(mail!.html).toContain(two.ref)
    expect(mail!.text).toContain('second task')
    expect(mail!.from).toContain(`<${env.EMAIL_FROM}>`)

    // Already mailed: not sent twice.
    r = resend()
    await sendDigests(env, later())
    expect(r.to(bEmail)).toHaveLength(0)

    // New activity on the same issue merges into the notice and makes it due again.
    await a.call(`/api/issues/${one.ref}/comments`, { method: 'POST', body: { body: 'ping' } })
    await wait()
    r = resend()
    await sendDigests(env, later())
    expect(r.to(bEmail)).toHaveLength(1)
    expect(r.to(bEmail)[0]!.text).toContain(one.ref)
  })

  it('skips notices read in the app and people who switched email off; follows their language', async () => {
    const { b, bEmail, assign } = await team()
    const read = await assign('read in app')
    await wait()
    await b.call('/api/notifications/read', { method: 'POST', body: { entityId: read.id } })
    let r = resend()
    await sendDigests(env, later())
    expect(r.to(bEmail)).toHaveLength(0)

    await b.call('/api/me', { method: 'PATCH', body: { prefs: { locale: 'en' } } })
    await assign('english please')
    await wait()
    r = resend()
    await sendDigests(env, later())
    expect(r.to(bEmail)[0]!.subject).toContain('1 unread notifications')

    await b.call('/api/me', { method: 'PATCH', body: { prefs: { emailOff: true } } })
    await assign('no mail')
    await wait()
    r = resend()
    await sendDigests(env, later())
    expect(r.to(bEmail)).toHaveLength(0)
    // The in-app notice is still there.
    expect((await b.call<{ unread: number }>('/api/notifications')).body.unread).toBeGreaterThan(0)
  })

  it('keeps notices for a retry when Resend fails, and notifying schedules the outbox alarm', async () => {
    const { bEmail, assign } = await team()
    await assign('flaky mail')
    await wait()
    const now = later()
    resend(true)
    const next = await sendDigests(env, now)
    expect(next).toBeLessThanOrEqual(now + 15 * 60_000)
    vi.restoreAllMocks()
    const r = resend()
    await sendDigests(env, now + 1000)
    expect(r.to(bEmail)).toHaveLength(1)

    const alarm = await runInDurableObject(env.OUTBOX.get(env.OUTBOX.idFromName('outbox')), (_o, state) => state.storage.getAlarm())
    expect(alarm).not.toBeNull()
  })

  it('reports whether email is available to the settings page', async () => {
    const { b } = await team()
    expect((await b.call<{ email: boolean }>('/api/config')).body.email).toBe(true)
  })
})
