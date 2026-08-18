import type { CreateRegistrationInput, Env, PaymentStatus, RegistrationStatus } from './types';
import { renderAdminPage, renderEventList, renderEventPage, renderHome, renderRegistrationPage } from './ui';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: jsonHeaders });
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
const slugify = (s: string) => (s || 'event').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fff-]/g, '').slice(0, 60) || 'event';
function publicCode(prefix: string) { const n = new Date(); const y = String(n.getUTCFullYear()).slice(-2); const m = String(n.getUTCMonth() + 1).padStart(2, '0'); const d = String(n.getUTCDate()).padStart(2, '0'); return `${prefix}-${y}${m}${d}-${crypto.randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`; }

async function getEvent(env: Env, eventId: string) { return env.CLASS_DB.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first<Record<string, any>>(); }
async function listEvents(env: Env, all = false) {
  return env.CLASS_DB.prepare(`SELECT id,tenant_key,title,slug,description,banner_url,location_name,starts_at,ends_at,registration_opens_at,registration_closes_at,capacity,identity_mode,registration_success_mode,attendee_data_mode,duplicate_rule,status,created_at FROM events ${all ? '' : "WHERE status='published'"} ORDER BY starts_at IS NULL, starts_at ASC, created_at DESC`).all();
}
async function eventDetail(env: Env, eventId: string) {
  const event = await getEvent(env, eventId); if (!event) return null;
  const [sessions, items, fields] = await Promise.all([
    env.CLASS_DB.prepare('SELECT * FROM event_sessions WHERE event_id=? AND is_active=1 ORDER BY sort_order,starts_at').bind(eventId).all(),
    env.CLASS_DB.prepare('SELECT * FROM event_items WHERE event_id=? AND is_active=1 ORDER BY sort_order,name').bind(eventId).all(),
    env.CLASS_DB.prepare('SELECT * FROM event_form_fields WHERE event_id=? ORDER BY scope,sort_order,label').bind(eventId).all(),
  ]); return { event, sessions: sessions.results, items: items.results, fields: fields.results };
}

