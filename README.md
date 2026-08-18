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
- `/event/:eventId`：動態手機報名頁
- `/registration/:accessToken`：報名完成 / 查詢 / 取消 / 匯款回報
- `/login?return=/event/:eventId`：登入入口
- `/auth/line/start`：LINE Login 起點
- `/auth/line/callback`：LINE Login callback
- `/admin/login`：管理員登入
- `/admin`：活動管理後台
- `/admin/event/:eventId`：活動儀表板、梯次、名單、收款確認
- `/admin/event/:eventId/config`：進階設定（梯次專屬項目、自訂欄位、報到）
- `/my`：外部會員「我的報名」測試入口

## V0.6 已完成

### 報名核心

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
- 每個梯次可建立自己的報名項目 / 價位 / 項目名額
- 自訂報名欄位 Builder
- 自訂欄位真正渲染至公開報名頁並寫入 `custom_data_json`
- 必填欄位由後端再次驗證
- 多人報名依「項目 × 人數」自動展開參加者資料
- 以 `registration_no` 進行現場快速報到

### V0.6 Identity / API / Security

- 管理員驗證層：正式環境可使用 `ADMIN_TOKEN` Cloudflare secret
- `/admin/login` 登入後使用 HttpOnly / Secure / SameSite cookie
- 管理 API 同時支援 `Authorization: Bearer <ADMIN_TOKEN>`
- 新增 `api_clients`：不同 tenant 可有不同 API Key
- API Key 僅保存 SHA-256 hash，不保存明文
- 新增 `identity_sessions`：外部專案可以把「已驗證會員」安全轉交給 Class
- Identity Token 僅保存 SHA-256 hash，瀏覽器 / 呼叫端持有原始 token
- 新增 `integration_audit_logs` 留下外部身份 session 建立紀錄
- 外部 API Key 自動綁定 `tenant_key`
- 報名送出時可使用 `X-Class-Identity-Token`，後端自動注入已驗證會員身份
- Identity tenant 與 Event tenant 必須一致，避免跨租戶使用身份
- Hybrid 活動未登入時仍可自行填寫，登入後會顯示會員身份
- `login_required` 活動未登入時會導向 `/login`
- LINE Login OAuth 2.1 基線已完成：authorize → callback → token exchange → LINE profile → Class identity session
- LINE Login 建立的 Class identity cookie 為 HttpOnly / Secure / SameSite=Lax

## API V1

### 公開 API

- `GET /health`
- `GET /api/v1/events`
- `GET /api/v1/events/:eventId`
- `POST /api/v1/events/:eventId/registrations`
- `GET /api/v1/registrations/token/:accessToken`
- `POST /api/v1/registrations/token/:accessToken/cancel`
- `POST /api/v1/registrations/token/:accessToken/bank-transfer`
- `GET /api/v1/member/:provider/:externalMemberId/registrations?tenant=default`（開發 / 相容入口，正式串接優先使用 Identity Token）

### 管理 API

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
- `POST /api/v1/admin/api-clients`

### Integration API

取得目前 API Key tenant 的公開活動：

```http
GET /api/v1/integration/events
X-API-Key: cls_xxxxx
```

外部系統已確認會員身份後，建立 Class Identity Session：

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

回傳：

```json
{
  "success": true,
  "identityToken": "ids_...",
  "expiresAt": "...",
  "tenantKey": "default"
}
```

之後報名時可以：

```http
POST /api/v1/events/:eventId/registrations
X-Class-Identity-Token: ids_xxxxx
Content-Type: application/json
```

Class 會以伺服器端 Identity Session 覆蓋呼叫端自行聲稱的會員身份，避免外部直接偽造 `externalMemberId`。

## LINE Login 設定

正式啟用前需設定：

- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_SECRET`
- `LINE_REDIRECT_URI`

其中 `LINE_CHANNEL_SECRET` 建議用 Cloudflare secret：

```bash
npx wrangler secret put LINE_CHANNEL_SECRET
```

`LINE_REDIRECT_URI` 應設定成實際 Worker 網址，例如：

```text
https://class.example.com/auth/line/callback
```

## 管理員驗證

正式環境務必設定：

```bash
npx wrangler secret put ADMIN_TOKEN
```

如果未設定 `ADMIN_TOKEN`，V0.6 為方便本機 / staging 開發，管理頁仍保持開放；正式環境不可維持此狀態。

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
- `0003_integrations_security.sql`

## Worker entrypoint

目前：

```text
src/app-v06.ts
```

V0.6 以 wrapper 方式包住 V0.5 / V0.4 / V0.3，盡量避免破壞已完成的報名核心。

## 目前分支

`agent/registration-v1-foundation`

## 下一階段

1. 管理後台加入 API Client 建立 / 停用 / 金鑰輪替 UI
2. LINE Login 登入後真正顯示「我的報名」而不是手工輸入 Member ID
3. TDEA Identity Adapter 實際串接範例
4. QR Code 視覺票券與手機掃碼報到頁
5. 付款 gateway adapter（LINE Pay / 藍新 / 綠界）
6. 後台項目編輯 / 停用 / 排序
7. 匯出 Excel / CSV 報名名單
8. 取消 / 退費規則與付款期限提醒
