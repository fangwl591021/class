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

## API V1

- `GET /health`
- `GET /api/v1/events`
- `GET /api/v1/events/:eventId`
- `POST /api/v1/events/:eventId/registrations`
- `GET /api/v1/registrations/token/:accessToken`
- `POST /api/v1/registrations/token/:accessToken/cancel`

### 建立報名範例

```json
{
  "sessionId": "ses_demo",
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
  ]
}
```

> 注意：前端/API 呼叫端只傳 `itemId + quantity`，不得傳入可信任總金額。後端會依資料庫單價重新計算。

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

## 目前分支

`agent/registration-v1-foundation`

目前完成 V1 foundation：資料庫 schema、報名核心 API、Login/Guest/Hybrid 身分模型、三種報名成立模式、梯次、項目 × 單價 × 人數、名額檢查、訂單與報名快照。

下一階段：活動管理後台、實際報名 UI、付款設定/匯款確認、我的報名與 QR 報到。
