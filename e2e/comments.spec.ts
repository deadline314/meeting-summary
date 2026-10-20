import { expect, test } from '@playwright/test'
import { cast, isMobile, login, newUserPage, shot } from './helpers'

test('a thread whose first comment was deleted can still be resolved, and vanishes once empty', async ({ page, browser }, info) => {
  const [aliceName, bobName] = cast(info)
  await login(page, `dc-a-${info.project.name}`, aliceName)
  const bob = await newUserPage(browser, info, `dc-b-${info.project.name}`, bobName)
  const { note } = await (await page.request.post('/api/notes', { data: { title: `討論串 ${info.project.name}`, startsAt: Date.now() } })).json()
  const base = `/api/notes/${note.id}/comments`
  const root = (await (await page.request.post(base, { data: { body: '背景寫得不夠清楚', anchor: { start: 'x', end: 'y' }, quote: '背景：[簡述現況或問題]' } })).json()).comment
  const reply = (await (await bob.page.request.post(base, { data: { body: '我補上了實驗背景', parentId: root.id } })).json()).comment
  await page.request.delete(`${base}/${root.id}`)

  const p = bob.page
  await p.goto(`/notes/${note.id}?tab=comments`)
  if (isMobile(info)) await p.getByRole('button', { name: '註解' }).first().click()
  await expect(p.getByText('此留言已刪除')).toBeVisible()
  await expect(p.getByText('我補上了實驗背景')).toBeVisible()
  await shot(p, info, 'MS-59', 'deleted-root')

  await p.getByRole('button', { name: '標記已解決' }).click()
  await expect(p.getByRole('button', { name: '已解決 1' })).toBeVisible()
  await expect(p.getByText('找不到這個項目')).toHaveCount(0)
  await p.getByRole('button', { name: '已解決 1' }).click()
  await expect(p.getByRole('button', { name: '重新開啟' })).toBeVisible()
  await shot(p, info, 'MS-59', 'resolved')

  // Deleting the last reply leaves nothing to discuss: the thread is gone.
  await p.request.delete(`${base}/${reply.id}`)
  await p.reload()
  if (isMobile(info)) await p.getByRole('button', { name: '註解' }).first().click()
  await expect(p.getByText('此留言已刪除')).toHaveCount(0)
  await bob.ctx.close()
})
