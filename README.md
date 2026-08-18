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

## V0.10.1 已完成

- 項目 × 單價 × 人數
- 活動 / 梯次 / 項目三層名額
- 免費 / 後付 / 付款完成才成立
- 多人參加者資料與自訂欄位
- LINE Login / 外部 Identity Adapter / Browser Handoff
- 匯款回報與後台確認收款
- 取消政策、已付款取消策略、付款期限
- 退費申請管理與已退費 / 駁回流程
- 未付款提醒作業台
- 電子票券 / QR Code / 掃碼報到
- CSV 中文名單匯出
- API Client / tenant / scope / Key 輪替

## 主要後台頁面

- `/admin`
- `/admin/event/:eventId`
- `/admin/event/:eventId/config`
- `/admin/event/:eventId/items`
- `/admin/event/:eventId/policy`
- `/admin/refunds`
- `/admin/reminders`
- `/admin/api-clients`
- `/admin/checkin`

## 取消 / 退費 / 付款期限

活動管理員可在 `/admin/event/:eventId/policy` 設定：

- 是否允許自行取消
- 活動開始前幾小時停止自行取消
- 已付款取消後：人工退費 / 不退費 / 禁止自行取消
- `register_then_pay` 報名後幾天內必須付款

退費管理 `/admin/refunds`：

- 顯示活動、報名編號、聯絡人、退費金額、原因
- 可標記已退費或駁回
- 保存處理時間與備註
- 已退費時同步更新 Registration / Order 為 `refunded`
- 處理備註直接在頁面內輸入，不使用瀏覽器原生 prompt

未付款提醒 `/admin/reminders`：

- 顯示 24 小時內付款到期、尚未付款、尚未提醒的報名
- 顯示手機 / Email / 金額 / 付款期限
- 可標記已提醒

## Integration API

- `GET /api/v1/integration/events` → `events:read`
- Identity Session / Handoff → `identity:write`

## 管理 API

- `GET /api/v1/admin/refunds`
- `POST /api/v1/admin/refunds/:refundId/approve`
- `POST /api/v1/admin/refunds/:refundId/reject`
- `GET /api/v1/admin/events/:eventId/policy`
- `POST /api/v1/admin/events/:eventId/policy`
- `GET /api/v1/admin/reminders/due`
- `POST /api/v1/admin/registrations/:registrationId/reminder-sent`

## D1 migrations

- `0001_initial.sql`
- `0002_payment_sessions.sql`
- `0003_integrations_security.sql`
- `0004_identity_handoff.sql`
- `0005_cancellation_reminders.sql`
- `0006_refund_processing.sql`（compatibility no-op）

`refund_requests` 的 `requested_at / processed_at / processed_by / note` 已在 0005 建立，因此 0006 不再重複 ALTER，避免 migration 衝突。

## Worker entrypoint

```text
src/app-v101.ts
```

## 正式部署前必要條件

`wrangler.toml` 目前仍是：

```text
database_id = "REPLACE_WITH_CLASS_DB_ID"
```

正式部署前必須先建立 `class_db`，填入實際 D1 database ID，再套 migration。

```bash
npm install
npm run db:migrate:remote
npm run deploy
```

## 目前分支

`agent/registration-v1-foundation`

## 下一階段

1. 建立正式 `class_db`、套 migration、部署 staging 實機測試
2. 將 policy / refunds / reminders 快捷入口掛到活動儀表板
3. 串 LINE / Email / SMS 通知 adapter
4. 付款 gateway adapter（LINE Pay / 藍新 / 綠界）
5. API scope 擴充到 registration / payment 等細權限
6. 完整 smoke test：免費、後付、先付、取消、退費、梯次、多人、掃碼報到
