import app from './app-v05';
import type { Env } from './types';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: jsonHeaders });
const html = (body: string, status = 200, headers: HeadersInit = {}) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const uid = (p: string) => `${p}_${crypto.randomUUID().replaceAll('-', '')}`;
const token = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>\"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;' }[c] || c));

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
}

function cookies(request: Request) {
  const out: Record<string,string> = {};
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k,...rest] = part.trim().split('='); if(k) out[k] = decodeURIComponent(rest.join('='));
  }
  return out;
}

function shell(title: string, body: string) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:#1f2937;font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif}.wrap{max-width:680px;margin:48px auto;padding:16px}.card{background:white;border-radius:18px;padding:24px;box-shadow:0 8px 28px rgba(0,0,0,.07)}h1{margin-top:0}.field label{display:block;font-weight:800;margin:14px 0 6px}.field input{width:100%;padding:12px;border:1px solid #d1d5db;border-radius:12px;font-size:16px}.btn{display:inline-block;border:0;border-radius:12px;padding:12px 16px;font-size:16px;font-weight:800;text-decoration:none;cursor:pointer}.primary{background:#111827;color:white}.line{background:#06c755;color:white}.secondary{background:#eef2f7;color:#111827}.muted{color:#6b7280}.stack{display:grid;gap:10px}.warn{background:#fff7ed;color:#9a3412;padding:12px;border-radius:12px}</style></head><body><div class="wrap"><div class="card">${body}</div></div></body></html>`;
}

async function adminExpected(env: Env) { return env.ADMIN_TOKEN ? sha256(env.ADMIN_TOKEN) : null; }
async function isAdmin(request: Request, env: Env) {
  if (!env.ADMIN_TOKEN) return true; // development mode; production must configure secret
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if (bearer && bearer === env.ADMIN_TOKEN) return true;
  return cookies(request).class_admin === await adminExpected(env);
}

function adminLoginPage(message = '') {
  return html(shell('管理員登入', `<h1>管理員登入</h1><p class="muted">正式部署時使用 Cloudflare secret <code>ADMIN_TOKEN</code>。</p>${message?`<div class="warn">${esc(message)}</div>`:''}<form method="post" action="/admin/login"><div class="field"><label>管理密碼</label><input name="token" type="password" autocomplete="current-password" required></div><p><button class="btn primary" type="submit">登入管理後台</button></p></form>`));
}

async function handleAdminLogin(request: Request, env: Env) {
  if (!env.ADMIN_TOKEN) return new Response(null,{status:302,headers:{location:'/admin'}});
  const form = new URLSearchParams(await request.text());
  if (form.get('token') !== env.ADMIN_TOKEN) return adminLoginPage('密碼錯誤');
  const value = await sha256(env.ADMIN_TOKEN);
  return new Response(null,{status:302,headers:{location:'/admin','set-cookie':`class_admin=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`}});
}

async function requireAdmin(request: Request, env: Env) {
  if (await isAdmin(request,env)) return null;
  if (new URL(request.url).pathname.startsWith('/api/')) return json({success:false,error:'ADMIN_AUTH_REQUIRED'},401);
  return new Response(null,{status:302,headers:{location:'/admin/login'}});
}

async function apiClientFromRequest(request: Request, env: Env) {
  const raw = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if(!raw) return null;
  const hash = await sha256(raw);
  const client = await env.CLASS_DB.prepare(`SELECT * FROM api_clients WHERE api_key_hash=? AND is_active=1 LIMIT 1`).bind(hash).first<Record<string,any>>();
  if(client) await env.CLASS_DB.prepare('UPDATE api_clients SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').bind(client.id).run();
  return client;
}

async function createApiClient(env: Env, body: any) {
  if(!body?.name?.trim()) throw new Error('請填 API Client 名稱');
  const raw = `cls_${token()}`;
  const id = uid('api');
  const scopes = Array.isArray(body.scopes) && body.scopes.length ? body.scopes : ['events:read','registrations:write','identity:write'];
  await env.CLASS_DB.prepare(`INSERT INTO api_clients(id,tenant_key,name,api_key_hash,scopes_json) VALUES(?,?,?,?,?)`).bind(id,body.tenantKey||'default',body.name.trim(),await sha256(raw),JSON.stringify(scopes)).run();
  return {success:true,id,tenantKey:body.tenantKey||'default',apiKey:raw,scopes,note:'API Key 僅此回傳一次，請立即保存。'};
}

