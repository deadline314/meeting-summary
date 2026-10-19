# [MS-1] 建立 Cloudflare 骨架與自動部署

> 狀態：待辦

## 內文

### 需求
開發者需要一個能在本機完整跑起來、合併後自動上線的專案，前端、API、資料庫、檔案儲存、即時協作都在同一支 Cloudflare Worker 內，且全部落在免費額度。

### 來源
使用者 2026-10-19 對話（初始需求）；設計：`design/02-architecture.md` §1、§2、§10

### 驗收條件
- [ ] 本機一個指令即可啟動，D1、R2、Durable Object 都在本機模擬，打開瀏覽器看得到首頁
- [ ] 資料庫 migration 有版本紀錄，可在本機、預覽、正式三個環境套用
- [ ] 開 PR 時自動部署到獨立預覽網址並回貼在 PR 上；合併 main 後自動部署正式環境
- [ ] CI 會跑型別檢查、lint、單元測試，任一失敗就不部署
- [ ] API 錯誤一律回 `{ error: { code, message, requestId } }`，伺服器 log 為結構化 JSON 且含同一個 requestId
- [ ] `/api/health` 回傳版本號與 D1、R2 是否可用
- [ ] 使用的 Cloudflare 服務全部在免費方案內（Workers、D1、R2、Durable Objects SQLite、Cron Triggers）

### 測試流程
1. 在乾淨的電腦 clone 專案，照 README 安裝並啟動，開啟首頁
2. 呼叫 `/api/health`，看到版本號與各服務狀態為正常
3. 開一個 PR，確認 CI 通過且留言出現預覽網址，打開預覽網址可用
4. 故意呼叫不存在的 API，回應為統一錯誤格式，且在 log 中用 requestId 找到同一筆

---

# 跟其他票的關係

- Blocks：MS-2、MS-3、MS-5
- Blocked by：無
- Related：無

---
