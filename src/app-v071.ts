import app from './app-v07';
import type { Env } from './types';

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}});
const rawToken=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
const uid=(p:string)=>`${p}_${crypto.randomUUID().replaceAll('-','')}`;
async function sha256(v:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function cookies(req:Request){const out:Record<string,string>={};for(const p of (req.headers.get('cookie')||'').split(';')){const [k,...r]=p.trim().split('=');if(k)out[k]=decodeURIComponent(r.join('='));}return out;}
async function isAdmin(req:Request,env:Env){if(!env.ADMIN_TOKEN)return true;const bearer=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(bearer===env.ADMIN_TOKEN)return true;return cookies(req).class_admin===await sha256(env.ADMIN_TOKEN);}
async function protectedAdmin(req:Request,env:Env){if(await isAdmin(req,env))return null;const path=new URL(req.url).pathname;if(path.startsWith('/api/'))return json({success:false,error:'ADMIN_AUTH_REQUIRED'},401);return new Response(null,{status:302,headers:{location:'/admin/login'}});}

async function consumeHandoff(req:Request,env:Env){
  const code=new URL(req.url).searchParams.get('code');if(!code)throw new Error('缺少 handoff code');
  const h=await env.CLASS_DB.prepare(`SELECT h.*,s.provider,s.external_member_id,s.display_name,s.phone,s.email,s.avatar_url,s.expires_at session_expires FROM identity_handoffs h JOIN identity_sessions s ON s.id=h.identity_session_id WHERE h.handoff_code_hash=? AND h.consumed_at IS NULL AND datetime(h.expires_at)>datetime('now') AND datetime(s.expires_at)>datetime('now') LIMIT 1`).bind(await sha256(code)).first<Record<string,any>>();
  if(!h)throw new Error('handoff 已失效或使用過');
  const browserToken=`ids_${rawToken()}`;
  const browserSessionId=uid('ids');
  await env.CLASS_DB.batch([
    env.CLASS_DB.prepare(`INSERT INTO identity_sessions(id,tenant_key,provider,external_member_id,display_name,phone,email,avatar_url,session_token_hash,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(browserSessionId,h.tenant_key,h.provider,h.external_member_id,h.display_name||null,h.phone||null,h.email||null,h.avatar_url||null,await sha256(browserToken),h.session_expires),
    env.CLASS_DB.prepare(`UPDATE identity_handoffs SET consumed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(h.id),
    env.CLASS_DB.prepare(`INSERT INTO integration_audit_logs(id,tenant_key,actor_type,actor_id,action,target_type,target_id,metadata_json) VALUES(?,?,?,?,?,?,?,?)`).bind(uid('aud'),h.tenant_key,'handoff',h.id,'identity_handoff.consumed','identity_session',browserSessionId,JSON.stringify({sourceIdentitySessionId:h.identity_session_id}))
  ]);
  return new Response(null,{status:302,headers:{location:h.return_path,'set-cookie':`class_identity=${encodeURIComponent(browserToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`}});
}

export default{async fetch(request:Request,env:Env):Promise<Response>{const path=new URL(request.url).pathname.replace(/\/+$/,'')||'/';try{
  if(request.method==='GET'&&path==='/auth/handoff')return consumeHandoff(request,env);
  if(path==='/admin/api-clients'||/^\/api\/v1\/admin\/api-clients\/[^/]+\/disable$/.test(path)){const denied=await protectedAdmin(request,env);if(denied)return denied;}
  return app.fetch(request,env);
}catch(e){return json({success:false,error:e instanceof Error?e.message:'系統錯誤'},400);}}};
