# 系統架構與成本

> 來源：使用者 2026-10-19 對話。決策：部署在 Cloudflare、成本最低；評測用 GitHub Actions；會議紀錄即時多人協作；任何 Google 帳號可登入。

## 1. 總覽

```
瀏覽器 / PWA ──HTTPS──┐
外部 MCP 客戶端 ───────┤
GitHub Actions 回報 ───┤
                       ▼
             Cloudflare Worker（單一支）
             ├─ 靜態資源（前端 SPA，免費、不計請求數）
             ├─ /api/*   REST（給網頁）
             ├─ /mcp     MCP（給外部 AI）
             ├─ /ws/doc/:id → Durable Object「DocRoom」（每份會議紀錄一個，即時協作）
             └─ Cron Trigger（清理過期 session、補救卡住的評測）
                       │
         ┌─────────────┼──────────────┐
         ▼             ▼              ▼
        D1           R2          GitHub Actions（本公開 repo）
   （關聯資料）  （圖片、附件、   （跑評測，結果用 OIDC 簽章回報）
                 提交、評測程式）
```

**只有一個事實來源**：REST 與 MCP 都呼叫同一組 service，權限檢查、活動紀錄寫入都在 service 內，沒有任何入口能繞過（沿用 `05-project-management.md` §1）。

## 2. 技術選擇

| 層 | 選擇 | 理由 |
|---|---|---|
| 執行環境 | Cloudflare Workers + Static Assets | 一支 Worker 同時服務前端與 API，靜態資源請求免費 |
| API 路由 | Hono | 小、跑在 Workers 上、型別好 |
| 資料庫 | D1 + Drizzle | 免費 5 GB；Drizzle 產生型別與 migration |
| 即時協作 | Durable Objects（SQLite）+ Yjs | 每份文件一個 DO，WebSocket Hibernation 降低閒置成本；免費方案可用 |
| 檔案 | R2（私有 bucket，經 Worker 驗權後讀取） | 10 GB 免費、零流出費 |
| 前端 | React + Vite + TanStack Router／Query | Router 的型別化 search params 讓「狀態全放 URL」成本最低 |
| 樣式與動畫 | Tailwind（只用語意 token）+ Radix 元件 + Motion | Radix 處理無障礙與浮層；Motion 做轉場 |
| 編輯器 | CodeMirror 6 + y-codemirror | Markdown 編輯與協作游標 |
| PWA | vite-plugin-pwa | 安裝、離線外殼、更新提示 |
| 測試 | Vitest（含 Workers pool）+ Playwright | Playwright 同時產出電腦版與手機版截圖 |

## 3. 登入與 Session

1. Google OAuth（Authorization Code + PKCE），Worker 驗 id_token 後建立帳號。只要 `openid email profile`，不拿 Google refresh token。
2. **Session**：隨機 token 放 HttpOnly、Secure、SameSite=Lax cookie；D1 只存雜湊。有效期 30 天、滑動延長（每天第一次請求順延），使用者不用每次重登。
3. **重新登入預設上次的帳號**：登入成功時另存一個非機密 cookie 記住上次的 Email；之後導去 Google 時帶 `login_hint`，Google 會直接用該帳號，不出現帳號選擇畫面。畫面上另有「使用其他帳號」。
4. **第一次登入**：導到設定名稱頁，預填 Google 名稱；略過就用 Google 名稱。
5. 每次請求都檢查帳號是否被停用或移除，被移除立刻失效。
6. 名稱只存在 users 表；所有紀錄存 user id，顯示時 join，改名即時反映到全站。

## 4. 即時協作與作者追蹤

- 每份會議紀錄是一個 Yjs 文件，由一個 DocRoom DO 持有；狀態存在 DO 的 SQLite。
- **作者追蹤**：連線時 DO 由 session 得知帳號；每條連線的 Yjs clientID 綁定該帳號，送出的更新若含其他帳號的 clientID 一律拒絕，作者無法偽造。Yjs 的每一段插入都帶 clientID，因此可以推出「每個字是誰寫的」，畫面上彙整成「每段是誰寫的」。
- **編輯紀錄**：DO 把同一人連續的編輯合併成「編輯段落」（閒置 5 分鐘即結束），寫一筆活動：誰、哪份文件、起訖時間、新增／刪除字數，並留一個版本快照供比對。
- **快照同步到 D1**：文件閒置後把 Markdown 純文字與標題、日期等欄位寫回 D1，供列表、搜尋、MCP 讀取。
- 註解錨點用 Yjs 相對位置，文字前後被改仍會跟著移動；原文被刪光時保留引用文字並標示「原文已刪除」。
- 斷線時本地照常編輯，重連後自動合併，不丟字。

## 5. 檔案

| 種類 | 存放 | 規則 |
|---|---|---|
| 圖片 | R2 | 上傳前在瀏覽器壓縮成 WebP、長邊 2560px；貼上、拖放、按鈕三種方式 |
| 附件、程式碼 | R2 | 單檔上限 50 MB（站台設定可調）；程式碼可在頁內語法上色預覽 |
| 任務提交、評測程式 | R2 | 只有評測流程與有權限的人能讀 |
| Google Drive | 不複製，只存 metadata 與連結 | 用 Google Picker（`drive.file` 權限，使用者按「連結 Drive」時才授權）選檔；不改 Drive 權限、移除時不刪來源檔 |

