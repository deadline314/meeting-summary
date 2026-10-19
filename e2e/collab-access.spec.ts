import { expect, test } from '@playwright/test'
import { isMobile, login, newUserPage, shot } from './helpers'

const NAMES: Record<string, [string, string]> = {
  'desktop-light': ['方志遠', '高子晴'],
  'desktop-dark': ['孫立人', '白素貞'],
  'mobile-light': ['梁靜如', '夏宇辰'],
  'mobile-dark': ['秦海峰', '葉知秋'],
}

test('made an attendee while the note is open: the editor appears and edits reach everyone', async ({ page, browser }, info) => {
  test.setTimeout(120_000)
  const [ownerName, guestName] = NAMES[info.project.name]!
  const mobile = isMobile(info)
  await login(page, `ca-o-${info.project.name}`, ownerName)
  const guest = await newUserPage(browser, info, `ca-g-${info.project.name}`, guestName)
  const note = (await (await page.request.post('/api/notes', { data: { title: `權限同步 ${info.project.name}`, startsAt: Date.now() } })).json()).note as { id: string; version: number }
  await page.goto(`/notes/${note.id}${mobile ? '?mode=edit' : ''}`)
  await expect(page.locator('.cm-content')).toBeVisible()
  // The guest opens it read-only.
  await guest.page.goto(`/notes/${note.id}`)
  await expect(guest.page.getByText('唯讀：你不在出席名單中')).toBeVisible()
  await expect(guest.page.locator('.cm-content')).toHaveCount(0)
  // The owner adds the guest as an attendee; the guest's page turns editable without a reload.
  const patch = await page.request.patch(`/api/notes/${note.id}`, { data: { version: note.version, attendeeIds: [guest.user.id] } })
  expect(patch.ok()).toBe(true)
  await expect(guest.page.getByText('唯讀：你不在出席名單中')).toBeHidden({ timeout: 10_000 })
  if (mobile) await guest.page.goto(`/notes/${note.id}?mode=edit`)
  await guest.page.locator('.cm-content').click()
  await guest.page.keyboard.press('Control+Home')
  await guest.page.keyboard.type('加入後的第一句話。\n\n')
  // The owner sees it, and both documents are identical.
  await expect(page.locator('.cm-content')).toContainText('加入後的第一句話', { timeout: 5000 })
  await page.keyboard.press('Control+Home')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\n擁有者的回覆。')
  await expect(guest.page.locator('.cm-content')).toContainText('擁有者的回覆', { timeout: 5000 })
  const text = (p: typeof page) => p.locator('.cm-content').evaluate((el) => (el as HTMLElement).innerText)
  await expect.poll(async () => (await text(page)) === (await text(guest.page)), { timeout: 5000 }).toBe(true)
  await shot(guest.page, info, 'MS-52', 'synced')
  await guest.ctx.close()
})
