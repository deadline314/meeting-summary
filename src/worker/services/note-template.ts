// Default meeting-note body. The title + info table (date, place, recorder, attendees) are
// rendered from structured fields, so the body starts at section 一 and can never disagree with them.

export type Locale = 'zh' | 'en'
export type ActionItem = { item: string; owner: string; due: string }

const ZH = (carry: string) => `## 一、會議目的
[一兩句話說明這場會要解決什麼問題或做出什麼決定]

## 二、前次待辦追蹤
| 待辦事項 | 負責人 | 狀態 | 備註 |
|----------|--------|------|------|
${carry || '| [事項] | [姓名] | 已完成 / 進行中 / 延後 | [說明] |'}

## 三、討論事項
### 議題 1：[議題名稱]
- 背景：[簡述現況或問題]
- 討論重點：
  - [觀點或資訊]
  - [觀點或資訊]
- 結論：[本議題的決定，沒有結論也要寫「待下次討論」]

### 議題 2：[議題名稱]
- 背景：
- 討論重點：
- 結論：

## 四、決議事項
1. [明確的決定，例如：上線日期定為 11/15]
2. [決定]

## 五、待辦事項（Action Items）
| # | 待辦事項 | 負責人 | 期限 |
|---|----------|--------|------|
| 1 | [具體要做的事] | [姓名] | 10/25 |
| 2 | [具體要做的事] | [姓名] | 10/30 |

## 六、待確認
- [尚未解決、需要其他人回覆的問題]

## 七、下次會議
- 時間：[日期時間]
- 預計議題：[議題]

## 附件
- [相關文件、簡報、連結]
- Linear 連結 or Ticket 名稱
`

const EN = (carry: string) => `## 1. Purpose
[One or two sentences: what problem this meeting solves or what it decides]

## 2. Follow-up on previous action items
| Item | Owner | Status | Notes |
|------|-------|--------|-------|
${carry || '| [item] | [name] | Done / In progress / Postponed | [notes] |'}

## 3. Discussion
### Topic 1: [title]
- Background: [current situation or problem]
- Key points:
  - [point]
  - [point]
- Conclusion: [decision; write "to be continued" if none]

### Topic 2: [title]
- Background:
- Key points:
- Conclusion:

## 4. Decisions
1. [a clear decision, e.g. launch date is 11/15]
2. [decision]

## 5. Action items
| # | Item | Owner | Due |
|---|------|-------|-----|
| 1 | [concrete task] | [name] | 10/25 |
| 2 | [concrete task] | [name] | 10/30 |

## 6. Open questions
- [unresolved questions that need someone's answer]

## 7. Next meeting
- Time: [date & time]
- Planned topics: [topics]

## Attachments
- [documents, slides, links]
- Issue links
`

export function defaultBody(locale: Locale, carried: ActionItem[], customTemplate?: string | null) {
  const status = locale === 'zh' ? '進行中' : 'In progress'
  const carry = carried.map((a) => `| ${a.item} | ${a.owner} | ${status} | ${a.due} |`).join('\n')
  if (customTemplate) return customTemplate.replace('{{carryover}}', carry)
  return locale === 'zh' ? ZH(carry) : EN(carry)
}

const ACTION_HEADING = /^##\s*(五、|5\.\s*)?.*(待辦事項|action items)/i

/** Pulls the rows of the "Action items" table, skipping template placeholders. */
export function parseActionItems(md: string): ActionItem[] {
  const lines = md.split('\n')
  const start = lines.findIndex((l) => ACTION_HEADING.test(l.trim()))
  if (start < 0) return []
  const out: ActionItem[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!.trim()
    if (l.startsWith('#')) break
    if (!l.startsWith('|')) continue
    const cells = l.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 3 || cells.every((c) => /^-+$/.test(c)) || /^#$/.test(cells[0]!)) continue
    const [, item = '', owner = '', due = ''] = cells.length >= 4 ? cells : ['', ...cells]
    if (!item || /^\[.*\]$/.test(item)) continue
    out.push({ item, owner, due })
  }
  return out
}
