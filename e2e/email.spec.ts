import { expect, test } from '@playwright/test'
import { login, shot } from './helpers'

const KEYS: Record<string, string> = { 'desktop-light': 'EMAA', 'desktop-dark': 'EMAB', 'mobile-light': 'EMAC', 'mobile-dark': 'EMAD' }

test('email notifications: switch in settings, and a clear note when the site has no mail key', async ({ page }, info) => {
  await login(page, `em-${info.project.name}`, '林芷晴')
  await page.request.post('/api/projects', { data: { key: KEYS[info.project.name], name: '口試準備' } })
  // The dev server has no Resend key; pretend the site has one to see the switch.
  let mail = true
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch()
    await route.fulfill({ response: res, json: { ...(await res.json()), email: mail } })
  })

  await page.goto('/settings?tab=notifications')
  const box = page.getByRole('checkbox', { name: 'Email 通知' })
  await expect(box).toBeChecked()
  await expect(page.getByText(/10 分鐘內沒讀的通知，會合併成一封寄到 em-/)).toBeVisible()
  await shot(page, info, 'MS-57', 'settings')

  await box.uncheck()
  await expect.poll(async () => (await (await page.request.get('/api/me')).json()).user.prefs.emailOff).toBe(true)
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Email 通知' })).not.toBeChecked()

  mail = false
  await page.reload()
  await expect(page.getByText('站台尚未設定寄信服務，目前只有站內通知')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Email 通知' })).toHaveCount(0)
  await shot(page, info, 'MS-57', 'unavailable')
})
