import legacy from './index';
import type { Env } from './types';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: jsonHeaders });
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const uid = (p: string) => `${p}_${crypto.randomUUID().replaceAll('-', '')}`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c] || c));

function shell(title: string, body: string, script = '') {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
  *{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif;background:#f6f7f9;color:#1f2937}.wrap{max-width:980px;margin:0 auto;padding:16px}.card{background:white;border-radius:18px;padding:20px;margin-bottom:16px;box-shadow:0 8px 28px rgba(0,0,0,.06)}h1,h2,h3{margin:0 0 12px}.muted{color:#6b7280}.row{display:flex;gap:10px;align-items:center}.between{justify-content:space-between}.stack{display:grid;gap:10px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field label{display:block;font-weight:800;margin-bottom:6px}.field input,.field select,.field textarea{width:100%;padding:12px;border:1px solid #d1d5db;border-radius:12px;font-size:16px}.btn{display:inline-block;border:0;border-radius:12px;padding:11px 14px;font-weight:800;text-decoration:none;cursor:pointer}.primary{background:#111827;color:#fff}.secondary{background:#eef2f7;color:#111827}.danger{background:#dc2626;color:white}.ok{background:#ecfdf5;color:#166534;padding:10px 12px;border-radius:12px}.warn{background:#fff7ed;color:#9a3412;padding:10px 12px;border-radius:12px}.item{border:1px solid #e5e7eb;border-radius:14px;padding:14px}.pill{display:inline-block;background:#eef2ff;color:#3730a3;padding:4px 9px;border-radius:999px;font-size:13px;font-weight:800}.table{width:100%;border-collapse:collapse}.table th,.table td{padding:10px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:top}@media(max-width:680px){.grid2{grid-template-columns:1fr}.row.mobile{display:grid}.wrap{padding:10px}}
  </style></head><body>${body}<script>${script}</script></body></html>`;
}

async function eventExists(env: Env, eventId: string) {
  return env.CLASS_DB.prepare('SELECT id,title FROM events WHERE id=?').bind(eventId).first<Record<string, any>>();
}

async function createItem(env: Env, eventId: string, body: any) {
  const event = await eventExists(env, eventId); if (!event) throw new Error('活動不存在');
  if (!body?.name?.trim()) throw new Error('請填項目名稱');
  if (body.sessionId) {
    const s = await env.CLASS_DB.prepare('SELECT id FROM event_sessions WHERE id=? AND event_id=? AND is_active=1').bind(body.sessionId, eventId).first();
    if (!s) throw new Error('指定梯次不存在');
  }
  const itemId = uid('itm');
  await env.CLASS_DB.prepare(`INSERT INTO event_items(id,event_id,session_id,name,description,unit_label,unit_price,min_quantity,max_quantity,capacity,sort_order,is_active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`)
    .bind(itemId,eventId,body.sessionId||null,body.name.trim(),body.description||null,body.unitLabel||'人',Math.max(0,Number(body.unitPrice||0)),0,body.maxQuantity==null?10:Number(body.maxQuantity),body.capacity==null?null:Number(body.capacity),Number(body.sortOrder||0)).run();
  return { success:true, itemId };
}

async function listFields(env: Env, eventId: string) {
  const r = await env.CLASS_DB.prepare('SELECT * FROM event_form_fields WHERE event_id=? ORDER BY scope,sort_order,label').bind(eventId).all();
  return r.results;
}

async function createField(env: Env, eventId: string, body: any) {
  const event = await eventExists(env,eventId); if(!event) throw new Error('活動不存在');
  const allowed = ['text','number','tel','email','date','select','radio','checkbox','textarea'];
  if(!body?.label?.trim()) throw new Error('請填欄位名稱');
  const fieldType = allowed.includes(body.fieldType) ? body.fieldType : 'text';
  const scope = body.scope === 'attendee' ? 'attendee' : 'contact';
  const fieldKey = String(body.fieldKey || body.label).trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_\u4e00-\u9fff]/g,'').slice(0,40) || `field_${Date.now()}`;
  const options = Array.isArray(body.options) ? body.options.filter(Boolean) : String(body.options||'').split(/[,，\n]/).map((x:string)=>x.trim()).filter(Boolean);
  const id = uid('fld');
  await env.CLASS_DB.prepare(`INSERT INTO event_form_fields(id,event_id,scope,field_key,label,field_type,options_json,is_required,sort_order) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(id,eventId,scope,fieldKey,body.label.trim(),fieldType,options.length?JSON.stringify(options):null,body.isRequired?1:0,Number(body.sortOrder||0)).run();
  return { success:true, fieldId:id };
}

async function deleteField(env: Env, eventId: string, fieldId: string) {
  await env.CLASS_DB.prepare('DELETE FROM event_form_fields WHERE id=? AND event_id=?').bind(fieldId,eventId).run();
  return { success:true };
}

async function memberRegistrations(env: Env, provider: string, externalMemberId: string, tenant: string) {
  const r = await env.CLASS_DB.prepare(`SELECT r.id,r.registration_no,r.access_token,r.contact_name,r.total_quantity,r.total_amount,r.registration_status,r.payment_status,r.created_at,e.title event_title,e.starts_at,e.location_name,s.name session_name FROM registrations r JOIN events e ON e.id=r.event_id LEFT JOIN event_sessions s ON s.id=r.session_id WHERE r.tenant_key=? AND r.external_member_id=? AND (r.external_source=? OR EXISTS(SELECT 1 FROM identities i WHERE i.id=r.identity_id AND i.provider=?)) ORDER BY r.created_at DESC`).bind(tenant,externalMemberId,provider,provider).all();
  return r.results;
}

async function checkin(env: Env, registrationNo: string, operator = 'admin') {
  const r = await env.CLASS_DB.prepare(`SELECT r.id,r.registration_no,r.registration_status,r.payment_status,r.contact_name,r.total_quantity,e.title event_title FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.registration_no=?`).bind(registrationNo).first<Record<string,any>>();
  if(!r) throw new Error('找不到報名編號');
  if(r.registration_status==='cancelled'||r.registration_status==='expired') throw new Error('此報名已取消或失效');
  if(r.registration_status==='pending_payment') throw new Error('尚未完成付款，不可報到');
  if(r.registration_status==='checked_in') return { success:true, alreadyCheckedIn:true, registration:r };
  await env.CLASS_DB.batch([
    env.CLASS_DB.prepare('INSERT OR IGNORE INTO checkins(id,registration_id,checked_in_by) VALUES(?,?,?)').bind(uid('chk'),r.id,operator),
    env.CLASS_DB.prepare(`UPDATE registrations SET registration_status='checked_in',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(r.id)
  ]);
  return { success:true, alreadyCheckedIn:false, registration:{...r,registration_status:'checked_in'} };
}

async function configPage(env: Env, eventId: string) {
  const e = await env.CLASS_DB.prepare('SELECT * FROM events WHERE id=?').bind(eventId).first<Record<string,any>>();
  if(!e) return html(shell('活動設定','<div class="wrap"><div class="card warn">活動不存在</div></div>'));
  return html(shell(`${e.title}｜進階設定`, `<div class="wrap"><div class="row mobile" style="margin-bottom:12px"><a class="btn secondary" href="/admin">活動管理</a><a class="btn secondary" href="/admin/event/${encodeURIComponent(eventId)}">活動儀表板</a><a class="btn secondary" href="/event/${encodeURIComponent(eventId)}">前台預覽</a></div><div class="card"><h1>${esc(e.title)}</h1><p class="muted">V0.4 進階設定：梯次專屬項目、自訂欄位、現場報到。</p></div><div class="card"><h2>梯次與專屬項目</h2><div id="sessions" class="stack">載入中...</div><hr><h3>新增報名項目</h3><div class="grid2"><div class="field"><label>所屬梯次</label><select id="itemSession"><option value="">全活動共用</option></select></div><div class="field"><label>項目名稱</label><input id="itemName" placeholder="會員 / 一般 / 兒童"></div><div class="field"><label>單價</label><input id="itemPrice" type="number" min="0" value="0"></div><div class="field"><label>每筆最多</label><input id="itemMax" type="number" min="1" value="10"></div><div class="field"><label>項目總名額</label><input id="itemCapacity" type="number" min="1" placeholder="空白=不限"></div><div class="field"><label>單位</label><input id="itemUnit" value="人"></div></div><p><button id="addItem" class="btn primary">新增項目</button></p></div><div class="card"><h2>自訂報名欄位 Builder</h2><div id="fields" class="stack">載入中...</div><hr><div class="grid2"><div class="field"><label>欄位名稱</label><input id="fieldLabel" placeholder="飲食 / 車號 / 身分證"></div><div class="field"><label>套用對象</label><select id="fieldScope"><option value="contact">主要聯絡人</option><option value="attendee">每位參加者</option></select></div><div class="field"><label>欄位類型</label><select id="fieldType"><option value="text">文字</option><option value="tel">電話</option><option value="email">Email</option><option value="date">日期</option><option value="select">下拉選單</option><option value="radio">單選</option><option value="checkbox">複選</option><option value="textarea">多行文字</option></select></div><div class="field"><label>選項（逗號分隔）</label><input id="fieldOptions" placeholder="葷食,素食,不供餐"></div></div><p><label><input id="fieldRequired" type="checkbox"> 必填</label></p><button id="addField" class="btn primary">新增欄位</button></div><div class="card"><h2>現場快速報到</h2><div class="row mobile"><div class="field" style="flex:1"><label>報名編號</label><input id="checkinNo" placeholder="REG-260818-XXXXXX"></div><button id="checkinBtn" class="btn primary">確認報到</button></div><div id="checkinResult" style="margin-top:12px"></div></div></div>`, `
  const EVENT_ID=${JSON.stringify(eventId)};const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));const money=n=>new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:0}).format(Number(n||0));
  let detail;
  async function load(){const r=await fetch('/api/v1/events/'+encodeURIComponent(EVENT_ID));detail=await r.json();if(!detail.success)return;const sel=document.getElementById('itemSession');sel.innerHTML='<option value="">全活動共用</option>'+detail.sessions.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join('');document.getElementById('sessions').innerHTML=detail.sessions.length?detail.sessions.map(s=>'<div class="item"><b>'+esc(s.name)+'</b> <span class="muted">'+esc(s.starts_at||'')+'｜名額 '+(s.capacity??'不限')+'</span><div style="margin-top:8px">'+detail.items.filter(i=>i.session_id===s.id).map(i=>'<span class="pill">'+esc(i.name)+' '+money(i.unit_price)+'｜'+(i.capacity??'不限')+'</span>').join(' ')+'</div></div>').join(''):'<div class="muted">尚未建立梯次；共用項目仍可直接使用。</div>';await loadFields();}
  async function loadFields(){const r=await fetch('/api/v1/admin/events/'+encodeURIComponent(EVENT_ID)+'/fields');const d=await r.json();document.getElementById('fields').innerHTML=d.fields?.length?d.fields.map(f=>'<div class="item row between mobile"><div><b>'+esc(f.label)+'</b> <span class="pill">'+(f.scope==='attendee'?'每位參加者':'聯絡人')+'</span><div class="muted">'+esc(f.field_type)+(f.is_required?'｜必填':'')+'</div></div><button class="btn danger" data-del="'+esc(f.id)+'">刪除</button></div>').join(''):'<div class="muted">尚無自訂欄位</div>';document.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{await fetch('/api/v1/admin/events/'+encodeURIComponent(EVENT_ID)+'/fields/'+encodeURIComponent(b.dataset.del),{method:'DELETE'});loadFields()});}
  document.getElementById('addItem').onclick=async()=>{const body={sessionId:document.getElementById('itemSession').value||null,name:document.getElementById('itemName').value,unitPrice:Number(document.getElementById('itemPrice').value||0),maxQuantity:Number(document.getElementById('itemMax').value||10),capacity:document.getElementById('itemCapacity').value?Number(document.getElementById('itemCapacity').value):null,unitLabel:document.getElementById('itemUnit').value||'人'};const r=await fetch('/api/v1/admin/events/'+encodeURIComponent(EVENT_ID)+'/items',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!d.success){alert(d.error);return}document.getElementById('itemName').value='';load()};
  document.getElementById('addField').onclick=async()=>{const body={label:document.getElementById('fieldLabel').value,scope:document.getElementById('fieldScope').value,fieldType:document.getElementById('fieldType').value,options:document.getElementById('fieldOptions').value,isRequired:document.getElementById('fieldRequired').checked};const r=await fetch('/api/v1/admin/events/'+encodeURIComponent(EVENT_ID)+'/fields',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!d.success){alert(d.error);return}document.getElementById('fieldLabel').value='';document.getElementById('fieldOptions').value='';loadFields()};
  document.getElementById('checkinBtn').onclick=async()=>{const no=document.getElementById('checkinNo').value.trim();const r=await fetch('/api/v1/admin/checkin/'+encodeURIComponent(no),{method:'POST'});const d=await r.json();const out=document.getElementById('checkinResult');if(!d.success){out.innerHTML='<div class="warn">'+esc(d.error)+'</div>';return}out.innerHTML='<div class="ok"><b>'+esc(d.registration.contact_name)+'</b>｜'+esc(d.registration.event_title)+'｜'+d.registration.total_quantity+' 人'+(d.alreadyCheckedIn?'（已報到過）':'（報到成功）')+'</div>';document.getElementById('checkinNo').value=''};load();`));
}

function myPage() {
  return html(shell('我的報名', `<div class="wrap"><div class="card"><h1>我的報名</h1><p class="muted">提供 LINE Login、TDEA 或其他外部會員系統串接時使用。V0.4 先以 provider + external member ID 查詢。</p><div class="grid2"><div class="field"><label>Provider</label><input id="provider" value="external"></div><div class="field"><label>Member ID</label><input id="memberId"></div></div><p><button id="go" class="btn primary">查詢我的報名</button></p></div><div id="list" class="card"><span class="muted">請輸入會員識別資料</span></div></div>`, `const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));document.getElementById('go').onclick=async()=>{const p=document.getElementById('provider').value.trim(),m=document.getElementById('memberId').value.trim();if(!p||!m)return;const r=await fetch('/api/v1/member/'+encodeURIComponent(p)+'/'+encodeURIComponent(m)+'/registrations');const d=await r.json();document.getElementById('list').innerHTML=d.registrations?.length?'<h2>報名紀錄</h2><div class="stack">'+d.registrations.map(x=>'<a class="item" style="text-decoration:none;color:inherit" href="/registration/'+encodeURIComponent(x.access_token)+'"><b>'+esc(x.event_title)+'</b><div class="muted">'+esc(x.registration_no)+'｜'+esc(x.registration_status)+'｜'+x.total_quantity+' 人</div></a>').join('')+'</div>':'<div class="muted">查無報名紀錄</div>'};`));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url); const path = url.pathname.replace(/\/+$/,'') || '/';
    try {
      const cfg = path.match(/^\/admin\/event\/([^/]+)\/config$/); if(request.method==='GET'&&cfg) return configPage(env,cfg[1]);
      if(request.method==='GET'&&path==='/my') return myPage();

      const item = path.match(/^\/api\/v1\/admin\/events\/([^/]+)\/items$/); if(request.method==='POST'&&item) return json(await createItem(env,item[1],await request.json()));
      const fields = path.match(/^\/api\/v1\/admin\/events\/([^/]+)\/fields$/); if(fields){if(request.method==='GET')return json({success:true,fields:await listFields(env,fields[1])});if(request.method==='POST')return json(await createField(env,fields[1],await request.json()));}
      const fieldDel = path.match(/^\/api\/v1\/admin\/events\/([^/]+)\/fields\/([^/]+)$/); if(request.method==='DELETE'&&fieldDel) return json(await deleteField(env,fieldDel[1],fieldDel[2]));
      const member = path.match(/^\/api\/v1\/member\/([^/]+)\/([^/]+)\/registrations$/); if(request.method==='GET'&&member) return json({success:true,registrations:await memberRegistrations(env,decodeURIComponent(member[1]),decodeURIComponent(member[2]),url.searchParams.get('tenant')||'default')});
      const chk = path.match(/^\/api\/v1\/admin\/checkin\/([^/]+)$/); if(request.method==='POST'&&chk) return json(await checkin(env,decodeURIComponent(chk[1])));
      return legacy.fetch(request,env);
    } catch (error) {
      return json({success:false,error:error instanceof Error?error.message:'系統錯誤'},400);
    }
  }
};
