import { expect, test } from '@playwright/test'
import { login, newUserPage, shot } from './helpers'

const CAST: Record<string, [string, string, string]> = {
  'desktop-light': ['NTAA', '游子豪', '高美華'],
  'desktop-dark': ['NTAB', '鄧宇翔', '韓欣怡'],
  'mobile-light': ['NTAC', '江柏宇', '石佳穎'],
  'mobile-dark': ['NTAD', '曹立偉', '方雅琪'],
}

test('notifications: merged updates, unread dot, subscribe toggle, preferences', async ({ page, browser }, info) => {
  test.setTimeout(120_000)
  const [key, aliceName, bobName] = CAST[info.project.name]!
  await login(page, `nt-a-${info.project.name}`, aliceName)
  const bob = await newUserPage(browser, info, `nt-b-${info.project.name}`, bobName)
  const r = page.request
  await r.post('/api/projects', { data: { key, name: '通知測試' } })
  await r.post('/api/projects', { data: { key: `NC${key.slice(2)}`, name: '已結案專案' } })
  await r.post(`/api/projects/NC${key.slice(2)}/members`, { data: { userId: bob.user.id, role: 'member' } })
  await r.post(`/api/projects/NC${key.slice(2)}/state`, { data: { action: 'close' } })
  await r.post(`/api/projects/${key}/members`, { data: { userId: bob.user.id, role: 'member' } })
  let i = (await (await r.post(`/api/projects/${key}/issues`, { data: { title: '整理口試簡報', assigneeIds: [bob.user.id] } })).json()).issue
  for (const s of ['in_progress', 'in_review']) i = (await (await r.patch(`/api/issues/${i.ref}`, { data: { version: i.version, status: s } })).json()).issue
  await r.post(`/api/projects/${key}/issues`, { data: { title: '沒有通知的票' } })

  // Bob: one merged notice, a dot on the issue in the list.
  await bob.page.goto('/')
  await bob.page.getByRole('button', { name: '通知' }).first().click()
  await expect(bob.page.getByText(/有 3 項更新/)).toBeVisible()
  await shot(bob.page, info, 'MS-41', 'merged')
  await bob.page.keyboard.press('Escape')
  await bob.page.goto(`/projects/${key}`)
  const row = bob.page.locator('li', { hasText: '整理口試簡報' })
  await expect(row.getByRole('img', { name: '有未讀通知' })).toBeVisible()
  await expect(bob.page.locator('li', { hasText: '沒有通知的票' }).getByRole('img', { name: '有未讀通知' })).toHaveCount(0)
  await shot(bob.page, info, 'MS-41', 'unread-dot')

  // Opening the issue reads it; the bell offers unsubscribe.
  await row.getByText('整理口試簡報').click()
  await expect(bob.page.getByRole('button', { name: '取消訂閱' })).toBeVisible()
  await bob.page.goto(`/projects/${key}`)
  await expect(bob.page.locator('li', { hasText: '整理口試簡報' }).getByRole('img', { name: '有未讀通知' })).toHaveCount(0)

  // Preferences matrix: active and closed sections, all/none.
  await bob.page.goto('/settings?tab=notifications')
  await expect(bob.page.getByText('已結案的專案')).toBeVisible()
  await bob.page.getByLabel(`${key} 狀態變更`).uncheck()
  await expect(bob.page.getByLabel(`${key} 狀態變更`)).not.toBeChecked()
  await shot(bob.page, info, 'MS-41', 'prefs')
  i = (await (await r.get(`/api/issues/${i.ref}`)).json()).issue
  await r.patch(`/api/issues/${i.ref}`, { data: { version: i.version, status: 'done' } })
  await bob.page.waitForTimeout(300)
  const n = await (await bob.page.request.get('/api/notifications')).json()
  expect(n.unread).toBe(0)
  await bob.ctx.close()
})
