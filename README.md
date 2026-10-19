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
4. 在 `wrangler.jsonc` 的 `vars` 填 `OWNER_EMAILS`、`GOOGLE_CLIENT_ID`
5. 設定秘密：`npx wrangler secret put GOOGLE_CLIENT_SECRET`、`npx wrangler secret put GITHUB_TOKEN`
6. `npm run deploy`

之後 push 到 main 會由 CI 自動部署（需在 repo secrets 設 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`）。要每個 PR 都有預覽網址，在 Cloudflare 後台把這個 Worker 連到 GitHub（Workers Builds，免費）。

### Google 登入

到 Google Cloud Console → APIs & Services → Credentials 建立 OAuth Client（Web application），授權的重新導向 URI 填 `https://<你的網域>/auth/google/callback`。只需要 `openid email profile`。

### 評測（GitHub Actions）

評測 workflow 在本 repo（公開 repo 的代管 runner 免費、分鐘數不限）。建立一個 fine-grained token，只給本 repo 的 **Actions: Read and write**，存成 Worker 秘密 `GITHUB_TOKEN`。詳見 [`design/02-architecture.md`](design/02-architecture.md) §6 與 [`.github/workflows/grade.yml`](.github/workflows/grade.yml)。

本機測試時 `.dev.vars` 設 `GRADER_MODE=local`，評測改由本機 Docker 執行。