async function createIdentitySession(env: Env, client: Record<string,any>, body: any) {
  if(!body?.provider || !body?.externalMemberId) throw new Error('provider 與 externalMemberId 為必填');
  const sessionToken = `ids_${token()}`;
  const id = uid('ids');
  const expiresSeconds = Math.min(Math.max(Number(body.expiresSeconds||86400),300),2592000);
  const expires = new Date(Date.now()+expiresSeconds*1000).toISOString();
  await env.CLASS_DB.prepare(`INSERT INTO identity_sessions(id,tenant_key,provider,external_member_id,display_name,phone,email,avatar_url,session_token_hash,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id,client.tenant_key,body.provider,body.externalMemberId,body.displayName||null,body.phone||null,body.email||null,body.avatarUrl||null,await sha256(sessionToken),expires).run();
  await env.CLASS_DB.prepare(`INSERT INTO integration_audit_logs(id,tenant_key,actor_type,actor_id,action,target_type,target_id,metadata_json) VALUES(?,?,?,?,?,?,?,?)`).bind(uid('aud'),client.tenant_key,'api_client',client.id,'identity_session.created','identity_session',id,JSON.stringify({provider:body.provider,externalMemberId:body.externalMemberId})).run();
  return {success:true,identityToken:sessionToken,expiresAt:expires,tenantKey:client.tenant_key};
}

async function identityFromToken(env: Env, raw?: string | null) {
  if(!raw) return null;
  const session = await env.CLASS_DB.prepare(`SELECT * FROM identity_sessions WHERE session_token_hash=? AND datetime(expires_at)>datetime('now') LIMIT 1`).bind(await sha256(raw)).first<Record<string,any>>();
  if(session) await env.CLASS_DB.prepare('UPDATE identity_sessions SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').bind(session.id).run();
  return session;
}

async function identityForRequest(request: Request, env: Env) {
  const header = request.headers.get('x-class-identity-token');
  const cookie = cookies(request).class_identity;
  return identityFromToken(env,header || cookie || null);
}

async function injectVerifiedIdentity(request: Request, env: Env, eventId: string) {
  const identity = await identityForRequest(request,env); if(!identity) return request;
  const event = await env.CLASS_DB.prepare('SELECT tenant_key FROM events WHERE id=?').bind(eventId).first<Record<string,any>>();
  if(!event || event.tenant_key !== identity.tenant_key) throw new Error('登入身份與活動租戶不符');
  const body:any = await request.clone().json();
  body.identity = {type:'member',provider:identity.provider,externalMemberId:identity.external_member_id,displayName:identity.display_name,phone:identity.phone,email:identity.email};
  body.externalSource = identity.provider;
  body.externalMemberId = identity.external_member_id;
  body.contact = body.contact || {};
  if(!body.contact.name) body.contact.name = identity.display_name || '';
  if(!body.contact.phone && identity.phone) body.contact.phone = identity.phone;
  if(!body.contact.email && identity.email) body.contact.email = identity.email;
  return new Request(request.url,{method:request.method,headers:request.headers,body:JSON.stringify(body)});
}

async function loginPage(request: Request, env: Env) {
  const url = new URL(request.url); const ret = url.searchParams.get('return') || '/events';
  const lineReady = !!(env.LINE_CHANNEL_ID && env.LINE_CHANNEL_SECRET && env.LINE_REDIRECT_URI);
  const current = await identityForRequest(request,env);
  if(current) return html(shell('已登入',`<h1>已登入</h1><p>${esc(current.display_name||current.external_member_id)}</p><p><a class="btn primary" href="${esc(ret)}">繼續報名</a></p>`));
  return html(shell('登入',`<h1>快速登入</h1><p class="muted">登入後可自動帶入會員身份、查詢我的報名並避免重複填寫。</p><div class="stack">${lineReady?`<a class="btn line" href="/auth/line/start?return=${encodeURIComponent(ret)}">使用 LINE 登入</a>`:`<div class="warn">LINE Login 尚未設定。需設定 LINE_CHANNEL_ID、LINE_CHANNEL_SECRET、LINE_REDIRECT_URI。</div>`}<a class="btn secondary" href="${esc(ret)}">不登入，返回活動</a></div>`));
}

async function lineStart(request: Request, env: Env) {
  if(!env.LINE_CHANNEL_ID || !env.LINE_CHANNEL_SECRET || !env.LINE_REDIRECT_URI) return html(shell('LINE Login','<div class="warn">LINE Login 尚未完成環境設定。</div>'),503);
  const url = new URL(request.url); const ret = url.searchParams.get('return') || '/events'; const state = token().slice(0,48);
  const auth = new URL('https://access.line.me/oauth2/v2.1/authorize');
  auth.searchParams.set('response_type','code');auth.searchParams.set('client_id',env.LINE_CHANNEL_ID);auth.searchParams.set('redirect_uri',env.LINE_REDIRECT_URI);auth.searchParams.set('state',state);auth.searchParams.set('scope','profile openid');
  return new Response(null,{status:302,headers:{location:auth.toString(),'set-cookie':`class_line_state=${encodeURIComponent(state+'|'+ret)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`}});
}

async function lineCallback(request: Request, env: Env) {
  if(!env.LINE_CHANNEL_ID || !env.LINE_CHANNEL_SECRET || !env.LINE_REDIRECT_URI) throw new Error('LINE Login 尚未設定');
  const url = new URL(request.url), code=url.searchParams.get('code'), state=url.searchParams.get('state'); const packed=cookies(request).class_line_state||''; const [expected,...retParts]=packed.split('|'); const ret=retParts.join('|')||'/events';
  if(!code || !state || state!==expected) throw new Error('LINE Login state 驗證失敗');
  const tokenResp = await fetch('https://api.line.me/oauth2/v2.1/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:env.LINE_REDIRECT_URI,client_id:env.LINE_CHANNEL_ID,client_secret:env.LINE_CHANNEL_SECRET})});
  const tokenData:any = await tokenResp.json(); if(!tokenResp.ok || !tokenData.access_token) throw new Error('LINE token 交換失敗');
  const profileResp = await fetch('https://api.line.me/v2/profile',{headers:{authorization:`Bearer ${tokenData.access_token}`}}); const profile:any=await profileResp.json(); if(!profileResp.ok || !profile.userId) throw new Error('LINE profile 取得失敗');
  const sessionToken=`ids_${token()}`; const expires=new Date(Date.now()+30*86400*1000).toISOString();
  await env.CLASS_DB.prepare(`INSERT INTO identity_sessions(id,tenant_key,provider,external_member_id,display_name,avatar_url,session_token_hash,expires_at) VALUES(?,?,?,?,?,?,?,?)`).bind(uid('ids'),'default','line',profile.userId,profile.displayName||null,profile.pictureUrl||null,await sha256(sessionToken),expires).run();
  return new Response(null,{status:302,headers:{location:ret,'set-cookie':`class_identity=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`}});
}

async function decorateEvent(request: Request, env: Env, response: Response, eventId: string) {
  if(!response.headers.get('content-type')?.includes('text/html')) return response;
  const event = await env.CLASS_DB.prepare('SELECT identity_mode FROM events WHERE id=?').bind(eventId).first<Record<string,any>>(); if(!event) return response;
  const identity = await identityForRequest(request,env);
  if(event.identity_mode==='login_required' && !identity) return new Response(null,{status:302,headers:{location:`/login?return=${encodeURIComponent('/event/'+eventId)}`}});
  let text = await response.text();
  const banner = identity
    ? `<div style="max-width:860px;margin:10px auto;padding:0 10px"><div style="background:#ecfdf5;color:#166534;padding:10px 14px;border-radius:12px;font-weight:700">已登入：${esc(identity.display_name||identity.external_member_id)}</div></div>`
    : event.identity_mode==='hybrid' ? `<div style="max-width:860px;margin:10px auto;padding:0 10px"><a href="/login?return=${encodeURIComponent('/event/'+eventId)}" style="display:block;text-align:center;background:#06c755;color:#fff;padding:11px;border-radius:12px;text-decoration:none;font-weight:800">LINE / 會員登入快速報名</a></div>` : '';
  text = text.replace('<body>','<body>'+banner);
  return html(text,response.status);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url), path = url.pathname.replace(/\/+$/,'') || '/';
    try {
      if(request.method==='GET'&&path==='/admin/login') return adminLoginPage();
      if(request.method==='POST'&&path==='/admin/login') return handleAdminLogin(request,env);
      if(request.method==='GET'&&path==='/login') return loginPage(request,env);
      if(request.method==='GET'&&path==='/auth/line/start') return lineStart(request,env);
      if(request.method==='GET'&&path==='/auth/line/callback') return lineCallback(request,env);

      if(path.startsWith('/admin') || path.startsWith('/api/v1/admin')) { const denied=await requireAdmin(request,env); if(denied)return denied; }

      if(request.method==='POST'&&path==='/api/v1/admin/api-clients') return json(await createApiClient(env,await request.json()));

      if(path.startsWith('/api/v1/integration/')) {
        const client=await apiClientFromRequest(request,env); if(!client)return json({success:false,error:'INVALID_API_KEY'},401);
        if(request.method==='GET'&&path==='/api/v1/integration/events') {
          const rows=await env.CLASS_DB.prepare(`SELECT id,title,slug,description,banner_url,location_name,starts_at,ends_at,capacity,identity_mode,registration_success_mode,status FROM events WHERE tenant_key=? AND status='published' ORDER BY starts_at IS NULL,starts_at ASC`).bind(client.tenant_key).all();
          return json({success:true,tenantKey:client.tenant_key,events:rows.results});
        }
        if(request.method==='POST'&&path==='/api/v1/integration/identity/session') return json(await createIdentitySession(env,client,await request.json()),201);
      }

      const reg = path.match(/^\/api\/v1\/events\/([^/]+)\/registrations$/);
      if(request.method==='POST'&&reg) request = await injectVerifiedIdentity(request,env,reg[1]);

      const eventPage = path.match(/^\/event\/([^/]+)$/);
      if(request.method==='GET'&&eventPage) return decorateEvent(request,env,await app.fetch(request,env),eventPage[1]);

      return app.fetch(request,env);
    } catch(error) {
      return json({success:false,error:error instanceof Error?error.message:'系統錯誤'},400);
    }
  }
};
