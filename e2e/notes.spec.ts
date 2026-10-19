import { expect, test } from '@playwright/test'
import { cast, isMobile, login, newUserPage, shot } from './helpers'

test('meeting notes: create, collaborate, authors, comment', async ({ page, browser }, info) => {
  const mobile = isMobile(info)
  const tag = info.project.name
  const [aliceName, bobName] = cast(info)
  await login(page, `alice-${tag}`, aliceName)
  const bob = await newUserPage(browser, info, `bob-${tag}`, bobName)
  const me = await (await page.request.get('/api/me')).json()

  // Create through the UI.
  await page.goto('/notes')
  await expect(page.getByRole('heading', { name: '會議紀錄' })).toBeVisible()
  await page.getByRole('button', { name: '新增' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('會議名稱').fill(`週會 ${tag}`)
  await dialog.getByLabel('地點').fill('https://meet.google.com/abc-defg-hij')
  await dialog.getByRole('button', { name: '新增', exact: true }).first().click()
  await page.getByRole('button', { name: bobName }).click()
  await page.keyboard.press('Escape')
  await shot(page, info, 'MS-11', 'create')
  await dialog.getByRole('button', { name: '建立' }).click()
  await page.waitForURL(/\/notes\/[\w-]+/)
  const noteUrl = page.url()

  // Template is in the document.
  await expect(page.locator('.prose-md h2').first()).toContainText('一、會議目的')
  await shot(page, info, 'MS-11', 'note')

  // Bob joins and types; Alice sees it live.
  await bob.page.goto(noteUrl + (mobile ? '?mode=edit' : ''))
  await bob.page.locator('.cm-content').click()
  await bob.page.keyboard.press('Control+Home')
  await bob.page.keyboard.type('Bob 的補充說明：資料集已整理完畢。\n\n')
  await expect(page.locator('.prose-md')).toContainText('Bob 的補充說明', { timeout: 5000 })
  if (!mobile) await shot(page, info, 'MS-12', 'collab')

  // Authors view.
  await page.goto(noteUrl + '?authors=true&mode=preview')
  await expect(page.locator('[data-start] > span[aria-label]').first()).toBeVisible()
  await shot(page, info, 'MS-13', 'authors')

  // Comment on a selection in the preview.
  await page.goto(noteUrl + '?mode=preview')
  const para = page.locator('.prose-md p', { hasText: '資料集已整理完畢' })
  await para.selectText()
  await page.getByTestId('comment-bubble').click()
  await page.getByPlaceholder('寫下哪裡有問題').fill('請補上資料集的來源與筆數')
  await page.getByRole('button', { name: '送出' }).click()
  await expect(page.locator('mark.comment-mark').first()).toBeVisible()
  await shot(page, info, 'MS-15', 'comment')

  // Bob leaves → his edit session becomes a version.
  await bob.ctx.close()
  await page.goto(noteUrl + '?tab=history' + (mobile ? '' : '&mode=preview'))
  if (mobile) await page.getByRole('button', { name: '歷史' }).click()
  await expect(page.getByText(bobName).first()).toBeVisible()
  await shot(page, info, 'MS-14', 'history')
  await page.getByRole('button', { name: new RegExp(bobName) }).first().click()
  await expect(page.getByRole('dialog', { name: '與前一版的差異' })).toBeVisible()
  await expect(page.getByRole('dialog').getByText('Bob 的補充說明').first()).toBeVisible()
  await shot(page, info, 'MS-14', 'diff')
  expect(me.user.id).toBeTruthy()

  // Image upload into the text (toolbar button → file chooser), shown inline in the preview.
  await page.goto(noteUrl + '?mode=' + (mobile ? 'edit' : 'split'))
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '插入圖片' }).click()
  await (await chooser).setFiles('e2e/fixtures/chart.png')
  if (mobile) await page.getByRole('button', { name: '預覽' }).click()
  const img = page.locator('.prose-md img[src^="/files/"]')
  await expect(img).toBeVisible({ timeout: 10_000 })
  await img.scrollIntoViewIfNeeded()
  await shot(page, info, 'MS-16', 'image')
  await img.click()
  await expect(page.getByRole('dialog', { name: '1 / 1' })).toBeVisible()
  await shot(page, info, 'MS-16', 'lightbox')
  await page.keyboard.press('Escape')

  // Attach a code file and preview it with syntax highlighting.
  await page.goto(noteUrl + '?tab=files&mode=preview')
  if (mobile) await page.getByRole('button', { name: /更多|歷史/ }).last().click()
  if (mobile) await page.getByRole('dialog').getByRole('button', { name: '附件' }).click()
  const files = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '選擇檔案' }).click()
  await (await files).setFiles('e2e/fixtures/train.py')
  await page.getByRole('button', { name: 'train.py' }).click()
  await expect(page.locator('pre.hljs .hljs-keyword').first()).toBeVisible()
  await shot(page, info, 'MS-18', 'code-preview')
  await page.keyboard.press('Escape')

  // List + calendar.
  await page.goto('/notes')
  await expect(page.getByText(`週會 ${tag}`)).toBeVisible()
  await shot(page, info, 'MS-20', 'list')
  await page.goto('/notes?view=calendar')
  await page.locator(`[data-day="${new Date().getDate()}"]`).click()
  await shot(page, info, 'MS-20', 'calendar')
})
