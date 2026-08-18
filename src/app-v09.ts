import app from './app-v08';
import type { Env } from './types';

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}});
const uid=(p:string)=>`${p}_${crypto.randomUUID().replaceAll('-','')}`;
async function sha256(v:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function cookies(req:Request){const out:Record<string,string>={};for(const p of (req.headers.get('cookie')||'').split(';')){const [k,...r]=p.trim().split('=');if(k)out[k]=decodeURIComponent(r.join('='));}return out;}
async function isAdmin(req:Request,env:Env){if(!env.ADMIN_TOKEN)return true;const b=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');return b===env.ADMIN_TOKEN||cookies(req).class_admin===await sha256(env.ADMIN_TOKEN);}
async function apiClient(req:Request,env:Env){const raw=req.headers.get('x-api-key')||req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!raw)return null;return env.CLASS_DB.prepare(`SELECT * FROM api_clients WHERE api_key_hash=? AND is_active=1 LIMIT 1`).bind(await sha256(raw)).first<Record<string,any>>();}
function scopesOf(client:Record<string,any>){try{return JSON.parse(client.scopes_json||'[]') as string[];}catch{return[];}}
async function requireIntegrationScope(req:Request,env:Env,scope:string){const c=await apiClient(req,env);if(!c)return json({success:false,error:'INVALID_API_KEY'},401);if(!scopesOf(c).includes(scope))return json({success:false,error:'INSUFFICIENT_SCOPE',requiredScope:scope},403);return null;}

async function cancelWithPolicy(env:Env,token:string,body:any){
  const r=await env.CLASS_DB.prepare(`SELECT r.id,r.registration_status,r.payment_status,r.total_amount,r.created_at,e.starts_at,e.cancel_policy,e.cancel_deadline_hours,e.paid_cancel_action,o.id order_id,o.payable_amount FROM registrations r JOIN events e ON e.id=r.event_id LEFT JOIN orders o ON o.registration_id=r.id WHERE r.access_token=? LIMIT 1`).bind(token).first<Record<string,any>>();
  if(!r)throw new Error('找不到報名資料');
  if(['cancelled','checked_in','expired'].includes(r.registration_status))throw new Error('目前狀態不可取消');
  if(r.cancel_policy==='disabled')throw new Error('此活動不開放自行取消');
  if(r.cancel_deadline_hours!=null&&r.starts_at){const deadline=new Date(new Date(r.starts_at).getTime()-Number(r.cancel_deadline_hours)*3600000);if(Date.now()>deadline.getTime())throw new Error('已超過活動取消期限');}
  const paid=r.payment_status==='paid';
  if(paid&&r.paid_cancel_action==='block')throw new Error('此報名已付款，請聯絡主辦單位辦理取消');
  const statements:any[]=[env.CLASS_DB.prepare(`UPDATE registrations SET registration_status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(r.id)];
  let refundStatus:null|string=null;
  if(paid&&r.paid_cancel_action==='manual_refund'){
    refundStatus='pending';
    statements.push(env.CLASS_DB.prepare(`INSERT INTO refund_requests(id,registration_id,order_id,amount,status,reason) VALUES(?,?,?,?,?,?)`).bind(uid('rfd'),r.id,r.order_id||null,Number(r.payable_amount||r.total_amount||0),'pending',String(body?.reason||'使用者取消報名')));
  }
  await env.CLASS_DB.batch(statements);
  return{success:true,registrationStatus:'cancelled',refundStatus};
}

async function policy(env:Env,eventId:string,body?:any){
  const event=await env.CLASS_DB.prepare('SELECT id,cancel_policy,cancel_deadline_hours,paid_cancel_action,payment_due_days FROM events WHERE id=?').bind(eventId).first<Record<string,any>>();
  if(!event)throw new Error('活動不存在');
  if(body){
    const cp=['allowed','disabled'].includes(body.cancelPolicy)?body.cancelPolicy:'allowed';
    const pa=['manual_refund','no_refund','block'].includes(body.paidCancelAction)?body.paidCancelAction:'manual_refund';
    await env.CLASS_DB.prepare(`UPDATE events SET cancel_policy=?,cancel_deadline_hours=?,paid_cancel_action=?,payment_due_days=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(cp,body.cancelDeadlineHours==null?null:Number(body.cancelDeadlineHours),pa,body.paymentDueDays==null?null:Number(body.paymentDueDays),eventId).run();
  }
  const latest=await env.CLASS_DB.prepare('SELECT id,cancel_policy,cancel_deadline_hours,paid_cancel_action,payment_due_days FROM events WHERE id=?').bind(eventId).first();
  return{success:true,policy:latest};
}

async function dueReminders(env:Env){
  const r=await env.CLASS_DB.prepare(`SELECT r.id,r.registration_no,r.access_token,r.contact_name,r.contact_phone,r.contact_email,r.total_amount,r.payment_due_at,e.title event_title FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.registration_status='confirmed' AND r.payment_status IN ('unpaid','pending') AND r.payment_due_at IS NOT NULL AND r.reminder_sent_at IS NULL AND datetime(r.payment_due_at)<=datetime('now','+24 hours') ORDER BY r.payment_due_at ASC LIMIT 500`).all();
  return{success:true,registrations:r.results};
}
async function markReminder(env:Env,registrationId:string){await env.CLASS_DB.prepare(`UPDATE registrations SET reminder_sent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(registrationId).run();return{success:true};}

async function attachPaymentDue(env:Env,eventId:string,response:Response){
  if(!response.headers.get('content-type')?.includes('application/json'))return response;
  const copy=response.clone();let d:any;try{d=await copy.json();}catch{return response;}
  if(!d?.success||!d.registrationId)return response;
  const e=await env.CLASS_DB.prepare(`SELECT registration_success_mode,payment_due_days FROM events WHERE id=?`).bind(eventId).first<Record<string,any>>();
  if(e?.registration_success_mode==='register_then_pay'&&e.payment_due_days!=null){
    const due=new Date(Date.now()+Number(e.payment_due_days)*86400000).toISOString();
    await env.CLASS_DB.prepare(`UPDATE registrations SET payment_due_at=? WHERE id=?`).bind(due,d.registrationId).run();
    d.paymentDueAt=due;
    return json(d,response.status);
  }
  return response;
}

export default{async fetch(request:Request,env:Env):Promise<Response>{const url=new URL(request.url),path=url.pathname.replace(/\/+$/,'')||'/';try{
  if(path.startsWith('/api/v1/integration/')){
    let scope='events:read';
    if(path.includes('/identity/'))scope='identity:write';
    const denied=await requireIntegrationScope(request,env,scope);if(denied)return denied;
  }
  const cancel=path.match(/^\/api\/v1\/registrations\/token\/([^/]+)\/cancel$/);if(request.method==='POST'&&cancel)return json(await cancelWithPolicy(env,cancel[1],await request.clone().json().catch(()=>({}))));
  const pol=path.match(/^\/api\/v1\/admin\/events\/([^/]+)\/policy$/);if(pol){if(!await isAdmin(request,env))return json({success:false,error:'ADMIN_AUTH_REQUIRED'},401);if(request.method==='GET')return json(await policy(env,pol[1]));if(request.method==='POST')return json(await policy(env,pol[1],await request.json()));}
  if(request.method==='GET'&&path==='/api/v1/admin/reminders/due'){if(!await isAdmin(request,env))return json({success:false,error:'ADMIN_AUTH_REQUIRED'},401);return json(await dueReminders(env));}
  const rem=path.match(/^\/api\/v1\/admin\/registrations\/([^/]+)\/reminder-sent$/);if(request.method==='POST'&&rem){if(!await isAdmin(request,env))return json({success:false,error:'ADMIN_AUTH_REQUIRED'},401);return json(await markReminder(env,rem[1]));}
  const reg=path.match(/^\/api\/v1\/events\/([^/]+)\/registrations$/);if(request.method==='POST'&&reg)return attachPaymentDue(env,reg[1],await app.fetch(request,env));
  if(request.method==='GET'&&path==='/health')return json({success:true,service:env.APP_NAME,version:'0.9.0'});
  return app.fetch(request,env);
}catch(e){return json({success:false,error:e instanceof Error?e.message:'系統錯誤'},400);}}};
