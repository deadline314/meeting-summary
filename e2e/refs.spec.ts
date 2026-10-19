import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { isMobile, login, newUserPage, shot } from './helpers'

const CAST: Record<string, [string, string, string]> = {
  'desktop-light': ['RFAA', '孫立人', '朱家豪'],
  'desktop-dark': ['RFAB', '黎明輝', '侯佩君'],
  'mobile-light': ['RFAC', '傅建宏', '鍾欣妤'],
  'mobile-dark': ['RFAD', '宋家銘', '唐雅雯'],
}

test('references: action item → issue, task backlinks, comment mentions, replies, pasted screenshots', async ({ page, browser }, info) => {
  test.setTimeout(150_000)
  const mobile = isMobile(info)
  const [key, aliceName, bobName] = CAST[info.project.name]!
  await login(page, `rf-a-${info.project.name}`, aliceName)
  const me = (await (await page.request.get('/api/me')).json()).user
  const bob = await newUserPage(browser, info, `rf-b-${info.project.name}`, bobName)
  await page.request.post('/api/projects', { data: { key, name: '口試準備' } })
  await page.request.post(`/api/projects/${key}/members`, { data: { userId: bob.user.id, role: 'member' } })

  // The teacher makes a task and a template whose action items have a real row and a task reference.
  const owner = await newUserPage(browser, info, 'owner-root', '系統老師')
  await owner.page.request.post('/auth/dev', { data: { email: 'teacher@example.com', name: '系統老師' } })
  const task = (await (await owner.page.request.post('/api/tasks', { data: { title: `${key} 期末報告` } })).json()).task
  const row = `| 1 | 準備口試投影片 | ${aliceName} | 10/30 |`
  await owner.page.request.put('/api/admin/settings/note_template_zh', {
    data: { value: ['## 一、會議目的', `參考 #[task:${task.id}]`, '## 五、待辦事項', '| # | 待辦事項 | 負責人 | 期限 |', '|---|---|---|---|', row, '## 六、待確認'].join('\n') },
  })
  const note = (await (await page.request.post('/api/notes', { data: { title: `${key} 週會`, startsAt: Date.now() } })).json()).note
  await owner.page.request.put('/api/admin/settings/note_template_zh', { data: { value: '' } })

  // MS-19: convert the action item from the links panel; the row then shows the issue.
  await page.goto(`/notes/${note.id}?tab=links`)
  if (mobile) {
    await page.getByRole('button', { name: '歷史' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '連結' }).click()
  }
  await page.getByRole('button', { name: '轉成議題' }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByText(aliceName)).toBeVisible()
  await dlg.getByRole('button', { name: '建立' }).click()
  await expect(page.getByText(`已建立 ${key}-1 並連結到待辦`)).toBeVisible()
  await expect(page.getByRole('button', { name: '轉成議題' })).toHaveCount(0)
  await shot(page, info, 'MS-19', 'action-item')
  const issue = (await (await page.request.get(`/api/issues/${key}-1`)).json()).issue
  expect(issue.assigneeIds).toEqual([me.id])
  expect(issue.dueAt).toBeTruthy()
  // The task page lists the note that mentions it (the task is still a draft, so the teacher looks).
  await owner.page.request.patch('/api/me', { data: { onboarded: true } })
  await owner.page.goto(`/tasks/${task.id}?tab=overview`)
  await expect(owner.page.getByText('被這些會議紀錄提及')).toBeVisible()
  await expect(owner.page.getByRole('link', { name: new RegExp(`${key} 週會`) })).toBeVisible()
  await shot(owner.page, info, 'MS-19', 'task-backlink')

  // MS-35: @ suggestions limited to project members, reply and edit.
  await page.goto(`/projects/${key}/${key}-1`)
  const box = page.getByPlaceholder(/留言…/)
  await box.click()
  await box.pressSequentially(`請 @${bobName.slice(0, 1)}`)
  await expect(page.getByRole('option', { name: bobName })).toBeVisible()
  await shot(page, info, 'MS-35', 'mention')
  await page.keyboard.press('Enter')
  await box.pressSequentially('確認投影片')
  await page.getByRole('button', { name: '送出' }).click()
  await expect(page.locator('li').filter({ hasText: '確認投影片' }).getByText(bobName)).toBeVisible()
  await page.getByRole('button', { name: '回覆' }).first().click()
  await page.getByPlaceholder('回覆…').fill('好的，週五前完成')
  await page.getByRole('button', { name: '送出' }).first().click()
  await expect(page.getByText('好的，週五前完成')).toBeVisible()
  await page.getByRole('button', { name: '編輯' }).first().click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('（已更新）')
  await page.keyboard.press('Control+Enter')
  await expect(page.getByText('（已編輯）').first()).toBeVisible()
  await shot(page, info, 'MS-35', 'thread')
  // Bob got the mention.
  const nb = await (await bob.page.request.get('/api/notifications')).json()
  expect(nb.items.some((n: { type: string }) => n.type === 'mention')).toBe(true)

  // MS-36: paste a screenshot → annotator → attachment.
  const png = readFileSync('e2e/fixtures/chart.png').toString('base64')
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'screenshot.png', { type: 'image/png' }))
    ;(document.activeElement as HTMLElement | null)?.blur()
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  }, png)
  const ann = page.getByRole('dialog', { name: '標註圖片' })
  await expect(ann).toBeVisible()
  // Let the sheet/dialog finish sliding in before measuring the canvas.
  await page.waitForTimeout(400)
  const canvas = ann.locator('canvas')
  const bb = (await canvas.boundingBox())!
  await page.mouse.move(bb.x + bb.width * 0.2, bb.y + bb.height * 0.2)
  await page.mouse.down()
  await page.mouse.move(bb.x + bb.width * 0.6, bb.y + bb.height * 0.6, { steps: 5 })
  await page.mouse.up()
  await ann.getByRole('button', { name: '箭頭' }).click()
  await page.mouse.move(bb.x + bb.width * 0.9, bb.y + bb.height * 0.85)
  await page.mouse.down()
  await page.mouse.move(bb.x + bb.width * 0.65, bb.y + bb.height * 0.62, { steps: 5 })
  await page.mouse.up()
  await shot(page, info, 'MS-36', 'annotate')
  await ann.getByRole('button', { name: '完成並上傳' }).click()
  await expect(page.getByRole('button', { name: /^screenshot./ })).toBeVisible({ timeout: 15_000 })
  await shot(page, info, 'MS-36', 'attached')
  await bob.ctx.close()
  await owner.ctx.close()
})
