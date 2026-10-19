import { expect, test } from '@playwright/test'
import { isMobile, login, shot } from './helpers'

const NAMES: Record<string, string> = { 'desktop-light': '邵雅涵', 'desktop-dark': '童國華', 'mobile-light': '盧怡伶', 'mobile-dark': '馬俊偉' }

test('Drive: pasted URL becomes a card in the text and an attachment', async ({ page }, info) => {
  const mobile = isMobile(info)
  await login(page, `drv-${info.project.name}`, NAMES[info.project.name]!)
  const note = (await (await page.request.post('/api/notes', { data: { title: '期中簡報討論', startsAt: Date.now() } })).json()).note
  await page.goto(`/notes/${note.id}${mobile ? '?mode=edit' : ''}`)
  const url = 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit'
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.evaluate((u) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', u)
    document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, url)
  await expect(page.locator('.cm-content')).toContainText(`[Google Slides](${url})`)
  if (mobile) await page.goto(`/notes/${note.id}?mode=preview`)
  const card = page.locator('a.drive-card').first()
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('href', url)
  await expect(card).toHaveAttribute('target', '_blank')
  await card.scrollIntoViewIfNeeded()
  await shot(page, info, 'MS-17', 'card')
  // The same link is now an attachment; removing it only drops our pointer.
  const files = (await (await page.request.get(`/api/files?parentType=note&parentId=${note.id}`)).json()).items
  expect(files.map((f: { kind: string; driveUrl: string }) => [f.kind, f.driveUrl])).toEqual([['drive', url]])
  await page.goto(`/notes/${note.id}?tab=files`)
  if (mobile) {
    await page.getByRole('button', { name: '歷史' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '附件' }).click()
  }
  await expect(page.getByText('Google Slides').last()).toBeVisible()
  await shot(page, info, 'MS-17', 'attachment')
})
