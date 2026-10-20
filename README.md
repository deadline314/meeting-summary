# Lab Notes 實驗室筆記

給實驗室學生寫 Markdown 會議紀錄、交任務（類似 Kaggle）、管專案（類似 Linear）的平台，跑在 Cloudflare 免費額度內。

- 設計：[`design/`](design/)
- 票：[`pm/meeting-summary/`](pm/meeting-summary/)

## 本機開發

需要 Node 24。

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

打開 http://localhost:5173 ，登入頁會出現「本機測試登入」（只在 localhost 出現），輸入任意 Email 即可登入。`.dev.vars` 的 `OWNER_EMAILS` 列出的 Email 會成為老師。

| 指令 | 用途 |
|---|---|
| `npm run dev` | 套用本機 D1 migration 並啟動（前端、API、Durable Object 都在同一個程序） |
| `npm run check` | 型別檢查、lint（含禁止寫死色碼）、測試 |
| `npm run e2e` | Playwright 驗收與截圖 |
| `npm run db:generate` | 修改 `src/worker/db/schema.ts` 後產生 migration |
| `npm run types` | 修改 `wrangler.jsonc` 後重新產生 Env 型別 |

## 部署到 Cloudflare

1. `npx wrangler login`
2. `npx wrangler d1 create meeting-summary`，把印出的 `database_id` 填進 `wrangler.jsonc`
3. `npx wrangler r2 bucket create meeting-summary-files`
4. 在 `wrangler.jsonc` 的 `vars` 把 `SITE_URL` 改成你的網址
5. `npm run deploy`
6. 設定秘密（不進公開 repo）：`npx wrangler secret put OWNER_EMAILS`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GITHUB_TOKEN`

免費帳號每個帳號只有 5 個 cron，所以清理過期 session、補救卡住評測改成「有請求進來時每 5 分鐘最多跑一次」，不需要 cron。

之後 push 到 main 會由 CI 自動部署（需在 repo secrets 設 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`）。要每個 PR 都有預覽網址，在 Cloudflare 後台把這個 Worker 連到 GitHub（Workers Builds，免費）。

### Google 登入

到 Google Cloud Console → APIs & Services → Credentials 建立 OAuth Client（Web application），授權的重新導向 URI 填 `https://<你的網域>/auth/google/callback`。只需要 `openid email profile`。

### Google Drive 檔案選擇器（選用）

沒有設定時，使用者仍可貼上 Drive 網址連結檔案。要開啟「從 Google Drive 選取」：

1. 同一個 Cloud 專案啟用 **Google Picker API** 與 **Google Drive API**
2. 建立一把 **API 金鑰**，應用程式限制選「HTTP 參照網址」填 `https://<你的網域>/*`，API 限制選 Google Picker API
3. OAuth Client 的「已授權的 JavaScript 來源」加上 `https://<你的網域>`
4. OAuth 同意畫面加入範圍 `https://www.googleapis.com/auth/drive.file`（只存取使用者選的檔案，不需 Google 審核）
5. 設定：`npx wrangler secret put GOOGLE_PICKER_KEY`（API 金鑰）、`npx wrangler secret put GOOGLE_APP_ID`（Cloud 專案編號，在專案資訊頁）

### Email 通知（選用，Resend）

沒有設定時只有站內通知。要開啟「10 分鐘內沒讀的通知寄 Email」：

1. 到 [resend.com](https://resend.com) 註冊（免費方案每日 100 封、每月 3,000 封）
2. Domains → Add Domain 加入寄件網域（例如 `phocoenoides.com`），把它給的 DNS 記錄（SPF、DKIM）加到 Cloudflare DNS，等狀態變成 Verified
3. API Keys → Create API Key，權限選 **Sending access**、網域選剛才那個
4. `npx wrangler secret put RESEND_API_KEY`（貼上金鑰）
5. 寄件地址在 `wrangler.jsonc` 的 `EMAIL_FROM`，網域要和第 2 步相同

### 評測（GitHub Actions）

評測 workflow 在本 repo（公開 repo 的代管 runner 免費、分鐘數不限）。建立一個 fine-grained token，只給本 repo 的 **Actions: Read and write**，存成 Worker 秘密 `GITHUB_TOKEN`。詳見 [`design/02-architecture.md`](design/02-architecture.md) §6 與 [`.github/workflows/grade.yml`](.github/workflows/grade.yml)。

本機測試時 `.dev.vars` 設 `GRADER_MODE=local`，再另開一個終端機啟動本機評測器（用 Docker 隔離執行）：

```bash
node scripts/grade.mjs --local --site http://localhost:5173
```

沒有 Docker 時可加 `--no-docker` 改用本機 Python 執行（只供開發測試，沒有隔離，不要拿來跑別人的程式）。

## 用 MCP 連接 AI 工具

到「設定 → API Key」產生金鑰，頁面會給一行指令，例如：

```bash
claude mcp add --transport http lab-notes https://<你的網域>/mcp --header "Authorization: Bearer msk_…"
```

只能填網址的客戶端用 `https://<你的網域>/mcp/k/msk_…`（網址含金鑰，勿分享）。權限與網頁完全相同；唯讀金鑰只能查詢，管理權限才能建立專案。
