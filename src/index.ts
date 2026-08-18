import type { CreateRegistrationInput, Env, PaymentStatus, RegistrationStatus } from './types';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function publicCode(prefix: string) {
  const now = new Date();
  const y = String(now.getUTCFullYear()).slice(-2);
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const tail = crypto.randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase();
  return `${prefix}-${y}${m}${d}-${tail}`;
}

async function getEvent(env: Env, eventId: string) {
  return env.CLASS_DB.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first<Record<string, any>>();
}

async function listEvents(env: Env) {
  return env.CLASS_DB.prepare(`
    SELECT id, tenant_key, title, slug, description, banner_url, location_name,
           starts_at, ends_at, registration_opens_at, registration_closes_at,
           capacity, identity_mode, registration_success_mode, attendee_data_mode,
           duplicate_rule, status
    FROM events
    WHERE status = 'published'
    ORDER BY starts_at IS NULL, starts_at ASC, created_at DESC
  `).all();
}

async function eventDetail(env: Env, eventId: string) {
  const event = await getEvent(env, eventId);
  if (!event) return null;

  const [sessions, items, fields] = await Promise.all([
    env.CLASS_DB.prepare('SELECT * FROM event_sessions WHERE event_id = ? AND is_active = 1 ORDER BY sort_order, starts_at').bind(eventId).all(),
    env.CLASS_DB.prepare('SELECT * FROM event_items WHERE event_id = ? AND is_active = 1 ORDER BY sort_order, name').bind(eventId).all(),
    env.CLASS_DB.prepare('SELECT * FROM event_form_fields WHERE event_id = ? ORDER BY scope, sort_order, label').bind(eventId).all(),
  ]);

  return { event, sessions: sessions.results, items: items.results, fields: fields.results };
}

function validateIdentityMode(event: Record<string, any>, input: CreateRegistrationInput) {
  if (event.identity_mode === 'login_required' && input.identity?.type !== 'member') {
    throw new Error('此活動必須登入後才能報名');
  }
  if (event.identity_mode === 'guest_only' && input.identity?.type === 'member') {
    throw new Error('此活動採一般自行填寫模式');
  }
}

async function enforceDuplicateRule(env: Env, event: Record<string, any>, input: CreateRegistrationInput) {
  let sql = '';
  let value: string | undefined;

  if (event.duplicate_rule === 'member') {
    value = input.identity?.externalMemberId || input.externalMemberId;
    if (value) sql = `SELECT id FROM registrations WHERE event_id = ? AND external_member_id = ? AND registration_status NOT IN ('cancelled','expired') LIMIT 1`;
  } else if (event.duplicate_rule === 'phone') {
    value = input.contact.phone;
    if (value) sql = `SELECT id FROM registrations WHERE event_id = ? AND contact_phone = ? AND registration_status NOT IN ('cancelled','expired') LIMIT 1`;
  } else if (event.duplicate_rule === 'email') {
    value = input.contact.email;
    if (value) sql = `SELECT id FROM registrations WHERE event_id = ? AND contact_email = ? AND registration_status NOT IN ('cancelled','expired') LIMIT 1`;
  }

  if (sql && value) {
    const duplicate = await env.CLASS_DB.prepare(sql).bind(event.id, value).first();
    if (duplicate) throw new Error('此活動已有相同身份的有效報名紀錄');
  }
}

