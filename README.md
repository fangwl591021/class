# Class Registration Engine

萬用活動報名引擎。定位為可獨立運行產品，也能透過 API 串接 TDEA 或其他專案，或完整 1:1 複刻成另一套品牌系統。

## 核心模型

- Identity：會員登入 / Guest 自行填寫 / Hybrid
- Event：活動
- Session：梯次（可選）
- Item：報名項目（種類）
- Registration：報名
- Registration Item：項目 × 單價 × 人數
- Attendee：參加者資料
- Order：訂單
- Payment：付款
- Check-in：報到

## 報名成立模式

1. `free`：免費，送出即成功。
2. `register_then_pay`：先報名成功、先占名額，之後付款。
3. `pay_then_confirm`：付款完成後才正式成功；付款前可暫留名額並逾時釋放。

## Identity 模式

- `login_required`：必須登入後報名。
- `guest_only`：不登入，一般自行填寫。
- `hybrid`：登入快速報名或自行填寫都可以。

## 目前可操作頁面

- `/`：首頁
- `/events`：公開活動列表
- `/event/:eventId`：動態手機報名頁
- `/registration/:accessToken`：報名查詢 / 取消 / 匯款回報
- `/ticket/:accessToken`：電子票券 / QR Code
- `/login?return=...`：登入入口
- `/auth/line/start`、`/auth/line/callback`：LINE Login
- `/auth/handoff?code=...`：外部會員一次性登入交接
- `/my`：會員「我的報名」
- `/admin/login`：管理員登入
- `/admin`：活動管理
- `/admin/event/:eventId`：活動儀表板 / 名單 / 收款
- `/admin/event/:eventId/config`：梯次專屬項目 / 自訂欄位 / 報到
- `/admin/event/:eventId/items`：項目編輯 / 停用 / 排序 / 價格 / 名額
- `/admin/api-clients`：API Client 建立 / 停用
- `/admin/checkin`：手機相機 QR 掃碼報到

## V0.9 已完成

### 報名核心

- 活動 / 梯次 / 項目 / 報名 / 訂單 / 付款 / 報到
- 項目 × 單價 × 人數，價格一律由後端重新計算
- 活動總名額 / 梯次名額 / 項目名額
- 每梯次可有自己的項目 / 價位 / 名額
- 每位參加者資料與自訂欄位 Builder
- 前台動態渲染自訂欄位，後端再次驗證必填
- 匯款回報 / 管理員確認收款
- `pay_then_confirm` 暫留名額、付款成功轉 `confirmed`、逾時釋放名額

### Login / Integration / Security

- Login / Guest / Hybrid
- 管理員 `ADMIN_TOKEN` 保護
- LINE Login OAuth 2.1 基線
- API Client 綁 tenant，API Key 只保存 SHA-256 hash
- Identity Session / Identity Token
- `X-Class-Identity-Token` 報名身份注入
- Identity tenant 與 Event tenant 強制一致
- Integration audit log
- 外部會員一次性 Browser Handoff
- Handoff code 短效、一次性，不把 identity token 放進 URL
- `/my` 使用登入身份直接查詢會員報名紀錄
- API Client scope 已開始強制：`events:read` / `identity:write`
- TDEA 串接文件：`docs/TDEA_IDENTITY_ADAPTER.md`

### V0.9 新增：取消 / 退費 / 催款

活動可以設定：

- `cancel_policy`：`allowed` / `disabled`
- `cancel_deadline_hours`：活動開始前幾小時停止自行取消
- `paid_cancel_action`：
  - `manual_refund`：已付款取消後建立待人工處理退費單
  - `no_refund`：可取消但不建立退費單
  - `block`：已付款後不可自行取消
- `payment_due_days`：`register_then_pay` 報名後幾天內付款

新增資料：

- `registrations.payment_due_at`
- `registrations.reminder_sent_at`
- `refund_requests`

新增 API：

- `GET /api/v1/admin/events/:eventId/policy`
- `POST /api/v1/admin/events/:eventId/policy`
- `GET /api/v1/admin/reminders/due`
- `POST /api/v1/admin/registrations/:registrationId/reminder-sent`

`GET /api/v1/admin/reminders/due` 會列出 24 小時內到期、尚未付款、尚未標記提醒的報名，方便之後串 LINE / Email / SMS 通知器。

### V0.8 已有

- QR 掃碼專用報到頁 `/admin/checkin`
- 電子票券 / QR Code
- 後台項目編輯 / 停用 / 排序 / 價格 / 名額
- CSV 中文名單匯出
- API Key 輪替

## Integration API

外部專案使用 API Key 串接。V0.9 已開始強制 scope：

- `GET /api/v1/integration/events` → `events:read`
- Identity Session / Handoff → `identity:write`

### 建立已驗證會員 Identity Session

```http
POST /api/v1/integration/identity/session
X-API-Key: cls_xxxxx
Content-Type: application/json

{
  "provider": "tdea",
  "externalMemberId": "12345",
  "displayName": "王小明",
  "phone": "0912345678",
  "email": "demo@example.com"
}
```

### 建立一次性 Browser Handoff

```http
POST /api/v1/integration/identity/handoff
X-API-Key: cls_xxxxx
Content-Type: application/json

{
  "identityToken": "ids_xxxxx",
  "returnPath": "/event/evt_xxxxx",
  "expiresSeconds": 120
}
```

完整 TDEA 流程請看 `docs/TDEA_IDENTITY_ADAPTER.md`。

## LINE Login 設定

正式啟用前需設定：

- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_SECRET`
- `LINE_REDIRECT_URI`

正式環境至少執行：

```bash
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
```

## D1

目前 migration：

- `0001_initial.sql`
- `0002_payment_sessions.sql`
- `0003_integrations_security.sql`
- `0004_identity_handoff.sql`
- `0005_cancellation_reminders.sql`

建立正式資料庫後，把 `wrangler.toml` 的 `database_id` 改成實際 D1 ID，再執行：

```bash
npm install
npm run db:migrate:remote
npm run deploy
```

## Worker entrypoint

```text
src/app-v09.ts
```

## 目前分支

`agent/registration-v1-foundation`

## 下一階段

1. 建立正式 `class_db`、套 migration、部署 staging 實機測試
2. 把取消 / 退費 / 付款期限設定做進活動後台 UI
3. 建立 refund 管理頁與完成退費流程
4. 將 due reminders 串 LINE / Email / SMS 通知 adapter
5. 付款 gateway adapter（LINE Pay / 藍新 / 綠界）
6. API scope 擴充到 registration / payment 等更細權限
7. 若需要 Excel `.xlsx` 再加正式 Excel 匯出
