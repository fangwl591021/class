import type { CreateRegistrationInput, Env, PaymentStatus, RegistrationStatus } from './types';
import { renderAdminEventPage, renderAdminPage, renderEventList, renderEventPage, renderHome, renderRegistrationPage } from './ui2';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: jsonHeaders });
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const uid = (p: string) => `${p}_${crypto.randomUUID().replaceAll('-', '')}`;
const slugify = (s: string) => (s || 'event').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fff-]/g, '').slice(0, 60) || 'event';
function publicCode(prefix: string) { const n = new Date(); return `${prefix}-${String(n.getUTCFullYear()).slice(-2)}${String(n.getUTCMonth()+1).padStart(2,'0')}${String(n.getUTCDate()).padStart(2,'0')}-${crypto.randomUUID().replaceAll('-','').slice(0,6).toUpperCase()}`; }

async function expirePending(env: Env) {
  await env.CLASS_DB.prepare(`UPDATE registrations SET registration_status='expired',updated_at=CURRENT_TIMESTAMP WHERE registration_status='pending_payment' AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now')`).run();
}
async function getEvent(env: Env, id: string) { return env.CLASS_DB.prepare('SELECT * FROM events WHERE id=?').bind(id).first<Record<string,any>>(); }
async function listEvents(env: Env, all=false) { return env.CLASS_DB.prepare(`SELECT * FROM events ${all?'':"WHERE status='published'"} ORDER BY starts_at IS NULL, starts_at ASC, created_at DESC`).all(); }
async function eventDetail(env: Env, eventId: string) {
  const event=await getEvent(env,eventId); if(!event) return null;
  const [sessions,items,fields]=await Promise.all([
    env.CLASS_DB.prepare('SELECT * FROM event_sessions WHERE event_id=? AND is_active=1 ORDER BY sort_order,starts_at').bind(eventId).all(),
    env.CLASS_DB.prepare('SELECT * FROM event_items WHERE event_id=? AND is_active=1 ORDER BY sort_order,name').bind(eventId).all(),
    env.CLASS_DB.prepare('SELECT * FROM event_form_fields WHERE event_id=? ORDER BY scope,sort_order,label').bind(eventId).all(),
  ]);
  return {event,sessions:sessions.results,items:items.results,fields:fields.results};
}
function validateIdentity(event:Record<string,any>,input:CreateRegistrationInput){
  if(event.identity_mode==='login_required'&&input.identity?.type!=='member') throw new Error('此活動必須登入後才能報名');
  if(event.identity_mode==='guest_only'&&input.identity?.type==='member') throw new Error('此活動採一般自行填寫模式');
}
async function duplicateCheck(env:Env,event:Record<string,any>,input:CreateRegistrationInput){
  let sql='',v:string|undefined;
  if(event.duplicate_rule==='member'){v=input.identity?.externalMemberId||input.externalMemberId;if(v)sql=`SELECT id FROM registrations WHERE event_id=? AND external_member_id=? AND registration_status NOT IN ('cancelled','expired') LIMIT 1`;}
  if(event.duplicate_rule==='phone'){v=input.contact.phone;if(v)sql=`SELECT id FROM registrations WHERE event_id=? AND contact_phone=? AND registration_status NOT IN ('cancelled','expired') LIMIT 1`;}
  if(event.duplicate_rule==='email'){v=input.contact.email;if(v)sql=`SELECT id FROM registrations WHERE event_id=? AND contact_email=? AND registration_status NOT IN ('cancelled','expired') LIMIT 1`;}
  if(sql&&v&&await env.CLASS_DB.prepare(sql).bind(event.id,v).first()) throw new Error('此活動已有相同身份的有效報名紀錄');
}
async function resolveIdentity(env:Env,event:Record<string,any>,input:CreateRegistrationInput){
  if(!input.identity)return null;const x=input.identity,tenant=event.tenant_key||'default';
  if(x.type==='member'&&x.provider&&x.externalMemberId){const old=await env.CLASS_DB.prepare('SELECT id FROM identities WHERE tenant_key=? AND provider=? AND external_member_id=? LIMIT 1').bind(tenant,x.provider,x.externalMemberId).first<{id:string}>();if(old)return old.id;}
  const id=uid('idn');await env.CLASS_DB.prepare('INSERT INTO identities(id,tenant_key,identity_type,provider,external_member_id,display_name,phone,email) VALUES(?,?,?,?,?,?,?,?)').bind(id,tenant,x.type,x.provider||null,x.externalMemberId||null,x.displayName||input.contact.name||null,x.phone||input.contact.phone||null,x.email||input.contact.email||null).run();return id;
}
async function calculateItems(env:Env,eventId:string,sessionId:string|undefined,input:CreateRegistrationInput){
  if(!Array.isArray(input.items)||!input.items.length)throw new Error('請至少選擇一個報名項目');
  const ids=[...new Set(input.items.map(x=>x.itemId))];if(ids.length!==input.items.length)throw new Error('報名項目不可重複');
  const rows=await env.CLASS_DB.prepare(`SELECT * FROM event_items WHERE event_id=? AND is_active=1 AND id IN (${ids.map(()=>'?').join(',')})`).bind(eventId,...ids).all<Record<string,any>>();if(rows.results.length!==ids.length)throw new Error('包含不存在或已停用的報名項目');
  let totalQuantity=0,totalAmount=0;const normalized:any[]=[];
  for(const selected of input.items){const row=rows.results.find(r=>r.id===selected.itemId)!;const qty=Number(selected.quantity);if(!Number.isInteger(qty)||qty<0)throw new Error(`${row.name} 人數格式錯誤`);if(qty<Number(row.min_quantity||0))throw new Error(`${row.name} 至少需選 ${row.min_quantity}`);if(row.max_quantity!=null&&qty>Number(row.max_quantity))throw new Error(`${row.name} 最多可選 ${row.max_quantity}`);if(row.session_id&&row.session_id!==sessionId)throw new Error(`${row.name} 不屬於目前梯次`);if(!qty)continue;
    if(row.capacity!=null){const u=await env.CLASS_DB.prepare(`SELECT COALESCE(SUM(ri.quantity),0) used FROM registration_items ri JOIN registrations r ON r.id=ri.registration_id WHERE ri.item_id=? AND r.registration_status IN ('pending_payment','confirmed','checked_in')`).bind(row.id).first<{used:number}>();if(Number(u?.used||0)+qty>Number(row.capacity))throw new Error(`${row.name} 剩餘名額不足`);}
    const subtotal=Number(row.unit_price)*qty;totalQuantity+=qty;totalAmount+=subtotal;normalized.push({row,quantity:qty,subtotal});
  }
  if(totalQuantity<=0)throw new Error('報名總人數必須大於 0');return {normalized,totalQuantity,totalAmount};
}
async function capacityCheck(env:Env,event:Record<string,any>,sessionId:string|undefined,qty:number){
  if(event.capacity!=null){const u=await env.CLASS_DB.prepare(`SELECT COALESCE(SUM(total_quantity),0) used FROM registrations WHERE event_id=? AND registration_status IN ('pending_payment','confirmed','checked_in')`).bind(event.id).first<{used:number}>();if(Number(u?.used||0)+qty>Number(event.capacity))throw new Error('活動剩餘名額不足');}
  if(sessionId){const s=await env.CLASS_DB.prepare('SELECT * FROM event_sessions WHERE id=? AND event_id=? AND is_active=1').bind(sessionId,event.id).first<Record<string,any>>();if(!s)throw new Error('梯次不存在或已停用');if(s.capacity!=null){const u=await env.CLASS_DB.prepare(`SELECT COALESCE(SUM(total_quantity),0) used FROM registrations WHERE session_id=? AND registration_status IN ('pending_payment','confirmed','checked_in')`).bind(sessionId).first<{used:number}>();if(Number(u?.used||0)+qty>Number(s.capacity))throw new Error('此梯次剩餘名額不足');}}
}
function initialStatuses(event:Record<string,any>,amount:number):{registrationStatus:RegistrationStatus,paymentStatus:PaymentStatus,expiresAt:string|null}{
  if(amount===0||event.registration_success_mode==='free')return{registrationStatus:'confirmed',paymentStatus:'not_required',expiresAt:null};
  if(event.registration_success_mode==='register_then_pay')return{registrationStatus:'confirmed',paymentStatus:'unpaid',expiresAt:null};
  return{registrationStatus:'pending_payment',paymentStatus:'unpaid',expiresAt:new Date(Date.now()+Number(event.payment_hold_minutes||15)*60000).toISOString()};
}
function validateAttendees(event:Record<string,any>,input:CreateRegistrationInput,total:number){
  if(event.attendee_data_mode==='contact_only')return;
  if(!Array.isArray(input.attendees)||input.attendees.length!==total)throw new Error(`此活動需填寫每位參加者資料，共 ${total} 位`);
  if(input.attendees.some(a=>!a.name?.trim()))throw new Error('每位參加者都必須填姓名');
}
async function createRegistration(env:Env,eventId:string,input:CreateRegistrationInput){
  const event=await getEvent(env,eventId);if(!event||event.status!=='published')throw new Error('活動不存在或尚未開放報名');if(!input.contact?.name?.trim())throw new Error('請填寫聯絡人姓名');
  validateIdentity(event,input);await duplicateCheck(env,event,input);const calc=await calculateItems(env,eventId,input.sessionId,input);await capacityCheck(env,event,input.sessionId,calc.totalQuantity);validateAttendees(event,input,calc.totalQuantity);const identityId=await resolveIdentity(env,event,input);
  const registrationId=uid('reg'),registrationNo=publicCode('REG'),accessToken=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),orderId=uid('ord'),orderNo=publicCode('ORD'),st=initialStatuses(event,calc.totalAmount);
  const statements:any[]=[
    env.CLASS_DB.prepare(`INSERT INTO registrations(id,registration_no,access_token,tenant_key,event_id,session_id,identity_id,external_source,external_member_id,contact_name,contact_phone,contact_email,total_quantity,total_amount,registration_status,payment_status,expires_at,custom_data_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(registrationId,registrationNo,accessToken,event.tenant_key||'default',eventId,input.sessionId||null,identityId,input.externalSource||null,input.identity?.externalMemberId||input.externalMemberId||null,input.contact.name.trim(),input.contact.phone||null,input.contact.email||null,calc.totalQuantity,calc.totalAmount,st.registrationStatus,st.paymentStatus,st.expiresAt,JSON.stringify(input.customData||{})),
    env.CLASS_DB.prepare(`INSERT INTO orders(id,order_no,registration_id,original_amount,discount_amount,payable_amount,payment_status) VALUES(?,?,?, ?,0,?,?)`).bind(orderId,orderNo,registrationId,calc.totalAmount,calc.totalAmount,st.paymentStatus)
  ];
  for(const line of calc.normalized)statements.push(env.CLASS_DB.prepare(`INSERT INTO registration_items(id,registration_id,item_id,item_name_snapshot,unit_price_snapshot,unit_label_snapshot,quantity,subtotal) VALUES(?,?,?,?,?,?,?,?)`).bind(uid('rgi'),registrationId,line.row.id,line.row.name,line.row.unit_price,line.row.unit_label||'人',line.quantity,line.subtotal));
  for(const a of input.attendees||[])statements.push(env.CLASS_DB.prepare(`INSERT INTO registration_attendees(id,registration_id,item_id,attendee_index,name,phone,email,custom_data_json) VALUES(?,?,?,?,?,?,?,?)`).bind(uid('att'),registrationId,a.itemId||null,a.attendeeIndex,a.name||null,a.phone||null,a.email||null,JSON.stringify(a.customData||{})));
  await env.CLASS_DB.batch(statements);return{registrationId,registrationNo,accessToken,orderId,orderNo,totalQuantity:calc.totalQuantity,totalAmount:calc.totalAmount,registrationStatus:st.registrationStatus,paymentStatus:st.paymentStatus,expiresAt:st.expiresAt};
}
async function getRegistrationByToken(env:Env,token:string){
  const reg=await env.CLASS_DB.prepare(`SELECT r.*,e.title event_title,e.location_name,e.starts_at event_starts_at,e.registration_success_mode,e.bank_name,e.bank_code,e.bank_account,e.bank_account_name,e.payment_note,o.order_no,o.payable_amount,o.payment_method order_payment_method FROM registrations r JOIN events e ON e.id=r.event_id LEFT JOIN orders o ON o.registration_id=r.id WHERE r.access_token=? LIMIT 1`).bind(token).first<Record<string,any>>();if(!reg)return null;
  const [items,attendees]=await Promise.all([env.CLASS_DB.prepare('SELECT * FROM registration_items WHERE registration_id=? ORDER BY id').bind(reg.id).all(),env.CLASS_DB.prepare('SELECT * FROM registration_attendees WHERE registration_id=? ORDER BY attendee_index').bind(reg.id).all()]);return{registration:reg,items:items.results,attendees:attendees.results};
}
async function cancelRegistration(env:Env,token:string){const r=await env.CLASS_DB.prepare('SELECT id,registration_status FROM registrations WHERE access_token=?').bind(token).first<Record<string,any>>();if(!r)throw new Error('找不到報名資料');if(['cancelled','checked_in'].includes(r.registration_status))throw new Error('目前狀態不可取消');await env.CLASS_DB.prepare(`UPDATE registrations SET registration_status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(r.id).run();return{success:true};}
async function submitBankTransfer(env:Env,token:string,body:any){
  const r=await env.CLASS_DB.prepare(`SELECT r.id,r.total_amount,r.payment_status,r.registration_status,o.id order_id,o.payable_amount FROM registrations r JOIN orders o ON o.registration_id=r.id WHERE r.access_token=?`).bind(token).first<Record<string,any>>();if(!r)throw new Error('找不到報名資料');if(['cancelled','expired'].includes(r.registration_status))throw new Error('此報名已失效');if(r.payment_status==='paid')throw new Error('此訂單已付款');const last5=String(body?.last5||'').trim();if(!/^\d{5}$/.test(last5))throw new Error('請填寫匯款帳號末五碼');
  await env.CLASS_DB.batch([
    env.CLASS_DB.prepare(`INSERT INTO payments(id,order_id,provider,amount,status,bank_last5,metadata_json) VALUES(?,?,?,?,?,?,?)`).bind(uid('pay'),r.order_id,'bank_transfer',r.payable_amount,'pending',last5,JSON.stringify({note:body?.note||''})),
    env.CLASS_DB.prepare(`UPDATE orders SET payment_method='bank_transfer',payment_status='pending',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(r.order_id),
    env.CLASS_DB.prepare(`UPDATE registrations SET payment_status='pending',payment_submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(r.id)
  ]);return{success:true};
}
async function confirmPayment(env:Env,registrationId:string){
  const r=await env.CLASS_DB.prepare(`SELECT r.*,e.registration_success_mode,o.id order_id FROM registrations r JOIN events e ON e.id=r.event_id JOIN orders o ON o.registration_id=r.id WHERE r.id=?`).bind(registrationId).first<Record<string,any>>();if(!r)throw new Error('找不到報名資料');
  const next=r.registration_success_mode==='pay_then_confirm'?'confirmed':r.registration_status;
  await env.CLASS_DB.batch([
    env.CLASS_DB.prepare(`UPDATE payments SET status='paid',paid_at=CURRENT_TIMESTAMP WHERE order_id=? AND status='pending'`).bind(r.order_id),
    env.CLASS_DB.prepare(`UPDATE orders SET payment_status='paid',paid_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(r.order_id),
    env.CLASS_DB.prepare(`UPDATE registrations SET payment_status='paid',registration_status=?,expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(next,r.id)
  ]);return{success:true,registrationStatus:next};
}
async function createAdminEvent(env:Env,body:any){
  if(!body?.title?.trim())throw new Error('請填活動名稱');if(!Array.isArray(body.items)||!body.items.length)throw new Error('至少需要一個報名項目');const eventId=uid('evt'),slug=`${slugify(body.title)}-${crypto.randomUUID().slice(0,6)}`;
  const identityMode=['login_required','guest_only','hybrid'].includes(body.identityMode)?body.identityMode:'hybrid',successMode=['free','register_then_pay','pay_then_confirm'].includes(body.registrationSuccessMode)?body.registrationSuccessMode:'free',attMode=['contact_only','names_only','full'].includes(body.attendeeDataMode)?body.attendeeDataMode:'contact_only';
  const st:any[]=[env.CLASS_DB.prepare(`INSERT INTO events(id,tenant_key,title,slug,description,banner_url,location_name,starts_at,ends_at,capacity,identity_mode,registration_success_mode,payment_hold_minutes,payment_due_days,attendee_data_mode,duplicate_rule,status,bank_name,bank_code,bank_account,bank_account_name,payment_note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(eventId,body.tenantKey||'default',body.title.trim(),slug,body.description||null,body.bannerUrl||null,body.locationName||null,body.startsAt||null,body.endsAt||null,body.capacity??null,identityMode,successMode,body.paymentHoldMinutes||15,body.paymentDueDays||null,attMode,body.duplicateRule||'none','published',body.bankName||null,body.bankCode||null,body.bankAccount||null,body.bankAccountName||null,body.paymentNote||null)];
  for(let i=0;i<body.items.length;i++){const x=body.items[i];if(!x.name?.trim())continue;st.push(env.CLASS_DB.prepare(`INSERT INTO event_items(id,event_id,session_id,name,description,unit_label,unit_price,min_quantity,max_quantity,capacity,sort_order,is_active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`).bind(uid('itm'),eventId,null,x.name.trim(),x.description||null,x.unitLabel||'人',Math.max(0,Number(x.unitPrice||0)),0,x.maxQuantity??10,x.capacity??null,i));}
  await env.CLASS_DB.batch(st);return{eventId,slug};
}
async function createSession(env:Env,eventId:string,body:any){if(!body?.name?.trim())throw new Error('請填梯次名稱');if(!await getEvent(env,eventId))throw new Error('活動不存在');const id=uid('ses');await env.CLASS_DB.prepare(`INSERT INTO event_sessions(id,event_id,name,starts_at,ends_at,capacity,sort_order,is_active) VALUES(?,?,?,?,?,?,?,1)`).bind(id,eventId,body.name.trim(),body.startsAt||null,body.endsAt||null,body.capacity??null,Number(body.sortOrder||0)).run();return{id};}
async function adminDashboard(env:Env,eventId:string){
  const event=await getEvent(env,eventId);if(!event)return null;const [sessions,regs,stats]=await Promise.all([
    env.CLASS_DB.prepare('SELECT * FROM event_sessions WHERE event_id=? AND is_active=1 ORDER BY sort_order,starts_at').bind(eventId).all(),
    env.CLASS_DB.prepare(`SELECT r.id,r.registration_no,r.contact_name,r.total_quantity,r.total_amount,r.registration_status,r.payment_status,r.created_at,s.name session_name FROM registrations r LEFT JOIN event_sessions s ON s.id=r.session_id WHERE r.event_id=? ORDER BY r.created_at DESC LIMIT 500`).bind(eventId).all(),
    env.CLASS_DB.prepare(`SELECT COALESCE(SUM(CASE WHEN registration_status IN ('pending_payment','confirmed','checked_in') THEN total_quantity ELSE 0 END),0) people,COALESCE(SUM(CASE WHEN payment_status='paid' THEN total_amount ELSE 0 END),0) paid,COALESCE(SUM(CASE WHEN payment_status IN ('unpaid','pending') AND registration_status NOT IN ('cancelled','expired') THEN 1 ELSE 0 END),0) unpaid FROM registrations WHERE event_id=?`).bind(eventId).first<Record<string,any>>()
  ]);return{event,sessions:sessions.results,registrations:regs.results,stats:{people:Number(stats?.people||0),paid:Number(stats?.paid||0),unpaid:Number(stats?.unpaid||0)}};
}

export default { async fetch(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url),path=url.pathname.replace(/\/+$/,'')||'/';
  try{
    await expirePending(env);
    if(request.method==='GET'&&path==='/')return html(renderHome(env.APP_NAME));
    if(request.method==='GET'&&path==='/events')return html(renderEventList());
    if(request.method==='GET'&&path==='/admin')return html(renderAdminPage());
    const ae=path.match(/^\/admin\/event\/([^/]+)$/);if(request.method==='GET'&&ae)return html(renderAdminEventPage(ae[1]));
    const pe=path.match(/^\/event\/([^/]+)$/);if(request.method==='GET'&&pe)return html(renderEventPage(pe[1]));
    const pr=path.match(/^\/registration\/([^/]+)$/);if(request.method==='GET'&&pr)return html(renderRegistrationPage(pr[1]));
    if(request.method==='GET'&&path==='/health')return json({success:true,service:env.APP_NAME,version:'0.3.0'});
    if(request.method==='GET'&&path==='/api/v1/events'){const x=await listEvents(env);return json({success:true,events:x.results});}
    const ed=path.match(/^\/api\/v1\/events\/([^/]+)$/);if(request.method==='GET'&&ed){const d=await eventDetail(env,ed[1]);return d?json({success:true,...d}):json({success:false,error:'活動不存在'},404);}
    const reg=path.match(/^\/api\/v1\/events\/([^/]+)\/registrations$/);if(request.method==='POST'&&reg)return json({success:true,...await createRegistration(env,reg[1],await request.json<CreateRegistrationInput>())},201);
    const rt=path.match(/^\/api\/v1\/registrations\/token\/([^/]+)$/);if(request.method==='GET'&&rt){const d=await getRegistrationByToken(env,rt[1]);return d?json({success:true,...d}):json({success:false,error:'找不到報名資料'},404);}
    const rc=path.match(/^\/api\/v1\/registrations\/token\/([^/]+)\/cancel$/);if(request.method==='POST'&&rc)return json(await cancelRegistration(env,rc[1]));
    const rb=path.match(/^\/api\/v1\/registrations\/token\/([^/]+)\/bank-transfer$/);if(request.method==='POST'&&rb)return json(await submitBankTransfer(env,rb[1],await request.json<any>()));
    if(request.method==='GET'&&path==='/api/v1/admin/events'){const x=await listEvents(env,true);return json({success:true,events:x.results});}
    if(request.method==='POST'&&path==='/api/v1/admin/events')return json({success:true,...await createAdminEvent(env,await request.json<any>())},201);
    const ses=path.match(/^\/api\/v1\/admin\/events\/([^/]+)\/sessions$/);if(request.method==='POST'&&ses)return json({success:true,...await createSession(env,ses[1],await request.json<any>())},201);
    const dash=path.match(/^\/api\/v1\/admin\/events\/([^/]+)\/dashboard$/);if(request.method==='GET'&&dash){const d=await adminDashboard(env,dash[1]);return d?json({success:true,...d}):json({success:false,error:'活動不存在'},404);}
    const cp=path.match(/^\/api\/v1\/admin\/registrations\/([^/]+)\/confirm-payment$/);if(request.method==='POST'&&cp)return json(await confirmPayment(env,cp[1]));
    return json({success:false,error:'Not Found'},404);
  }catch(error){return json({success:false,error:error instanceof Error?error.message:'系統錯誤'},400);}
}};
