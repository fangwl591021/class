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
- `/admin/event/:eventId/policy`：取消 / 已付款取消 / 後付付款期限設定
- `/admin/refunds`：退費申請管理
- `/admin/reminders`：未付款提醒作業台
- `/admin/api-clients`：API Client 建立 / 停用
- `/admin/checkin`：手機相機 QR 掃碼報到

## V0.10.1 已完成

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

### V0.10 新增：取消 / 退費 / 付款期限後台

活動管理員可直接在 `/admin/event/:eventId/policy` 設定：

- 是否允許使用者自行取消
- 活動開始前幾小時停止自行取消
- 已付款取消後：
  - 建立人工退費申請
  - 允許取消但不退費
  - 禁止自行取消
- `register_then_pay` 報名後幾天內必須付款

退費管理 `/admin/refunds`：

- 顯示待處理退費申請
- 顯示活動、報名編號、聯絡人、退費金額、原因
- 可標記「已退費」
- 可「駁回」
- 保存處理時間與處理備註
- 標記已退費後同步將 Registration / Order 的付款狀態更新為 `refunded`

未付款提醒 `/admin/reminders`：

- 顯示 24 小時內付款到期的後付報名
- 顯示手機、Email、付款期限、應付金額
- 可人工標記「已提醒」
- 後續 LINE / Email / SMS 通知器共用同一批 reminder 資料

### V0.10.1 修正

- 退費處理改用 `refund_requests` 在 0005 已建立的 `requested_at / processed_at / note` 欄位，避免重複 migration 欄位衝突。
- `0006_refund_processing.sql` 改為 no-op compatibility migration，維持既有 migration 順序。
- 退費管理頁不使用瀏覽器原生 prompt，改為頁面內直接填寫處理備註。
- Worker entrypoint 改為 `src/app-v101.ts`。

新增 API：

- `GET /api/v1/admin/refunds`
- `POST /api/v1/admin/refunds/:refundId/approve`
- `POST /api/v1/admin/refunds/:refundId/reject`
- `GET /api/v1/admin/events/:eventId/policy`
- `POST /api/v1/admin/events/:eventId/policy`
- `GET /api/v1/admin/reminders/due`
- `POST /api/v1/admin/registrations/:registrationId/reminder-sent`

### V0.8 已有

- QR 掃碼專用報到頁 `/admin/checkin`
- 電子票券 / QR Code
- 後台項目編輯 / 停用 / 排序 / 價格 / 名額
- CSV 中文名單匯出
- API Key 輪替

## Integration API

外部專案使用 API Key 串接。目前 scope：

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
- `0006_refund_processing.sql`（compatibility no-op）

建立正式資料庫後，把 `wrangler.toml` 的 `database_id` 改成實際 D1 ID，再執行：

```bash
npm install
npm run db:migrate:remote
npm run deploy
```

## Worker entrypoint

```text
src/app-v101.ts
```

## 目前分支

`agent/registration-v1-foundation`

## 下一階段

1. 建立正式 `class_db`、套 migration、部署 staging 實機測試
2. 將 policy / refunds / reminders 快捷入口直接掛到活動儀表板
3. 串 LINE / Email / SMS 通知 adapter
4. 付款 gateway adapter（LINE Pay / 藍新 / 綠界）
5. API scope 擴充到 registration / payment 等細權限
6. 完整 smoke test：免費、後付、先付、取消、退費、梯次、多人、掃碼報到
