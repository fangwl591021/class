import type { Env } from './types';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: jsonHeaders });
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const uid = (p: string) => `${p}_${crypto.randomUUID().replaceAll('-', '')}`;

function page(title: string, body: string, script = '') {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
  *{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif;background:#f6f7f9;color:#1f2937}.wrap{max-width:980px;margin:0 auto;padding:16px}.card{background:#fff;border-radius:18px;padding:20px;box-shadow:0 8px 28px rgba(0,0,0,.06);margin-bottom:16px}h1,h2,h3{margin:0 0 12px}.muted{color:#6b7280}.row{display:flex;gap:10px;align-items:center}.between{justify-content:space-between}.stack{display:grid;gap:12px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}.field label{display:block;font-weight:700;margin-bottom:6px}.field input,.field select,.field textarea{width:100%;padding:11px;border:1px solid #d1d5db;border-radius:11px;font-size:16px}.btn{border:0;border-radius:11px;padding:11px 14px;font-size:15px;font-weight:800;cursor:pointer;text-decoration:none;display:inline-block}.primary{background:#111827;color:#fff}.secondary{background:#eef2f7;color:#111827}.danger{background:#dc2626;color:#fff}.ok{background:#ecfdf5;color:#166534;padding:10px 12px;border-radius:11px}.notice{background:#fff7ed;color:#9a3412;padding:10px 12px;border-radius:11px}.item{border:1px solid #e5e7eb;border-radius:13px;padding:13px}.pill{display:inline-block;background:#eef2ff;color:#3730a3;border-radius:999px;padding:4px 9px;font-size:12px;font-weight:800}.nav{display:flex;gap:8px;margin-bottom:14px}.nav a{text-decoration:none;color:#111827;background:white;padding:8px 11px;border-radius:10px;font-weight:700}.table{width:100%;border-collapse:collapse}.table th,.table td{padding:9px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:top}.hidden{display:none}@media(max-width:700px){.grid2,.grid3{grid-template-columns:1fr}.row.mobile{display:grid}.wrap{padding:10px}.card{border-radius:14px;padding:15px}.table{font-size:13px}}
  </style></head><body>${body}<script>${script}</script></body></html>`;
}

async function eventExists(env: Env, eventId: string) {
  return env.CLASS_DB.prepare('SELECT id,title FROM events WHERE id=?').bind(eventId).first<Record<string, any>>();
}

async function addItem(env: Env, eventId: string, body: any) {
  if (!await eventExists(env, eventId)) throw new Error('活動不存在');
  if (!body?.name?.trim()) throw new Error('請填項目名稱');
  if (body.sessionId) {
    const session = await env.CLASS_DB.prepare('SELECT id FROM event_sessions WHERE id=? AND event_id=? AND is_active=1').bind(body.sessionId, eventId).first();
    if (!session) throw new Error('梯次不存在或不屬於此活動');
  }
  const id = uid('itm');
  await env.CLASS_DB.prepare(`INSERT INTO event_items(id,event_id,session_id,name,description,unit_label,unit_price,min_quantity,max_quantity,capacity,sort_order,is_active)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`).bind(
      id, eventId, body.sessionId || null, body.name.trim(), body.description || null, body.unitLabel || '人',
      Math.max(0, Number(body.unitPrice || 0)), Math.max(0, Number(body.minQuantity || 0)),
      body.maxQuantity === '' || body.maxQuantity == null ? null : Math.max(0, Number(body.maxQuantity)),
      body.capacity === '' || body.capacity == null ? null : Math.max(0, Number(body.capacity)), Number(body.sortOrder || 0)
    ).run();
  return { id };
}

async function addField(env: Env, eventId: string, body: any) {
  if (!await eventExists(env, eventId)) throw new Error('活動不存在');
  const scope = body?.scope === 'attendee' ? 'attendee' : 'contact';
  const type = ['text','number','tel','email','date','select','radio','checkbox','textarea'].includes(body?.fieldType) ? body.fieldType : 'text';
  if (!body?.label?.trim()) throw new Error('請填欄位名稱');
  const fieldKey = String(body.fieldKey || body.label).trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_\u4e00-\u9fff]/g,'').slice(0,60);
  if (!fieldKey) throw new Error('欄位代碼無效');
  const options = Array.isArray(body.options) ? body.options.map((x:any)=>String(x).trim()).filter(Boolean) : String(body.optionsText || '').split(/[,，\n]/).map((x:string)=>x.trim()).filter(Boolean);
  const id = uid('fld');
  await env.CLASS_DB.prepare(`INSERT INTO event_form_fields(id,event_id,scope,field_key,label,field_type,options_json,is_required,sort_order)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(id,eventId,scope,fieldKey,body.label.trim(),type,options.length?JSON.stringify(options):null,body.isRequired?1:0,Number(body.sortOrder||0)).run();
  return { id, fieldKey };
}

async function deleteItem(env: Env, eventId: string, itemId: string) {
  const used = await env.CLASS_DB.prepare('SELECT 1 FROM registration_items WHERE item_id=? LIMIT 1').bind(itemId).first();
  if (used) {
    await env.CLASS_DB.prepare('UPDATE event_items SET is_active=0 WHERE id=? AND event_id=?').bind(itemId,eventId).run();
    return { success:true, mode:'disabled' };
  }
  await env.CLASS_DB.prepare('DELETE FROM event_items WHERE id=? AND event_id=?').bind(itemId,eventId).run();
  return { success:true, mode:'deleted' };
}

async function deleteField(env: Env, eventId: string, fieldId: string) {
  await env.CLASS_DB.prepare('DELETE FROM event_form_fields WHERE id=? AND event_id=?').bind(fieldId,eventId).run();
  return { success:true };
}

async function configData(env: Env, eventId: string) {
  const event = await env.CLASS_DB.prepare('SELECT * FROM events WHERE id=?').bind(eventId).first<Record<string,any>>();
  if (!event) return null;
  const [sessions,items,fields] = await Promise.all([
    env.CLASS_DB.prepare('SELECT * FROM event_sessions WHERE event_id=? AND is_active=1 ORDER BY sort_order,starts_at').bind(eventId).all(),
    env.CLASS_DB.prepare('SELECT * FROM event_items WHERE event_id=? AND is_active=1 ORDER BY session_id IS NULL DESC,sort_order,name').bind(eventId).all(),
    env.CLASS_DB.prepare('SELECT * FROM event_form_fields WHERE event_id=? ORDER BY scope,sort_order,label').bind(eventId).all(),
  ]);
  return { event, sessions:sessions.results, items:items.results, fields:fields.results };
}

async function validateCustomFields(env: Env, eventId: string, body: any) {
  const rows = await env.CLASS_DB.prepare('SELECT * FROM event_form_fields WHERE event_id=? AND is_required=1 ORDER BY scope,sort_order').bind(eventId).all<Record<string,any>>();
  for (const field of rows.results) {
    if (field.scope === 'contact') {
      const v = body?.customData?.[field.field_key];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) throw new Error(`請填寫：${field.label}`);
    } else {
      const attendees = Array.isArray(body?.attendees) ? body.attendees : [];
      for (let i=0;i<attendees.length;i++) {
        const v = attendees[i]?.customData?.[field.field_key];
        if (v == null || v === '' || (Array.isArray(v) && !v.length)) throw new Error(`第 ${i+1} 位參加者請填寫：${field.label}`);
      }
    }
  }
}