async function resolveIdentity(env: Env, event: Record<string, any>, input: CreateRegistrationInput) {
  if (!input.identity) return null;

  const tenant = event.tenant_key || 'default';
  const identity = input.identity;

  if (identity.type === 'member' && identity.provider && identity.externalMemberId) {
    const existing = await env.CLASS_DB.prepare(
      'SELECT id FROM identities WHERE tenant_key = ? AND provider = ? AND external_member_id = ? LIMIT 1'
    ).bind(tenant, identity.provider, identity.externalMemberId).first<{ id: string }>();

    if (existing) return existing.id;
  }

  const identityId = id('idn');
  await env.CLASS_DB.prepare(`
    INSERT INTO identities
      (id, tenant_key, identity_type, provider, external_member_id, display_name, phone, email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    identityId,
    tenant,
    identity.type,
    identity.provider || null,
    identity.externalMemberId || null,
    identity.displayName || input.contact.name || null,
    identity.phone || input.contact.phone || null,
    identity.email || input.contact.email || null,
  ).run();

  return identityId;
}

async function calculateItems(env: Env, eventId: string, sessionId: string | undefined, input: CreateRegistrationInput) {
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('請至少選擇一個報名項目');

  const ids = [...new Set(input.items.map((x) => x.itemId))];
  if (ids.length !== input.items.length) throw new Error('報名項目不可重複');

  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.CLASS_DB.prepare(`
    SELECT * FROM event_items
    WHERE event_id = ? AND is_active = 1 AND id IN (${placeholders})
  `).bind(eventId, ...ids).all<Record<string, any>>();

  if (rows.results.length !== ids.length) throw new Error('包含不存在或已停用的報名項目');

  let totalQuantity = 0;
  let totalAmount = 0;
  const normalized: Array<Record<string, any>> = [];

  for (const selected of input.items) {
    const row = rows.results.find((r) => r.id === selected.itemId)!;
    const qty = Number(selected.quantity);
    if (!Number.isInteger(qty) || qty < 0) throw new Error(`${row.name} 人數格式錯誤`);
    if (qty < Number(row.min_quantity || 0)) throw new Error(`${row.name} 至少需選 ${row.min_quantity}`);
    if (row.max_quantity != null && qty > Number(row.max_quantity)) throw new Error(`${row.name} 最多可選 ${row.max_quantity}`);
    if (row.session_id && row.session_id !== sessionId) throw new Error(`${row.name} 不屬於目前梯次`);
    if (qty === 0) continue;

    if (row.capacity != null) {
      const used = await env.CLASS_DB.prepare(`
        SELECT COALESCE(SUM(ri.quantity), 0) AS used
        FROM registration_items ri
        JOIN registrations r ON r.id = ri.registration_id
        WHERE ri.item_id = ? AND r.registration_status IN ('pending_payment','confirmed','checked_in')
      `).bind(row.id).first<{ used: number }>();
      if (Number(used?.used || 0) + qty > Number(row.capacity)) throw new Error(`${row.name} 剩餘名額不足`);
    }

    const subtotal = Number(row.unit_price) * qty;
    totalQuantity += qty;
    totalAmount += subtotal;
    normalized.push({ row, quantity: qty, subtotal });
  }

  if (totalQuantity <= 0) throw new Error('報名總人數必須大於 0');
  return { normalized, totalQuantity, totalAmount };
}

async function enforceCapacity(env: Env, event: Record<string, any>, sessionId: string | undefined, quantity: number) {
  if (event.capacity != null) {
    const used = await env.CLASS_DB.prepare(`
      SELECT COALESCE(SUM(total_quantity), 0) AS used
      FROM registrations
      WHERE event_id = ? AND registration_status IN ('pending_payment','confirmed','checked_in')
    `).bind(event.id).first<{ used: number }>();
    if (Number(used?.used || 0) + quantity > Number(event.capacity)) throw new Error('活動剩餘名額不足');
  }

  if (sessionId) {
    const session = await env.CLASS_DB.prepare('SELECT * FROM event_sessions WHERE id = ? AND event_id = ? AND is_active = 1').bind(sessionId, event.id).first<Record<string, any>>();
    if (!session) throw new Error('梯次不存在或已停用');
    if (session.capacity != null) {
      const used = await env.CLASS_DB.prepare(`
        SELECT COALESCE(SUM(total_quantity), 0) AS used
        FROM registrations
        WHERE session_id = ? AND registration_status IN ('pending_payment','confirmed','checked_in')
      `).bind(sessionId).first<{ used: number }>();
      if (Number(used?.used || 0) + quantity > Number(session.capacity)) throw new Error('此梯次剩餘名額不足');
    }
  }
}

function initialStatuses(event: Record<string, any>, amount: number): { registrationStatus: RegistrationStatus; paymentStatus: PaymentStatus; expiresAt: string | null } {
  if (amount === 0 || event.registration_success_mode === 'free') {
    return { registrationStatus: 'confirmed', paymentStatus: 'not_required', expiresAt: null };
  }
  if (event.registration_success_mode === 'register_then_pay') {
    return { registrationStatus: 'confirmed', paymentStatus: 'unpaid', expiresAt: null };
  }
  const minutes = Number(event.payment_hold_minutes || 15);
  return {
    registrationStatus: 'pending_payment',
    paymentStatus: 'unpaid',
    expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
  };
}

async function createRegistration(env: Env, eventId: string, input: CreateRegistrationInput) {
  const event = await getEvent(env, eventId);
  if (!event || event.status !== 'published') throw new Error('活動不存在或尚未開放報名');
  if (!input.contact?.name?.trim()) throw new Error('請填寫聯絡人姓名');

  validateIdentityMode(event, input);
  await enforceDuplicateRule(env, event, input);

  const calculated = await calculateItems(env, eventId, input.sessionId, input);
  await enforceCapacity(env, event, input.sessionId, calculated.totalQuantity);

  const identityId = await resolveIdentity(env, event, input);
  const registrationId = id('reg');
  const registrationNo = publicCode('REG');
  const accessToken = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const orderId = id('ord');
  const orderNo = publicCode('ORD');
  const statuses = initialStatuses(event, calculated.totalAmount);

  const statements = [
    env.CLASS_DB.prepare(`
      INSERT INTO registrations
        (id, registration_no, access_token, tenant_key, event_id, session_id, identity_id,
         external_source, external_member_id, contact_name, contact_phone, contact_email,
         total_quantity, total_amount, registration_status, payment_status, expires_at, custom_data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      registrationId, registrationNo, accessToken, event.tenant_key || 'default', eventId,
      input.sessionId || null, identityId, input.externalSource || null,
      input.identity?.externalMemberId || input.externalMemberId || null,
      input.contact.name.trim(), input.contact.phone || null, input.contact.email || null,
      calculated.totalQuantity, calculated.totalAmount, statuses.registrationStatus,
      statuses.paymentStatus, statuses.expiresAt, JSON.stringify(input.customData || {}),
    ),
    env.CLASS_DB.prepare(`
      INSERT INTO orders
        (id, order_no, registration_id, original_amount, discount_amount, payable_amount, payment_status)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).bind(orderId, orderNo, registrationId, calculated.totalAmount, calculated.totalAmount, statuses.paymentStatus),
  ];

  for (const line of calculated.normalized) {
    statements.push(env.CLASS_DB.prepare(`
      INSERT INTO registration_items
        (id, registration_id, item_id, item_name_snapshot, unit_price_snapshot, unit_label_snapshot, quantity, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id('rgi'), registrationId, line.row.id, line.row.name, line.row.unit_price,
      line.row.unit_label || '人', line.quantity, line.subtotal,
    ));
  }

  for (const attendee of input.attendees || []) {
    statements.push(env.CLASS_DB.prepare(`
      INSERT INTO registration_attendees
        (id, registration_id, item_id, attendee_index, name, phone, email, custom_data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id('att'), registrationId, attendee.itemId || null, attendee.attendeeIndex,
      attendee.name || null, attendee.phone || null, attendee.email || null,
      JSON.stringify(attendee.customData || {}),
    ));
  }

  await env.CLASS_DB.batch(statements);

  return {
    registrationId,
    registrationNo,
    accessToken,
    orderId,
    orderNo,
    totalQuantity: calculated.totalQuantity,
    totalAmount: calculated.totalAmount,
    registrationStatus: statuses.registrationStatus,
    paymentStatus: statuses.paymentStatus,
    expiresAt: statuses.expiresAt,
  };
}

async function getRegistrationByToken(env: Env, token: string) {
  const reg = await env.CLASS_DB.prepare(`
    SELECT r.*, e.title AS event_title, e.location_name, e.starts_at AS event_starts_at,
           o.order_no, o.payable_amount, o.payment_method AS order_payment_method
    FROM registrations r
    JOIN events e ON e.id = r.event_id
    LEFT JOIN orders o ON o.registration_id = r.id
    WHERE r.access_token = ?
    LIMIT 1
  `).bind(token).first<Record<string, any>>();
  if (!reg) return null;

  const items = await env.CLASS_DB.prepare('SELECT * FROM registration_items WHERE registration_id = ? ORDER BY id').bind(reg.id).all();
  return { registration: reg, items: items.results };
}

async function cancelRegistration(env: Env, token: string) {
  const current = await env.CLASS_DB.prepare('SELECT id, registration_status FROM registrations WHERE access_token = ?').bind(token).first<Record<string, any>>();
  if (!current) throw new Error('找不到報名資料');
  if (['cancelled','checked_in'].includes(current.registration_status)) throw new Error('目前狀態不可取消');

  await env.CLASS_DB.prepare(`
    UPDATE registrations
    SET registration_status = 'cancelled', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(current.id).run();
  return { success: true };
}

function home(env: Env) {
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${env.APP_NAME}</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;color:#1f2937;margin:0}.wrap{max-width:760px;margin:56px auto;padding:24px}.card{background:white;border-radius:18px;padding:28px;box-shadow:0 10px 30px rgba(0,0,0,.06)}h1{margin-top:0}code{background:#f1f5f9;padding:3px 7px;border-radius:6px}.ok{display:inline-block;background:#dcfce7;color:#166534;padding:6px 10px;border-radius:999px;font-weight:700}</style></head><body><div class="wrap"><div class="card"><span class="ok">V1 foundation ready</span><h1>Class Registration Engine</h1><p>萬用活動報名引擎基線已啟動。</p><p>核心支援：Login / Guest / Hybrid、免費、後付、付款後成立、梯次、項目 × 單價 × 人數。</p><p>API：<code>GET /api/v1/events</code></p></div></div></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (request.method === 'GET' && path === '/') return home(env);
      if (request.method === 'GET' && path === '/health') return json({ success: true, service: env.APP_NAME, version: '0.1.0' });

      if (request.method === 'GET' && path === '/api/v1/events') {
        const rows = await listEvents(env);
        return json({ success: true, events: rows.results });
      }

      const eventMatch = path.match(/^\/api\/v1\/events\/([^/]+)$/);
      if (request.method === 'GET' && eventMatch) {
        const detail = await eventDetail(env, eventMatch[1]);
        if (!detail) return json({ success: false, error: '活動不存在' }, 404);
        return json({ success: true, ...detail });
      }

      const registerMatch = path.match(/^\/api\/v1\/events\/([^/]+)\/registrations$/);
      if (request.method === 'POST' && registerMatch) {
        const body = await request.json<CreateRegistrationInput>();
        const result = await createRegistration(env, registerMatch[1], body);
        return json({ success: true, ...result }, 201);
      }

      const regMatch = path.match(/^\/api\/v1\/registrations\/token\/([^/]+)$/);
      if (request.method === 'GET' && regMatch) {
        const result = await getRegistrationByToken(env, regMatch[1]);
        if (!result) return json({ success: false, error: '找不到報名資料' }, 404);
        return json({ success: true, ...result });
      }

      const cancelMatch = path.match(/^\/api\/v1\/registrations\/token\/([^/]+)\/cancel$/);
      if (request.method === 'POST' && cancelMatch) {
        const result = await cancelRegistration(env, cancelMatch[1]);
        return json(result);
      }

      return json({ success: false, error: 'Not Found' }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : '系統錯誤';
      return json({ success: false, error: message }, 400);
    }
  },
};
