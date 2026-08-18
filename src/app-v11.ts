import app from './app-v101';
import type { Env } from './types';

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}});
const esc=(s:unknown)=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]||c));
async function sha256(v:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function cookies(req:Request){const out:Record<string,string>={};for(const p of (req.headers.get('cookie')||'').split(';')){const [k,...r]=p.trim().split('=');if(k)out[k]=decodeURIComponent(r.join('='));}return out;}
async function isAdmin(req:Request,env:Env){if(!env.ADMIN_TOKEN)return true;const b=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');return b===env.ADMIN_TOKEN||cookies(req).class_admin===await sha256(env.ADMIN_TOKEN);}
function page(title:string,body:string,script=''){return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:#1f2937;font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif}.wrap{max-width:1040px;margin:20px auto;padding:12px}.card{background:#fff;border-radius:18px;padding:20px;margin-bottom:14px;box-shadow:0 8px 28px rgba(0,0,0,.06)}.btn{display:inline-block;border:0;border-radius:11px;padding:10px 14px;font-weight:800;cursor:pointer;text-decoration:none}.primary{background:#111827;color:#fff}.secondary{background:#eef2f7;color:#111827}.success{background:#166534;color:#fff}.warn{background:#fff7ed;color:#9a3412;padding:10px 12px;border-radius:12px}.ok{background:#ecfdf5;color:#166534;padding:10px 12px;border-radius:12px}.row{display:flex;gap:8px;align-items:center}.between{justify-content:space-between}.muted{color:#6b7280}.table{width:100%;border-collapse:collapse}.table th,.table td{padding:10px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:top}.pill{display:inline-block;padding:4px 9px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:13px;font-weight:800}@media(max-width:680px){.row{display:grid}.table{display:block;overflow:auto}.wrap{padding:8px}}</style></head><body>${body}<script>${script}</script></body></html>`;}

async function dueRows(env:Env){const r=await env.CLASS_DB.prepare(`SELECT r.id,r.registration_no,r.access_token,r.contact_name,r.contact_phone,r.contact_email,r.total_amount,r.payment_due_at,r.reminder_sent_at,e.title event_title FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.registration_status='confirmed' AND r.payment_status IN ('unpaid','pending') AND r.payment_due_at IS NOT NULL AND datetime(r.payment_due_at)<=datetime('now','+24 hours') ORDER BY r.payment_due_at ASC LIMIT 500`).all<Record<string,any>>();return r.results;}

async function markReminder(env:Env,id:string){await env.CLASS_DB.prepare(`UPDATE registrations SET reminder_sent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();return{success:true};}

async function dispatchReminder(env:Env,id:string){
  const row=await env.CLASS_DB.prepare(`SELECT r.id,r.registration_no,r.access_token,r.contact_name,r.contact_phone,r.contact_email,r.total_amount,r.payment_due_at,r.reminder_sent_at,e.title event_title FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.id=? LIMIT 1`).bind(id).first<Record<string,any>>();
  if(!row)throw new Error('找不到報名資料');
  if(row.reminder_sent_at)return{success:true,alreadySent:true};
  if(!env.NOTIFY_WEBHOOK_URL)throw new Error('尚未設定 NOTIFY_WEBHOOK_URL');
  const payload={type:'payment_due',registrationId:row.id,registrationNo:row.registration_no,name:row.contact_name,phone:row.contact_phone,email:row.contact_email,eventTitle:row.event_title,amount:Number(row.total_amount||0),paymentDueAt:row.payment_due_at,registrationUrl:`/registration/${row.access_token}`};
  const resp=await fetch(env.NOTIFY_WEBHOOK_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  if(!resp.ok)throw new Error(`通知服務失敗 HTTP ${resp.status}`);
  await env.CLASS_DB.prepare(`UPDATE registrations SET reminder_sent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
  return{success:true,dispatched:true};
}

async function remindersPage(env:Env){
  const rows=await dueRows(env);
  const trs=rows.length?rows.map(x=>`<tr><td>${esc(x.registration_no)}<br><span class="muted">${esc(x.event_title)}</span></td><td>${esc(x.contact_name)}<br><span class="muted">${esc(x.contact_phone||'')} ${esc(x.contact_email||'')}</span></td><td>$${Number(x.total_amount||0).toLocaleString('zh-TW')}</td><td>${esc(x.payment_due_at||'')}</td><td>${x.reminder_sent_at?`<span class="pill">已提醒</span><br><span class="muted">${esc(x.reminder_sent_at)}</span>`:`<div class="row"><button class="btn primary" data-send="${esc(x.id)}">發送提醒</button><button class="btn secondary" data-mark="${esc(x.id)}">僅標記已提醒</button></div>`}</td></tr>`).join(''):'<tr><td colspan="5" class="muted">目前沒有 24 小時內到期的未付款報名</td></tr>';
  return new Response(page('付款提醒',`<div class="wrap"><div class="card"><div class="row between"><div><h1>付款提醒</h1><p class="muted">列出 24 小時內到期的後付報名。若設定 NOTIFY_WEBHOOK_URL，可由這裡交給 LINE / Email / SMS 通知服務。</p></div><a class="btn secondary" href="/admin">返回後台</a></div>${env.NOTIFY_WEBHOOK_URL?'<div class="ok">通知 Webhook 已設定</div>':'<div class="warn">目前未設定 NOTIFY_WEBHOOK_URL；仍可手動聯絡後按「僅標記已提醒」。</div>'}</div><div class="card"><table class="table"><thead><tr><th>報名</th><th>聯絡人</th><th>金額</th><th>付款期限</th><th>提醒</th></tr></thead><tbody>${trs}</tbody></table><div id="msg"></div></div></div>`,`async function act(url,btn){btn.disabled=true;const r=await fetch(url,{method:'POST'});const d=await r.json();if(d.success){location.reload();return}document.getElementById('msg').innerHTML='<div class="warn">'+(d.error||'操作失敗')+'</div>';btn.disabled=false;}document.querySelectorAll('[data-send]').forEach(b=>b.onclick=()=>act('/api/v1/admin/reminders/'+encodeURIComponent(b.dataset.send)+'/dispatch',b));document.querySelectorAll('[data-mark]').forEach(b=>b.onclick=()=>act('/api/v1/admin/registrations/'+encodeURIComponent(b.dataset.mark)+'/reminder-sent',b));`),{headers:{'content-type':'text/html; charset=utf-8'}});
}

async function opsPage(){return new Response(page('營運工具',`<div class="wrap"><div class="card"><div class="row between"><div><h1>營運工具</h1><p class="muted">將常用活動營運入口集中。</p></div><a class="btn secondary" href="/admin">活動管理</a></div></div><div class="card"><div class="row"><a class="btn primary" href="/admin/checkin">QR 掃碼報到</a><a class="btn secondary" href="/admin/refunds">退費管理</a><a class="btn secondary" href="/admin/reminders">付款提醒</a><a class="btn secondary" href="/admin/api-clients">API Clients</a></div></div></div>`),{headers:{'content-type':'text/html; charset=utf-8'}});}

export default{async fetch(request:Request,env:Env):Promise<Response>{const path=new URL(request.url).pathname.replace(/\/+$/,'')||'/';try{
  if((path.startsWith('/admin')||path.startsWith('/api/v1/admin'))&&!await isAdmin(request,env)){if(path.startsWith('/api/'))return json({success:false,error:'ADMIN_AUTH_REQUIRED'},401);return new Response(null,{status:302,headers:{location:'/admin/login'}});}
  if(request.method==='GET'&&path==='/admin/ops')return opsPage();
  if(request.method==='GET'&&path==='/admin/reminders')return remindersPage(env);
  const dispatch=path.match(/^\/api\/v1\/admin\/reminders\/([^/]+)\/dispatch$/);if(request.method==='POST'&&dispatch)return json(await dispatchReminder(env,dispatch[1]));
  const mark=path.match(/^\/api\/v1\/admin\/registrations\/([^/]+)\/reminder-sent$/);if(request.method==='POST'&&mark)return json(await markReminder(env,mark[1]));
  if(request.method==='GET'&&path==='/api/v1/admin/reminders/due')return json({success:true,registrations:await dueRows(env)});
  if(request.method==='GET'&&path==='/health')return json({success:true,service:env.APP_NAME,version:'0.11.0'});
  return app.fetch(request,env);
}catch(e){return json({success:false,error:e instanceof Error?e.message:'系統錯誤'},400);}}};