async function checkinLookup(env: Env, registrationNo: string) {
  const r = await env.CLASS_DB.prepare(`SELECT r.id,r.registration_no,r.contact_name,r.contact_phone,r.total_quantity,r.total_amount,r.registration_status,r.payment_status,e.title event_title,s.name session_name
    FROM registrations r JOIN events e ON e.id=r.event_id LEFT JOIN event_sessions s ON s.id=r.session_id WHERE r.registration_no=? LIMIT 1`).bind(registrationNo).first<Record<string,any>>();
  if (!r) return null;
  const items = await env.CLASS_DB.prepare('SELECT item_name_snapshot,quantity,subtotal FROM registration_items WHERE registration_id=?').bind(r.id).all();
  const checked = await env.CLASS_DB.prepare('SELECT checked_in_at,checked_in_by,note FROM checkins WHERE registration_id=?').bind(r.id).first<Record<string,any>>();
  return { registration:r, items:items.results, checkin:checked || null };
}

async function doCheckin(env: Env, registrationNo: string, body: any) {
  const r = await env.CLASS_DB.prepare('SELECT id,registration_status,payment_status FROM registrations WHERE registration_no=?').bind(registrationNo).first<Record<string,any>>();
  if (!r) throw new Error('找不到報名編號');
  if (['cancelled','expired'].includes(r.registration_status)) throw new Error('此報名已取消或失效');
  if (r.registration_status === 'pending_payment') throw new Error('此筆尚未完成正式報名');
  const old = await env.CLASS_DB.prepare('SELECT id FROM checkins WHERE registration_id=?').bind(r.id).first();
  if (old) return { success:true, alreadyCheckedIn:true };
  await env.CLASS_DB.batch([
    env.CLASS_DB.prepare('INSERT INTO checkins(id,registration_id,checked_in_by,note) VALUES(?,?,?,?)').bind(uid('chk'),r.id,body?.checkedInBy||'admin',body?.note||null),
    env.CLASS_DB.prepare(`UPDATE registrations SET registration_status='checked_in',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(r.id),
  ]);
  return { success:true, alreadyCheckedIn:false };
}

export function renderConfigPage(eventId: string) {
  const eid = JSON.stringify(eventId);
  return page('活動進階設定', `<div class="wrap"><div class="nav"><a href="/admin">活動管理</a><a href="/admin/event/${encodeURIComponent(eventId)}">活動儀表板</a></div><div id="head" class="card">載入中...</div><div class="grid2"><div class="card"><h2>梯次專屬項目</h2><p class="muted">同一活動可讓不同梯次使用不同項目、價格與名額。</p><div class="stack"><div class="field"><label>所屬梯次</label><select id="session"></select></div><div class="field"><label>項目名稱</label><input id="itemName" placeholder="例：會員票"></div><div class="grid2"><div class="field"><label>單價</label><input id="price" type="number" min="0" value="0"></div><div class="field"><label>單位</label><input id="unit" value="人"></div></div><div class="grid2"><div class="field"><label>每筆最多</label><input id="maxQty" type="number" min="0" value="10"></div><div class="field"><label>項目總名額</label><input id="capacity" type="number" min="0" placeholder="不填=不限"></div></div><button id="addItem" class="btn primary">新增項目</button></div></div><div class="card"><h2>自訂報名欄位</h2><p class="muted">不再為每個活動修改程式碼。</p><div class="stack"><div class="grid2"><div class="field"><label>套用位置</label><select id="scope"><option value="contact">主要聯絡人</option><option value="attendee">每位參加者</option></select></div><div class="field"><label>欄位類型</label><select id="fieldType"><option value="text">文字</option><option value="tel">電話</option><option value="email">Email</option><option value="date">日期</option><option value="select">下拉選單</option><option value="radio">單選</option><option value="checkbox">複選</option><option value="textarea">多行文字</option></select></div></div><div class="field"><label>欄位名稱</label><input id="label" placeholder="例：飲食習慣"></div><div class="field"><label>選項（逗號分隔）</label><input id="options" placeholder="葷食, 素食, 不用餐"></div><label><input id="required" type="checkbox"> 必填</label><button id="addField" class="btn primary">新增欄位</button></div></div></div><div class="grid2"><div class="card"><h2>目前項目</h2><div id="items" class="stack"></div></div><div class="card"><h2>目前欄位</h2><div id="fields" class="stack"></div></div></div></div>`, `
  const EID=${eid};const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));const money=n=>new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:0}).format(Number(n||0));let data;
  async function load(){const r=await fetch('/api/v1/admin/events/'+encodeURIComponent(EID)+'/config');const d=await r.json();if(!d.success)throw new Error(d.error);data=d;document.getElementById('head').innerHTML='<span class="pill">進階設定</span><h1>'+esc(d.event.title)+'</h1><p class="muted">梯次專屬價格與自訂欄位</p>';document.getElementById('session').innerHTML='<option value="">所有梯次共用</option>'+d.sessions.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join('');renderLists();}
  function renderLists(){const sm=Object.fromEntries(data.sessions.map(s=>[s.id,s.name]));document.getElementById('items').innerHTML=data.items.length?data.items.map(x=>'<div class="item"><div class="row between"><div><b>'+esc(x.name)+'</b><div class="muted">'+esc(sm[x.session_id]||'全梯次共用')+' · '+money(x.unit_price)+' / '+esc(x.unit_label||'人')+' · 名額 '+esc(x.capacity??'不限')+'</div></div><button class="btn danger" data-del-item="'+esc(x.id)+'">移除</button></div></div>').join(''):'<p class="muted">尚無項目</p>';document.getElementById('fields').innerHTML=data.fields.length?data.fields.map(x=>'<div class="item"><div class="row between"><div><b>'+esc(x.label)+'</b><div class="muted">'+(x.scope==='attendee'?'每位參加者':'聯絡人')+' · '+esc(x.field_type)+(x.is_required?' · 必填':'')+'</div></div><button class="btn danger" data-del-field="'+esc(x.id)+'">移除</button></div></div>').join(''):'<p class="muted">尚無自訂欄位</p>';bindDelete();}
  function bindDelete(){document.querySelectorAll('[data-del-item]').forEach(b=>b.onclick=async()=>{if(!confirm('確定移除此項目？已有報名紀錄時會改為停用，不刪除歷史資料。'))return;await fetch('/api/v1/admin/events/'+encodeURIComponent(EID)+'/items/'+encodeURIComponent(b.dataset.delItem),{method:'DELETE'});load()});document.querySelectorAll('[data-del-field]').forEach(b=>b.onclick=async()=>{if(!confirm('確定移除此欄位？'))return;await fetch('/api/v1/admin/events/'+encodeURIComponent(EID)+'/fields/'+encodeURIComponent(b.dataset.delField),{method:'DELETE'});load()});}
  document.getElementById('addItem').onclick=async()=>{const body={sessionId:document.getElementById('session').value||null,name:document.getElementById('itemName').value,unitPrice:Number(document.getElementById('price').value||0),unitLabel:document.getElementById('unit').value||'人',maxQuantity:document.getElementById('maxQty').value,capacity:document.getElementById('capacity').value};const r=await fetch('/api/v1/admin/events/'+encodeURIComponent(EID)+'/items',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!d.success){alert(d.error);return}document.getElementById('itemName').value='';load()};
  document.getElementById('addField').onclick=async()=>{const body={scope:document.getElementById('scope').value,fieldType:document.getElementById('fieldType').value,label:document.getElementById('label').value,optionsText:document.getElementById('options').value,isRequired:document.getElementById('required').checked};const r=await fetch('/api/v1/admin/events/'+encodeURIComponent(EID)+'/fields',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!d.success){alert(d.error);return}document.getElementById('label').value='';document.getElementById('options').value='';load()};load().catch(e=>document.getElementById('head').innerHTML='<div class="notice">'+esc(e.message)+'</div>');`);
}

export function renderCheckinPage() {
  return page('活動報到', `<div class="wrap"><div class="nav"><a href="/admin">活動管理</a></div><div class="card"><h1>現場報到</h1><p class="muted">輸入或掃描報名編號後確認報到。</p><div class="row mobile"><div class="field" style="flex:1"><label>報名編號</label><input id="code" placeholder="REG-260818-XXXXXX" autocomplete="off"></div><button id="lookup" class="btn primary">查詢</button></div></div><div id="result"></div></div>`, `
  const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));const money=n=>new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:0}).format(Number(n||0));const code=document.getElementById('code');
  async function lookup(){const v=code.value.trim();if(!v)return;const r=await fetch('/api/v1/admin/checkin/'+encodeURIComponent(v));const d=await r.json();const el=document.getElementById('result');if(!d.success){el.innerHTML='<div class="card notice">'+esc(d.error||'找不到資料')+'</div>';return}const x=d.registration;el.innerHTML='<div class="card"><span class="pill">'+esc(x.registration_status)+'</span><h2>'+esc(x.event_title)+'</h2><h3>'+esc(x.contact_name)+'</h3><p>'+esc(x.registration_no)+(x.session_name?' · '+esc(x.session_name):'')+'</p><div class="stack">'+d.items.map(i=>'<div class="item row between"><span>'+esc(i.item_name_snapshot)+' × '+i.quantity+'</span><b>'+money(i.subtotal)+'</b></div>').join('')+'</div><p>付款：<b>'+esc(x.payment_status)+'</b></p>'+(d.checkin?'<div class="ok">已於 '+esc(d.checkin.checked_in_at)+' 報到</div>':'<button id="go" class="btn primary" style="width:100%">確認報到</button>')+'</div>';document.getElementById('go')?.addEventListener('click',async()=>{const rr=await fetch('/api/v1/admin/checkin/'+encodeURIComponent(v),{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const dd=await rr.json();if(!dd.success){alert(dd.error);return}lookup()});}
  document.getElementById('lookup').onclick=lookup;code.addEventListener('keydown',e=>{if(e.key==='Enter')lookup()});code.focus();`);
}

export async function handleV04(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname.replace(/\/+$/,'') || '/';
  try {
    const cfgPage = path.match(/^\/admin\/event\/([^/]+)\/config$/);
    if (request.method === 'GET' && cfgPage) return html(renderConfigPage(cfgPage[1]));
    if (request.method === 'GET' && path === '/admin/checkin') return html(renderCheckinPage());

    const cfg = path.match(/^\/api\/v1\/admin\/events\/([^/]+)\/config$/);
    if (request.method === 'GET' && cfg) { const d=await configData(env,cfg[1]); return d?json({success:true,...d}):json({success:false,error:'活動不存在'},404); }
    const item = path.match(/^\/api\/v1\/admin\/events\/([^/]+)\/items$/);
    if (request.method === 'POST' && item) return json({success:true,...await addItem(env,item[1],await request.json<any>())},201);
    const itemDel = path.match(/^\/api\/v1\/admin\/events\/([^/]+)\/items\/([^/]+)$/);
    if (request.method === 'DELETE' && itemDel) return json(await deleteItem(env,itemDel[1],itemDel[2]));
    const field = path.match(/^\/api\/v1\/admin\/events\/([^/]+)\/fields$/);
    if (request.method === 'POST' && field) return json({success:true,...await addField(env,field[1],await request.json<any>())},201);
    const fieldDel = path.match(/^\/api\/v1\/admin\/events\/([^/]+)\/fields\/([^/]+)$/);
    if (request.method === 'DELETE' && fieldDel) return json(await deleteField(env,fieldDel[1],fieldDel[2]));

    const ck = path.match(/^\/api\/v1\/admin\/checkin\/([^/]+)$/);
    if (request.method === 'GET' && ck) { const d=await checkinLookup(env,decodeURIComponent(ck[1])); return d?json({success:true,...d}):json({success:false,error:'找不到報名編號'},404); }
    if (request.method === 'POST' && ck) return json(await doCheckin(env,decodeURIComponent(ck[1]),await request.json<any>()));

    const reg = path.match(/^\/api\/v1\/events\/([^/]+)\/registrations$/);
    if (request.method === 'POST' && reg) {
      const clone = request.clone();
      const body = await clone.json<any>();
      await validateCustomFields(env,reg[1],body);
      return null;
    }
    return null;
  } catch (error) {
    return json({success:false,error:error instanceof Error?error.message:'系統錯誤'},400);
  }
}
