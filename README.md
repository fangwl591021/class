# Class Registration Engine

萬用活動報名引擎。目標是作為獨立可運行產品，同時可透過 API 串接其他專案，或完整 1:1 複刻成另一套品牌系統。

## V1 核心模型

- Identity：會員登入 / Guest 自行填寫 / Hybrid 混合模式
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
3. `pay_then_confirm`：先進入待付款，付款完成後才正式成功；可設定暫留名額分鐘數。

## Identity 模式

- `login_required`：必須登入會員後報名。
- `guest_only`：不登入，一般自行填寫。
- `hybrid`：登入快速報名或自行填寫都可以。

## 目前可操作頁面

- `/`：系統首頁
- `/events`：公開活動列表
- `/event/:eventId`：V0.5 動態手機報名頁
- `/registration/:accessToken`：報名完成 / 查詢 / 取消 / 匯款回報
- `/admin`：活動管理後台
- `/admin/event/:eventId`：活動儀表板、梯次、名單、收款確認
- `/admin/event/:eventId/config`：進階設定（梯次專屬項目、自訂欄位、報到）
- `/my`：外部會員 / LINE Identity 的「我的報名」測試入口

## V0.5 已完成

- 活動、梯次、項目、報名、訂單、付款、報到資料結構
- 項目 × 單價 × 人數，價格由後端重新計算
- 活動總名額 / 梯次名額 / 項目名額
- Login / Guest / Hybrid
- 免費 / 先報名後付款 / 付款完成才成功
- `pay_then_confirm` 暫留名額與逾時自動失效
- 參加者資料模式：只填聯絡人 / 每位姓名 / 每位完整資料
- 匯款銀行、銀行代碼、帳號、戶名
- Guest 回報匯款末五碼
- 管理員確認收款
- 確認收款後，`pay_then_confirm` 自動由 `pending_payment` 轉 `confirmed`
- 活動管理儀表板：報名人數、已收金額、待付款筆數、名單
- 每個梯次可建立自己的報名項目 / 價位 / 項目名額
- 自訂報名欄位 Builder：聯絡人欄位或每位參加者欄位
- **自訂欄位已真正渲染至公開報名頁，並寫入 `custom_data_json`**
- `select / radio / checkbox / textarea / text / tel / email / date / number` 前台欄位
- 必填自訂欄位由後端再次驗證，不能只靠瀏覽器前端
- 多人報名時依「項目 × 人數」自動展開每位參加者資料
- 不同梯次切換時，只顯示「共用項目 + 該梯次專屬項目」
- 外部會員「我的報名」查詢 API 與測試頁
- 以 `registration_no` 進行現場快速報到
- Worker 入口已切至 `src/app-v05.ts`，V0.5 包裝 V0.4 / V0.3，避免破壞既有核心

## API V1

公開 API：

- `GET /health`
- `GET /api/v1/events`
- `GET /api/v1/events/:eventId`
- `POST /api/v1/events/:eventId/registrations`
- `GET /api/v1/registrations/token/:accessToken`
- `POST /api/v1/registrations/token/:accessToken/cancel`
- `POST /api/v1/registrations/token/:accessToken/bank-transfer`
- `GET /api/v1/member/:provider/:externalMemberId/registrations?tenant=default`

管理 API：

- `GET /api/v1/admin/events`
- `POST /api/v1/admin/events`
- `GET /api/v1/admin/events/:eventId/dashboard`
- `POST /api/v1/admin/events/:eventId/sessions`
- `POST /api/v1/admin/events/:eventId/items`
- `GET /api/v1/admin/events/:eventId/fields`
- `POST /api/v1/admin/events/:eventId/fields`
- `DELETE /api/v1/admin/events/:eventId/fields/:fieldId`
- `POST /api/v1/admin/registrations/:registrationId/confirm-payment`
- `POST /api/v1/admin/checkin/:registrationNo`

> 注意：管理 API 與目前 `/my` provider/memberId 查詢仍屬開發模式。正式對外前必須加入管理員驗證、Identity token、API Key 與 tenant 隔離，不能讓外部直接靠 Member ID 查詢。

## 建立報名範例

```json
{
  "identity": {
    "type": "guest",
    "displayName": "王小明",
    "phone": "0912345678"
  },
  "contact": {
    "name": "王小明",
    "phone": "0912345678",
    "email": "demo@example.com"
  },
  "items": [
    { "itemId": "item_member", "quantity": 2 },
    { "itemId": "item_guest", "quantity": 1 }
  ],
  "customData": {
    "company": "範例公司"
  },
  "attendees": [
    {
      "itemId": "item_member",
      "attendeeIndex": 1,
      "name": "王小明",
      "customData": { "meal": "葷食" }
    },
    {
      "itemId": "item_member",
      "attendeeIndex": 2,
      "name": "王小華",
      "customData": { "meal": "素食" }
    }
  ]
}
```

前端/API 呼叫端只傳 `itemId + quantity`，不得傳入可信任總金額。後端會依資料庫單價重新計算。

## D1

建立資料庫後，把 `wrangler.toml` 的 `database_id` 改成實際 D1 ID。

```bash
npx wrangler d1 create class_db
npm install
npm run db:migrate:local
npm run dev
```

遠端 migration：

```bash
npm run db:migrate:remote
```

目前 migration：

- `0001_initial.sql`
- `0002_payment_sessions.sql`

## 目前分支

`agent/registration-v1-foundation`

## 下一階段

1. LINE Login / TDEA / 外部會員 Identity Adapter
2. 管理員 Login / 權限
3. API Key / tenant 隔離，提供其他專案安全串接
4. QR Code 視覺票券與手機掃碼報到頁
5. 付款 gateway adapter（LINE Pay / 藍新 / 綠界）
6. 後台項目編輯 / 停用 / 排序
7. 匯出 Excel / CSV 報名名單
8. 取消 / 退費規則與付款期限提醒