所有讀取經 Worker 驗權；圖片加上 Cache API 快取。每人有儲存配額，後台看得到用量。

決策：參考文件 §5.6 把附件放上傳者的 Drive；本平台改為上傳放 R2、Drive 只做連結。原因：學生不一定願意授權寫入自己的 Drive，且 R2 免費額度足夠實驗室規模。

## 6. 任務評測（GitHub Actions）

> 2026-10-19 更新：本 repo 是公開 repo。公開 repo 使用 GitHub 代管 runner 的分鐘數不限、免費，所以評測 workflow 直接放在本 repo。代價是 Actions log、workflow 輸入、artifact 任何人都看得到，下面的流程以「log 裡沒有任何學生資料或秘密」為前提設計。

```
學生提交 → Worker 存 R2、建立評測工作（排隊中）
        → 呼叫 GitHub workflow_dispatch，輸入只有「工作 id」（公開可見，無害）
GitHub Actions（單一 job，permissions 只有 id-token: write）
  1. 向 GitHub 取 OIDC token，帶著它向 Worker 領取工作：Worker 驗 token 的 repo、workflow、
     run id 後，回傳評測程式與提交的下載內容（不經過 workflow 輸入，不會出現在 log）
  2. 在 container 內以 --network none、CPU／記憶體／時間上限執行評測；
     container 不帶任何環境變數，學生程式拿不到 OIDC token
  3. 評測輸出 result.json 與執行紀錄寫在 runner 暫存檔，不印到 log、不上傳 artifact
  4. 帶 OIDC token 把結果 POST 回 Worker
Worker 驗 OIDC（發行者、repo、workflow、工作 id 與 run 對得上）→ 寫入結果、通知學生
Cron：超過時限仍未回報的工作標為「逾時」並寫明原因
```

- 學生程式跑在沒有秘密、沒有網路的 container，無法偽造結果，也無法把資料送出去。
- 評測程式的輸出合約：`{ passed, score, message, details[] }`；沒通過一定要有 `message` 說明原因。
- 公開 log 只會出現「工作 id、開始、結束、耗時」；workflow 每一步都把輸出導到檔案，不 echo 任何內容。
- 本機開發不需要 GitHub：提供本機評測模式，由 Worker 以 `runner` 指令在本機 Docker 跑同一套流程，方便測試。
- **未來訓練模型**：同一份 workflow 把 `runs-on` 換成實驗室 GPU 機器的 self-hosted runner 即可，不用改平台。self-hosted runner 不要接公開 repo 的 fork PR（GitHub 預設不會），以免外人程式跑在實驗室機器上。
- 每位學生每個任務每日提交次數有上限（任務設定），避免排隊塞車。

## 7. MCP 與 API Key

- 每人在設定頁自己產生 API Key：可命名、設 scope（read／write／manage）、可限定專案、可撤銷；只在建立時顯示一次，D1 只存雜湊；記錄最後使用時間。
- 端點：`https://<網域>/mcp`（Streamable HTTP，無狀態）。
- 設定頁直接給可複製的一行指令，例如：

  ```
  claude mcp add --transport http lab https://<網域>/mcp --header "Authorization: Bearer <key>"
  ```

  只能填網址的客戶端（例如 Claude Desktop 的自訂連接器）提供 `https://<網域>/mcp/k/<key>` 形式，頁面上標示「網址含金鑰，勿分享」。
- 每次呼叫都重新讀取金鑰與帳號狀態，不信任快取。活動紀錄標記來源 `mcp`。
- 工具涵蓋：專案、議題（查、開、改、批次改、留言）、會議紀錄（查、讀、建立）、任務（查、看自己的提交結果）。寫入可帶 `operation_id` 做冪等。

## 8. 可靠性與錯誤處理

- D1 沒有互動式交易：同一個動作的資料變更與活動紀錄用 `batch` 一次送出（原子）。
- 樂觀鎖：可修改的資料帶 `version`，衝突回 409。
- 所有 API 錯誤回統一格式 `{ error: { code, message, requestId } }`；伺服器 log 用結構化 JSON，含 requestId；前端錯誤邊界顯示可重試的訊息並附 requestId。
- 旁支（通知、mention 解析）失敗只記 log，不讓主流程失敗。
- 輸入一律在 API 邊界用 schema 驗證。

## 9. 成本

以實驗室規模（< 100 人）估算，全部落在免費額度：

| 服務 | 免費額度 | 本平台用途 |
|---|---|---|
| Workers | 每日 10 萬請求；靜態資源不計 | API、MCP |
| Durable Objects（SQLite） | 每日 10 萬請求 | 即時協作 |
| D1 | 5 GB、每日 500 萬列讀取 | 全部關聯資料 |
| R2 | 10 GB、零流出費 | 圖片、附件、提交 |
| GitHub Actions（公開 repo） | 代管 runner 分鐘數不限 | 評測 |

**何時要付費**：Workers 免費方案每次請求 CPU 上限 10ms；若評測回報、批次操作等出現 CPU 超限，升級 Workers Paid（每月 5 美元）。後台用量頁會顯示接近上限的項目。

自訂網域需要自己的網域（每年約 10 美元）；不買就用免費的 `*.workers.dev`。

## 10. 環境

- 本機：`wrangler dev`（D1、R2、DO 都在本機模擬）
- 預覽：每個 PR 部署到獨立預覽網址
- 正式：合併 main 後自動部署；D1 migration 在部署前執行
