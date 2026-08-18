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
- `/ticket/:accessToken`：電子票券 / QR Code
- `/login?return=/event/:eventId`：登入入口
- `/auth/line/start`：LINE Login 起點
- `/auth/line/callback`：LINE Login callback
- `/auth/handoff?code=...`：外部會員一次性登入交接
- `/my`：登入會員真正的「我的報名」
- `/admin/login`：管理員登入
- `/admin`：活動管理後台
- `/admin/event/:eventId`：活動儀表板、梯次、名單、收款確認
- `/admin/event/:eventId/config`：進階設定（梯次專屬項目、自訂欄位、報到）
- `/admin/api-clients`：API Client 建立 / 停用

## V0.7.1 已完成

### 報名核心

- 活動、梯次、項目、報名、訂單、付款、報到資料結構
- 項目 × 單價 × 人數，價格由後端重新計算
- 活動總名額 / 梯次名額 / 項目名額
- Login / Guest / Hybrid
- 免費 / 先報名後付款 / 付款完成才成功
- `pay_then_confirm` 暫留名額與逾時自動失效
- 每位參加者資料、自訂欄位 Builder、前台動態渲染與後端必填驗證
- 匯款回報 / 管理員確認收款
- 每梯次可有自己的報名項目 / 價位 / 名額
- registration_no 現場快速報到

### Identity / API / Security

- 管理員 `ADMIN_TOKEN` 保護層
- API Client 綁定 tenant，API Key 只保存 SHA-256 hash
- Identity Session / Identity Token
- `X-Class-Identity-Token` 報名身份注入
- Identity tenant 與 Event tenant 強制一致
- LINE Login OAuth 2.1 基線
- Integration audit log
- API Client 管理 UI：建立 / 停用，API Key 只在建立當下顯示一次
- 外部會員一次性 Browser Handoff
- Handoff code 短效、一次性，identity token 不直接出現在 URL
- Handoff 成功後建立獨立瀏覽器 Identity Session，不破壞 Server-to-Server identity token
- `/my` 直接使用登入 cookie 顯示該會員的報名紀錄，不再手工輸入 Member ID
- TDEA Identity Adapter 串接文件：`docs/TDEA_IDENTITY_ADAPTER.md`

### 電子票券

- `/ticket/:accessToken` 顯示活動、報名編號、姓名、人數、付款 / 報名狀態
- 票券 QR Code 內容只使用 `registration_no`，不把 private access token 放進 QR
- `confirmed / checked_in` 顯示有效票券；待付款 / 失效狀態不視為可報到

## Integration API

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

外部系統將瀏覽器導向回傳的 `/auth/handoff?code=...`，Class 便會建立 HttpOnly identity cookie 並返回指定活動頁。

完整 TDEA 流程請看：`docs/TDEA_IDENTITY_ADAPTER.md`。

## 管理 API / Integration API

- `POST /api/v1/admin/api-clients`
- `POST /api/v1/admin/api-clients/:clientId/disable`
- `GET /api/v1/integration/events`
- `POST /api/v1/integration/identity/session`
- `POST /api/v1/integration/identity/handoff`

其他既有活動、報名、付款、梯次、欄位與報到 API 保留。

## LINE Login 設定

正式啟用前需設定：

- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_SECRET`
- `LINE_REDIRECT_URI`

正式環境務必設定：

```bash
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
```

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
- `0004_identity_handoff.sql`

## Worker entrypoint

目前：

```text
src/app-v071.ts
```

V0.7.1 以 wrapper 方式保留既有核心並補強外部登入 handoff 與管理端路由保護。

## 目前分支

`agent/registration-v1-foundation`

## 下一階段

1. QR 掃碼專用報到頁 / 相機掃描
2. API Key 金鑰輪替
3. 後台項目編輯 / 停用 / 排序
4. CSV / Excel 名單匯出
5. 付款 gateway adapter（LINE Pay / 藍新 / 綠界）
6. 取消 / 退費規則
7. 付款期限 / 未付款提醒
8. 正式建立 D1、套 migration、staging 實機測試
