import { expect, test } from '@playwright/test'
import { email, shot } from './helpers'

const NAMES: Record<string, string> = { 'desktop-light': '新生甲', 'desktop-dark': '新生乙', 'mobile-light': '新生丙', 'mobile-dark': '新生丁' }

test('first visit shows each module tour once; ? replays it', async ({ page }, info) => {
  await page.request.post('/auth/dev', { data: { email: email(`tour-${info.project.name}`), name: NAMES[info.project.name] } })
  await page.request.patch('/api/me', { data: { onboarded: true } })
  await page.request.post('/api/projects', { data: { key: `TR${info.project.name.startsWith('desk') ? 'D' : 'M'}${info.project.name.endsWith('light') ? 'L' : 'K'}`, name: '新手專案' } })
  await page.goto('/projects')
  const tour = page.getByRole('dialog', { name: '私人與共享' })
  await expect(tour).toBeVisible()
  await shot(page, info, 'MS-10', 'tour')
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: '下一步' }).click()
  await expect(page.getByRole('dialog', { name: '快捷鍵說明' })).toBeVisible()
  await page.getByRole('button', { name: '開始使用' }).click()
  await expect(page.getByRole('dialog', { name: /快捷鍵說明|私人與共享/ })).toHaveCount(0)
  // Seen: a reload does not show it again.
  await page.reload()
  await page.waitForTimeout(1000)
  await expect(page.getByRole('dialog', { name: '私人與共享' })).toHaveCount(0)
  // Other modules have their own first-visit tour; skipping counts as seen.
  await page.goto('/notes')
  await expect(page.getByRole('dialog', { name: '會議紀錄一起寫' })).toBeVisible()
  await page.getByRole('button', { name: '略過' }).click()
  // Replay from the shortcut help (desktop; phones have no keyboard shortcuts).
  if (!info.project.name.startsWith('mobile')) {
    await page.keyboard.press('?')
    await page.getByRole('button', { name: '會議紀錄', exact: true }).last().click()
    await expect(page.getByRole('dialog', { name: '會議紀錄一起寫' })).toBeVisible()
    await page.keyboard.press('Escape')
  }
  const me = (await (await page.request.get('/api/me')).json()).user
  expect(me.prefs.toursSeen.sort()).toEqual(['notes', 'projects'])
})
