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
  // (Typed at the top: the editor only renders lines in view.)
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+Home')
  await page.keyboard.type('擁有者的回覆。\n')
  await expect(guest.page.locator('.cm-content')).toContainText('擁有者的回覆', { timeout: 5000 })
  // Both screens show the same opening lines in the same order.
  // Line text without the other person's cursor label.
  const head = (p: typeof page) =>
    p.locator('.cm-line').evaluateAll((ls) =>
      ls
        .slice(0, 4)
        .map((l) => {
          const c = l.cloneNode(true) as HTMLElement
          c.querySelectorAll('.cm-ySelectionCaret, .cm-ySelectionInfo').forEach((x) => x.remove())
          return c.textContent
        })
        .join('\n'),
    )
  await expect.poll(async () => (await head(page)) === (await head(guest.page)), { timeout: 5000 }).toBe(true)
  expect(await head(guest.page)).toMatch(/^擁有者的回覆。\n加入後的第一句話。/)
  await shot(guest.page, info, 'MS-52', 'synced')
  await guest.ctx.close()
})

test('jump to where a collaborator is editing', async ({ page, browser }, info) => {
  test.skip(isMobile(info), 'the online list sits in the desktop header')
  test.setTimeout(120_000)
  const [ownerName, guestName] = NAMES[info.project.name]!
  await login(page, `jp-o-${info.project.name}`, `${ownerName}跳`)
  const guest = await newUserPage(browser, info, `jp-g-${info.project.name}`, `${guestName}跳`)
  const note = (await (await page.request.post('/api/notes', { data: { title: `跳到協作者 ${info.project.name}`, startsAt: Date.now(), attendeeIds: [guest.user.id] } })).json()).note as { id: string }
  await page.goto(`/notes/${note.id}`)
  await expect(page.locator('.cm-content')).toContainText('會議目的')
  await guest.page.goto(`/notes/${note.id}`)
  await guest.page.locator('.cm-content').click()
  await guest.page.keyboard.press('Control+End')
  // Far below the fold for the owner.
  await guest.page.keyboard.type('\n'.repeat(60) + '訪客在文件最後寫的一句話')
  // (The editor only draws lines near the screen, so the owner has no element for it yet.)
  await page.waitForTimeout(800)
  await expect(page.locator('.cm-line', { hasText: '訪客在文件最後寫的一句話' })).toHaveCount(0)
  // The online list names the guest; choosing them moves our cursor to theirs.
  await page.getByRole('button', { name: /人在線/ }).click()
  await page.getByRole('menuitem', { name: new RegExp(`${guestName}跳`) }).click()
  // That line is now on screen and we are typing there.
  await expect(page.locator('.cm-line', { hasText: '訪客在文件最後寫的一句話' })).toBeInViewport()
  await expect(page.locator('.cm-content')).toBeFocused()
  await page.keyboard.type('★')
  await expect(page.locator('.cm-line', { hasText: '訪客在文件最後寫的一句話' })).toContainText('★')
  await shot(page, info, 'MS-61', 'jump')
  await guest.ctx.close()
})
