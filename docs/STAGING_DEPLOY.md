# Class Registration Engine — Staging 部署流程

## 目標

將目前 V0.11 分支部署到 Cloudflare Workers，建立正式 `class_db` D1，套用 migration，完成第一輪實機 smoke test。

## 1. 先確認分支

```powershell
git checkout agent/registration-v1-foundation
git pull
```

## 2. 安裝依賴

```powershell
npm install
```

## 3. 建立 D1

```powershell
npx wrangler d1 create class_db
```

Wrangler 會回傳類似：

```text
database_name = "class_db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把真正的 `database_id` 寫回 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "CLASS_DB"
database_name = "class_db"
database_id = "實際-D1-ID"
migrations_dir = "migrations"
```

## 4. 套用 migration

先確認 migration：

```powershell
Get-ChildItem .\migrations
```

目前順序：

```text
0001_initial.sql
0002_payment_sessions.sql
0003_integrations_security.sql
0004_identity_handoff.sql
0005_cancellation_reminders.sql
0006_refund_processing.sql
```

執行：

```powershell
npx wrangler d1 migrations apply CLASS_DB --remote
```

然後確認關鍵資料表：

```powershell
npx wrangler d1 execute CLASS_DB --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

至少應看到：

```text
events
event_sessions
event_items
event_form_fields
identities
identity_sessions
registrations
registration_items
registration_attendees
orders
payments
checkins
api_clients
identity_handoffs
integration_audit_logs
refund_requests
```

## 5. 設定管理密碼

```powershell
npx wrangler secret put ADMIN_TOKEN
```

正式使用 LINE Login 時再設定：

```powershell
npx wrangler secret put LINE_CHANNEL_SECRET
```

付款提醒若要交給外部 LINE / Email / SMS 通知器：

```powershell
npx wrangler secret put NOTIFY_WEBHOOK_URL
```

## 6. LINE Login 變數

需要 LINE Login 時，在 `wrangler.toml` 或 Cloudflare Dashboard 設定：

```text
LINE_CHANNEL_ID
LINE_REDIRECT_URI
```

Callback 預計：

```text
https://class.fangwl591021.workers.dev/auth/line/callback
```

## 7. 部署

```powershell
npx wrangler deploy
```

## 8. Smoke Test

### A. Health

```text
/health
```

預期版本：

```json
{"success":true,"version":"0.11.0"}
```

### B. 管理登入

```text
/admin/login
```

確認未登入不能直接進管理 API。

### C. 建立活動

後台建立一場測試活動，至少測：

1. 免費活動
2. `register_then_pay` 後付活動
3. `pay_then_confirm` 付款後才成立活動
4. 梯次
5. 二種以上項目與不同單價

### D. 報名

逐一確認：

```text
項目 × 單價 × 人數
梯次篩選
活動 / 梯次 / 項目名額
Guest
Login / Hybrid
多人參加者資料
自訂欄位
```

### E. 付款

後付：

```text
報名成功 → unpaid → 匯款回報 → pending → 後台確認 → paid
```

先付：

```text
pending_payment → 匯款回報 → pending → 後台確認 → confirmed + paid
```

### F. 取消 / 退費

確認：

```text
允許取消
禁止取消
取消截止時間
已付款人工退費
已付款不退費
已付款禁止自行取消
```

後台：

```text
/admin/refunds
```

### G. 付款提醒

後台：

```text
/admin/reminders
```

確認 24 小時內到期的後付訂單會列出。

### H. 電子票券 / 報到

```text
/ticket/:accessToken
/admin/checkin
```

確認 QR 內容只有 `registration_no`，不包含 private access token。

## 9. 第一輪驗收標準

只有以下全部通過，才建議將 PR 合併進 `main`：

- 建立活動成功
- 免費報名成功
- 後付成功
- 付款後成立成功
- 梯次與不同價格正確
- 名額不超賣
- Guest 與 Login 模式都正常
- 取消規則正常
- 退費申請正常
- CSV 匯出正常
- QR 報到正常
- Android / iPhone 各跑一次報名流程

不要在 smoke test 未完成前把 TDEA 正式入口切到 Class。
