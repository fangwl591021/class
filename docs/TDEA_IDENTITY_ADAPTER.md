# TDEA Identity Adapter 串接範例

目的：TDEA 使用者已在原系統登入後，不要再到 Class 重複登入。

## 流程

1. TDEA Server 以自己的會員機制確認登入者。
2. TDEA Server 使用自己的 `X-API-Key` 呼叫 Class：

```http
POST /api/v1/integration/identity/session
X-API-Key: cls_xxxxx
Content-Type: application/json

{
  "provider": "tdea",
  "externalMemberId": "TDEA_MEMBER_123",
  "displayName": "王小明",
  "phone": "0912345678",
  "email": "demo@example.com"
}
```

3. Class 回傳短期 `identityToken`。
4. TDEA Server 再建立一次性 Browser Handoff：

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

5. Class 回傳：

```json
{
  "success": true,
  "handoffCode": "hnd_xxxxx",
  "handoffUrl": "/auth/handoff?code=hnd_xxxxx",
  "expiresAt": "..."
}
```

6. TDEA 前端只需將瀏覽器導向 Class 網域的 `handoffUrl`。
7. Class 驗證一次性 code 後建立 HttpOnly `class_identity` cookie，再導向指定活動頁。
8. 使用者報名時，Class 後端會以已驗證 identity 覆蓋前端自行傳入的 member id。

## 安全原則

- API Key 只能存在 TDEA Server，不可放在瀏覽器 JavaScript。
- `identityToken` 不應直接放在 URL。
- Browser Handoff code 為一次性且預設短效。
- Handoff 使用後會建立新的瀏覽器 identity session，不會破壞原 Server-to-Server identity token。
- API Client 綁定 tenant，Identity tenant 與 Event tenant 必須一致。

## TDEA 最終體驗

```text
TDEA 已登入會員
→ 點「活動報名」
→ TDEA Server 建立 Class Identity Session
→ 建立一次性 Handoff
→ 瀏覽器進 Class 活動頁
→ Class 顯示「已登入：會員姓名」
→ 直接選 項目 × 價位 × 人數
→ 報名 / 付款
```

因此 TDEA 可以保留自己的會員系統，Class 專心負責活動、梯次、項目、報名、訂單、付款與報到。