function validateIdentityMode(event: Record<string, any>, input: CreateRegistrationInput) {
  if (event.identity_mode === 'login_required' && input.identity?.type !== 'member') throw new Error('此活動必須登入後才能報名');
  if (event.identity_mode === 'guest_only' && input.identity?.type === 'member') throw new Error('此活動採一般自行填寫模式');
}
async function enforceDuplicateRule(env: Env, event: Record<string, any>, input: CreateRegistrationInput) {
  let sql = '', value: string | undefined;
  if (event.duplicate_rule === 'member') { value = input.identity?.externalMemberId || input.externalMemberId; if (value) sql = `SELECT id FROM registrations WHERE event_id=? AND external_member_id=? AND registration_status NOT IN ('cancelled','expired') LIMIT 1`; }
  if (event.duplicate_rule === 'phone') { value = input.contact.phone; if (value) sql = `SELECT id FROM registrations WHERE event_id=? AND contact_phone=? AND registration_status NOT IN ('cancelled','expired') LIMIT 1`; }
  if (event.duplicate_rule === 'email') { value = input.contact.email; if (value) sql = `SELECT id FROM registrations WHERE event_id=? AND contact_email=? AND registration_status NOT IN ('cancelled','expired') LIMIT 1`; }
  if (sql && value && await env.CLASS_DB.prepare(sql).bind(event.id, value).first()) throw new Error('此活動已有相同身份的有效報名紀錄');
}
async function resolveIdentity(env: Env, event: Record<string, any>, input: CreateRegistrationInput) {
  if (!input.identity) return null; const tenant = event.tenant_key || 'default', identity = input.identity;
  if (identity.type === 'member' && identity.provider && identity.externalMemberId) { const old = await env.CLASS_DB.prepare('SELECT id FROM identities WHERE tenant_key=? AND provider=? AND external_member_id=? LIMIT 1').bind(tenant, identity.provider, identity.externalMemberId).first<{id:string}>(); if (old) return old.id; }
  const identityId = uid('idn'); await env.CLASS_DB.prepare(`INSERT INTO identities(id,tenant_key,identity_type,provider,external_member_id,display_name,phone,email) VALUES(?,?,?,?,?,?,?,?)`).bind(identityId, tenant, identity.type, identity.provider || null, identity.externalMemberId || null, identity.displayName || input.contact.name || null, identity.phone || input.contact.phone || null, identity.email || input.contact.email || null).run(); return identityId;
}
async function calculateItems(env: Env, eventId: string, sessionId: string | undefined, input: CreateRegistrationInput) {
  if (!Array.isArray(input.items) || !input.items.length) throw new Error('請至少選擇一個報名項目');
  const ids = [...new Set(input.items.map(x => x.itemId))]; if (ids.length !== input.items.length) throw new Error('報名項目不可重複');
  const rows = await env.CLASS_DB.prepare(`SELECT * FROM event_items WHERE event_id=? AND is_active=1 AND id IN (${ids.map(()=>'?').join(',')})`).bind(eventId, ...ids).all<Record<string, any>>(); if (rows.results.length !== ids.length) throw new Error('包含不存在或已停用的報名項目');
  let totalQuantity = 0, totalAmount = 0; const normalized: Array<Record<string, any>> = [];
  for (const selected of input.items) { const row = rows.results.find(r => r.id === selected.itemId)!; const qty = Number(selected.quantity); if (!Number.isInteger(qty) || qty < 0) throw new Error(`${row.name} 人數格式錯誤`); if (qty < Number(row.min_quantity || 0)) throw new Error(`${row.name} 至少需選 ${row.min_quantity}`); if (row.max_quantity != null && qty > Number(row.max_quantity)) throw new Error(`${row.name} 最多可選 ${row.max_quantity}`); if (row.session_id && row.session_id !== sessionId) throw new Error(`${row.name} 不屬於目前梯次`); if (!qty) continue;
    if (row.capacity != null) { const used = await env.CLASS_DB.prepare(`SELECT COALESCE(SUM(ri.quantity),0) used FROM registration_items ri JOIN registrations r ON r.id=ri.registration_id WHERE ri.item_id=? AND r.registration_status IN ('pending_payment','confirmed','checked_in')`).bind(row.id).first<{used:number}>(); if (Number(used?.used || 0) + qty > Number(row.capacity)) throw new Error(`${row.name} 剩餘名額不足`); }
    const subtotal = Number(row.unit_price) * qty; totalQuantity += qty; totalAmount += subtotal; normalized.push({ row, quantity: qty, subtotal });
  } if (totalQuantity <= 0) throw new Error('報名總人數必須大於 0'); return { normalized, totalQuantity, totalAmount };
}
async function enforceCapacity(env: Env, event: Record<string, any>, sessionId: string | undefined, quantity: number) {
  if (event.capacity != null) { const used = await env.CLASS_DB.prepare(`SELECT COALESCE(SUM(total_quantity),0) used FROM registrations WHERE event_id=? AND registration_status IN ('pending_payment','confirmed','checked_in')`).bind(event.id).first<{used:number}>(); if (Number(used?.used || 0) + quantity > Number(event.capacity)) throw new Error('活動剩餘名額不足'); }
  if (sessionId) { const session = await env.CLASS_DB.prepare('SELECT * FROM event_sessions WHERE id=? AND event_id=? AND is_active=1').bind(sessionId,event.id).first<Record<string,any>>(); if (!session) throw new Error('梯次不存在或已停用'); if (session.capacity != null) { const used = await env.CLASS_DB.prepare(`SELECT COALESCE(SUM(total_quantity),0) used FROM registrations WHERE session_id=? AND registration_status IN ('pending_payment','confirmed','checked_in')`).bind(sessionId).first<{used:number}>(); if (Number(used?.used || 0) + quantity > Number(session.capacity)) throw new Error('此梯次剩餘名額不足'); } }
}
function initialStatuses(event: Record<string, any>, amount: number): {registrationStatus:RegistrationStatus,paymentStatus:PaymentStatus,expiresAt:string|null} {
  if (amount === 0 || event.registration_success_mode === 'free') return { registrationStatus:'confirmed', paymentStatus:'not_required', expiresAt:null };
  if (event.registration_success_mode === 'register_then_pay') return { registrationStatus:'confirmed', paymentStatus:'unpaid', expiresAt:null };
  return { registrationStatus:'pending_payment', paymentStatus:'unpaid', expiresAt:new Date(Date.now() + Number(event.payment_hold_minutes || 15) * 60000).toISOString() };
}
async function createRegistration(env: Env, eventId: string, input: CreateRegistrationInput) {
  const event = await getEvent(env,eventId); if (!event || event.status !== 'published') throw new Error('活動不存在或尚未開放報名'); if (!input.contact?.name?.trim()) throw new Error('請填寫聯絡人姓名'); validateIdentityMode(event,input); await enforceDuplicateRule(env,event,input);
  const calculated = await calculateItems(env,eventId,input.sessionId,input); await enforceCapacity(env,event,input.sessionId,calculated.totalQuantity); const identityId = await resolveIdentity(env,event,input);
  const registrationId=uid('reg'), registrationNo=publicCode('REG'), accessToken=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''), orderId=uid('ord'), orderNo=publicCode('ORD'), statuses=initialStatuses(event,calculated.totalAmount);
  const statements:any[]=[env.CLASS_DB.prepare(`INSERT INTO registrations(id,registration_no,access_token,tenant_key,event_id,session_id,identity_id,external_source,external_member_id,contact_name,contact_phone,contact_email,total_quantity,total_amount,registration_status,payment_status,expires_at,custom_data_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(registrationId,registrationNo,accessToken,event.tenant_key||'default',eventId,input.sessionId||null,identityId,input.externalSource||null,input.identity?.externalMemberId||input.externalMemberId||null,input.contact.name.trim(),input.contact.phone||null,input.contact.email||null,calculated.totalQuantity,calculated.totalAmount,statuses.registrationStatus,statuses.paymentStatus,statuses.expiresAt,JSON.stringify(input.customData||{})),env.CLASS_DB.prepare(`INSERT INTO orders(id,order_no,registration_id,original_amount,discount_amount,payable_amount,payment_status) VALUES(?,?,?, ?,0,?,?)`).bind(orderId,orderNo,registrationId,calculated.totalAmount,calculated.totalAmount,statuses.paymentStatus)];
  for (const line of calculated.normalized) statements.push(env.CLASS_DB.prepare(`INSERT INTO registration_items(id,registration_id,item_id,item_name_snapshot,unit_price_snapshot,unit_label_snapshot,quantity,subtotal) VALUES(?,?,?,?,?,?,?,?)`).bind(uid('rgi'),registrationId,line.row.id,line.row.name,line.row.unit_price,line.row.unit_label||'人',line.quantity,line.subtotal));
  for (const a of input.attendees || []) statements.push(env.CLASS_DB.prepare(`INSERT INTO registration_attendees(id,registration_id,item_id,attendee_index,name,phone,email,custom_data_json) VALUES(?,?,?,?,?,?,?,?)`).bind(uid('att'),registrationId,a.itemId||null,a.attendeeIndex,a.name||null,a.phone||null,a.email||null,JSON.stringify(a.customData||{})));
  await env.CLASS_DB.batch(statements); return { registrationId,registrationNo,accessToken,orderId,orderNo,totalQuantity:calculated.totalQuantity,totalAmount:calculated.totalAmount,registrationStatus:statuses.registrationStatus,paymentStatus:statuses.paymentStatus,expiresAt:statuses.expiresAt };
}
async function getRegistrationByToken(env: Env, token: string) { const reg = await env.CLASS_DB.prepare(`SELECT r.*,e.title event_title,e.location_name,e.starts_at event_starts_at,o.order_no,o.payable_amount,o.payment_method order_payment_method FROM registrations r JOIN events e ON e.id=r.event_id LEFT JOIN orders o ON o.registration_id=r.id WHERE r.access_token=? LIMIT 1`).bind(token).first<Record<string,any>>(); if (!reg) return null; const items=await env.CLASS_DB.prepare('SELECT * FROM registration_items WHERE registration_id=? ORDER BY id').bind(reg.id).all(); return {registration:reg,items:items.results}; }
async function cancelRegistration(env: Env, token: string) { const current=await env.CLASS_DB.prepare('SELECT id,registration_status FROM registrations WHERE access_token=?').bind(token).first<Record<string,any>>(); if(!current) throw new Error('找不到報名資料'); if(['cancelled','checked_in'].includes(current.registration_status)) throw new Error('目前狀態不可取消'); await env.CLASS_DB.prepare(`UPDATE registrations SET registration_status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(current.id).run(); return {success:true}; }

async function createAdminEvent(env: Env, body: any) {
  if (!body?.title?.trim()) throw new Error('請填活動名稱'); if (!Array.isArray(body.items) || !body.items.length) throw new Error('至少需要一個報名項目');
  const eventId=uid('evt'), base=slugify(body.title), slug=`${base}-${crypto.randomUUID().slice(0,6)}`;
  const identityMode=['login_required','guest_only','hybrid'].includes(body.identityMode)?body.identityMode:'hybrid'; const successMode=['free','register_then_pay','pay_then_confirm'].includes(body.registrationSuccessMode)?body.registrationSuccessMode:'free';
  const statements:any[]=[env.CLASS_DB.prepare(`INSERT INTO events(id,tenant_key,title,slug,description,banner_url,location_name,starts_at,ends_at,capacity,identity_mode,registration_success_mode,payment_hold_minutes,payment_due_days,attendee_data_mode,duplicate_rule,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(eventId,body.tenantKey||'default',body.title.trim(),slug,body.description||null,body.bannerUrl||null,body.locationName||null,body.startsAt||null,body.endsAt||null,body.capacity??null,identityMode,successMode,body.paymentHoldMinutes||15,body.paymentDueDays||null,body.attendeeDataMode||'contact_only',body.duplicateRule||'none','published')];
  for (let i=0;i<body.items.length;i++) { const x=body.items[i]; if(!x.name?.trim()) continue; statements.push(env.CLASS_DB.prepare(`INSERT INTO event_items(id,event_id,session_id,name,description,unit_label,unit_price,min_quantity,max_quantity,capacity,sort_order,is_active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`).bind(uid('itm'),eventId,null,x.name.trim(),x.description||null,x.unitLabel||'人',Math.max(0,Number(x.unitPrice||0)),0,x.maxQuantity??10,x.capacity??null,i)); }
  await env.CLASS_DB.batch(statements); return { eventId, slug };
}

export default { async fetch(request: Request, env: Env): Promise<Response> {
  const url=new URL(request.url), path=url.pathname.replace(/\/+$/,'')||'/';
  try {
    if(request.method==='GET'&&path==='/') return html(renderHome(env.APP_NAME));
    if(request.method==='GET'&&path==='/events') return html(renderEventList());
    if(request.method==='GET'&&path==='/admin') return html(renderAdminPage());
    const publicEvent=path.match(/^\/event\/([^/]+)$/); if(request.method==='GET'&&publicEvent) return html(renderEventPage(publicEvent[1]));
    const publicReg=path.match(/^\/registration\/([^/]+)$/); if(request.method==='GET'&&publicReg) return html(renderRegistrationPage(publicReg[1]));
    if(request.method==='GET'&&path==='/health') return json({success:true,service:env.APP_NAME,version:'0.2.0'});
    if(request.method==='GET'&&path==='/api/v1/events'){const rows=await listEvents(env);return json({success:true,events:rows.results});}
    const eventMatch=path.match(/^\/api\/v1\/events\/([^/]+)$/); if(request.method==='GET'&&eventMatch){const d=await eventDetail(env,eventMatch[1]);return d?json({success:true,...d}):json({success:false,error:'活動不存在'},404);}
    const registerMatch=path.match(/^\/api\/v1\/events\/([^/]+)\/registrations$/); if(request.method==='POST'&&registerMatch){const body=await request.json<CreateRegistrationInput>();return json({success:true,...await createRegistration(env,registerMatch[1],body)},201);}
    const regMatch=path.match(/^\/api\/v1\/registrations\/token\/([^/]+)$/); if(request.method==='GET'&&regMatch){const d=await getRegistrationByToken(env,regMatch[1]);return d?json({success:true,...d}):json({success:false,error:'找不到報名資料'},404);}
    const cancelMatch=path.match(/^\/api\/v1\/registrations\/token\/([^/]+)\/cancel$/); if(request.method==='POST'&&cancelMatch) return json(await cancelRegistration(env,cancelMatch[1]));
    if(request.method==='GET'&&path==='/api/v1/admin/events'){const rows=await listEvents(env,true);return json({success:true,events:rows.results});}
    if(request.method==='POST'&&path==='/api/v1/admin/events'){const body=await request.json<any>();return json({success:true,...await createAdminEvent(env,body)},201);}
    return json({success:false,error:'Not Found'},404);
  } catch(error){return json({success:false,error:error instanceof Error?error.message:'系統錯誤'},400);}
}};