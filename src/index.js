import { DurableObject } from "cloudflare:workers";

const SCHEMA=["CREATE TABLE IF NOT EXISTS users (\n  id TEXT PRIMARY KEY,\n  phone TEXT NOT NULL UNIQUE,\n  name TEXT NOT NULL,\n  done INTEGER NOT NULL DEFAULT 0,\n  lat REAL,\n  lng REAL,\n  at INTEGER,\n  created INTEGER NOT NULL\n)", "CREATE TABLE IF NOT EXISTS sessions (\n  token_hash TEXT PRIMARY KEY,\n  uid TEXT NOT NULL,\n  exp INTEGER NOT NULL,\n  FOREIGN KEY(uid) REFERENCES users(id) ON DELETE CASCADE\n)", "CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(exp)", "CREATE TABLE IF NOT EXISTS otps (\n  phone TEXT PRIMARY KEY,\n  hash TEXT NOT NULL,\n  exp INTEGER NOT NULL,\n  tries INTEGER NOT NULL DEFAULT 0\n)", "CREATE TABLE IF NOT EXISTS listings (\n  id TEXT PRIMARY KEY,\n  uid TEXT NOT NULL,\n  type TEXT NOT NULL CHECK(type IN ('have','need')),\n  amount INTEGER NOT NULL,\n  exp INTEGER NOT NULL,\n  status TEXT NOT NULL DEFAULT 'open',\n  FOREIGN KEY(uid) REFERENCES users(id) ON DELETE CASCADE\n)", "CREATE INDEX IF NOT EXISTS idx_listings_open ON listings(status, exp)", "CREATE INDEX IF NOT EXISTS idx_listings_uid ON listings(uid)", "CREATE TABLE IF NOT EXISTS threads (\n  id TEXT PRIMARY KEY,\n  lid TEXT NOT NULL,\n  amount INTEGER NOT NULL,\n  type TEXT NOT NULL,\n  a TEXT NOT NULL,\n  b TEXT NOT NULL,\n  status TEXT NOT NULL DEFAULT 'open',\n  confirmed TEXT NOT NULL DEFAULT '[]',\n  created INTEGER NOT NULL,\n  FOREIGN KEY(a) REFERENCES users(id) ON DELETE CASCADE,\n  FOREIGN KEY(b) REFERENCES users(id) ON DELETE CASCADE\n)", "CREATE INDEX IF NOT EXISTS idx_threads_user_a ON threads(a, created)", "CREATE INDEX IF NOT EXISTS idx_threads_user_b ON threads(b, created)", "CREATE TABLE IF NOT EXISTS messages (\n  id TEXT PRIMARY KEY,\n  tid TEXT NOT NULL,\n  from_uid TEXT NOT NULL,\n  text TEXT NOT NULL,\n  at INTEGER NOT NULL,\n  FOREIGN KEY(tid) REFERENCES threads(id) ON DELETE CASCADE,\n  FOREIGN KEY(from_uid) REFERENCES users(id) ON DELETE CASCADE\n)", "CREATE INDEX IF NOT EXISTS idx_messages_tid ON messages(tid, at)", "CREATE TABLE IF NOT EXISTS reports (\n  id TEXT PRIMARY KEY,\n  by_uid TEXT NOT NULL,\n  who_uid TEXT NOT NULL,\n  tid TEXT NOT NULL,\n  reason TEXT NOT NULL,\n  at INTEGER NOT NULL,\n  last_json TEXT NOT NULL\n)", "CREATE TABLE IF NOT EXISTS blocks (\n  by_uid TEXT NOT NULL,\n  who_uid TEXT NOT NULL,\n  PRIMARY KEY(by_uid, who_uid)\n)"];
let schemaReady=false;
async function ensureSchema(env){if(schemaReady)return;await env.DB.batch(SCHEMA.map(q=>env.DB.prepare(q)));schemaReady=true;}
const guestHits=new Map();
const guestOk=ip=>{const t=Date.now(),h=guestHits.get(ip);if(!h||h.r<t){guestHits.set(ip,{c:1,r:t+3600000});return true;}return ++h.c<=20;};
const json = (o, status=200, extra={}) => new Response(JSON.stringify(o), {status, headers:{"Content-Type":"application/json; charset=utf-8", ...extra}});
const err = (m,c=400) => { const e=new Error(m); e.status=c; throw e; };
const id = () => crypto.randomUUID().replaceAll("-", "").slice(0,16);
async function sha(s){ const b=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))); return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join(""); }
const escPhone = s => String(s||"").replace(/[\s-]/g,"");
const rad = x => x*Math.PI/180;
const dist=(a,b)=>{const h=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;return 12742*Math.asin(Math.sqrt(h));};
const bearing=(a,b)=>{const y=Math.sin(rad(b.lng-a.lng))*Math.cos(rad(b.lat)),x=Math.cos(rad(a.lat))*Math.sin(rad(b.lat))-Math.sin(rad(a.lat))*Math.cos(rad(b.lat))*Math.cos(rad(b.lng-a.lng));return(Math.atan2(y,x)*180/Math.PI+360)%360;};
const pubU=u=>({id:u.id,name:u.name,done:u.done||0});
const readBody=async req=>{let t=await req.text(); if(t.length>10000)err("Request too large",413); try{return t?JSON.parse(t):{}}catch{err("Invalid JSON",400)}};
const parseRow = r => r ? {...r} : null;
const normPhone=(env,p)=>{p=String(p||"").replace(/[\s-]/g,"");return p[0]==="+"?p:/^\d{10}$/.test(p)?"+"+(env.DEFAULT_COUNTRY_CODE||"91")+p:"+"+p;};
async function sendSms(env,to,code){
  if(env.TWILIO_ACCOUNT_SID&&env.TWILIO_AUTH_TOKEN&&env.TWILIO_FROM){const r=await fetch("https://api.twilio.com/2010-04-01/Accounts/"+env.TWILIO_ACCOUNT_SID+"/Messages.json",{method:"POST",headers:{Authorization:"Basic "+btoa(env.TWILIO_ACCOUNT_SID+":"+env.TWILIO_AUTH_TOKEN),"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({To:to,From:env.TWILIO_FROM,Body:"Your Near Cash code is "+code})});if(!r.ok){console.error("Twilio error",r.status,await r.text());err("Could not send the code",502);}return;}
const u=env.SMS_WEBHOOK_URL;if(!u)err("SMS provider not configured",501);const r=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+(env.SMS_WEBHOOK_TOKEN||"")},body:JSON.stringify({to,message:"Your Near Cash code is "+code})});if(!r.ok)err("Could not send the code",502);}
async function getUser(env,req,url){const tok=(req.headers.get("Authorization")||"").slice(7)||url.searchParams.get("token")||"";if(!tok)err("Please sign in",401);const h=await sha(tok);const r=await env.DB.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.uid WHERE s.token_hash=? AND s.exp>? LIMIT 1").bind(h,Date.now()).first();if(!r)err("Please sign in",401);return {u:r,tok,h};}
async function blocked(env,a,b){return !!await env.DB.prepare("SELECT 1 FROM blocks WHERE (by_uid=? AND who_uid=?) OR (by_uid=? AND who_uid=?) LIMIT 1").bind(a,b,b,a).first();}
async function push(env,uid,event){const stub=env.USER_STREAM.get(env.USER_STREAM.idFromName(uid));await stub.fetch("https://stream/push",{method:"POST",body:JSON.stringify(event)}).catch(()=>{});}
async function api(env,req,p,url){
  const m=req.method, b=m==="POST"?await readBody(req):{};
  if(p==="guest"&&m==="POST"){
    if(env.REQUIRE_SIGNIN==="true")err("Sign in required",403);
    if(!guestOk(req.headers.get("CF-Connecting-IP")||"?"))err("Too many new accounts from this network. Try again later.",429);
    const uid=id(),name="Guest "+String(crypto.getRandomValues(new Uint32Array(1))[0]%9000+1000);
    await env.DB.prepare("INSERT INTO users(id,phone,name,done,created) VALUES(?,?,?,?,?)").bind(uid,"guest:"+uid,name,0,Date.now()).run();
    const token=crypto.randomUUID()+crypto.randomUUID(),h=await sha(token);
    await env.DB.prepare("INSERT INTO sessions(token_hash,uid,exp) VALUES(?,?,?)").bind(h,uid,Date.now()+2592e6).run();
    return json({token,me:{id:uid,name,done:0}});
  }
  if(p==="otp"&&m==="POST"){
    const ph=normPhone(env,b.phone); if(!/^\+\d{11,14}$/.test(ph))err("Enter a valid phone number");
    const old=await env.DB.prepare("SELECT phone FROM otps WHERE phone=? AND exp>? ").bind(ph,Date.now()).first();
    if(old&&env.DEV_OTP!=="true")err("Please wait before requesting another code",429);
    const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%900000+100000), h=await sha(code+ph);
    await env.DB.prepare("INSERT INTO otps(phone,hash,exp,tries) VALUES(?,?,?,0) ON CONFLICT(phone) DO UPDATE SET hash=excluded.hash,exp=excluded.exp,tries=0").bind(ph,h,Date.now()+300000).run();
    if(env.DEV_OTP==="true")return json({ok:true,devCode:code});
    await sendSms(env,ph,code); return json({ok:true});
  }
  if(p==="verify"&&m==="POST"){
    const ph=normPhone(env,b.phone), o=await env.DB.prepare("SELECT * FROM otps WHERE phone=?").bind(ph).first();
    if(!o||o.exp<Date.now())err("Code expired. Request a new one.");
    if(o.tries>=5){await env.DB.prepare("DELETE FROM otps WHERE phone=?").bind(ph).run();err("Too many attempts. Request a new code.",429);}
    await env.DB.prepare("UPDATE otps SET tries=tries+1 WHERE phone=?").bind(ph).run();
    if(o.hash!==await sha(String(b.code)+ph))err("That code is wrong");
    if(b.adult!==true)err("You must be 18 or older");
    let u=await env.DB.prepare("SELECT * FROM users WHERE phone=?").bind(ph).first(); const nm=String(b.name||"").trim().slice(0,40); if(!u&&!nm)err("Enter your name");
    await env.DB.prepare("DELETE FROM otps WHERE phone=?").bind(ph).run();
    if(!u){u={id:id(),phone:ph,name:nm,done:0,created:Date.now()};await env.DB.prepare("INSERT INTO users(id,phone,name,done,created) VALUES(?,?,?,?,?)").bind(u.id,u.phone,u.name,0,u.created).run();}
    const token=crypto.randomUUID()+crypto.randomUUID(), h=await sha(token);await env.DB.prepare("INSERT INTO sessions(token_hash,uid,exp) VALUES(?,?,?)").bind(h,u.id,Date.now()+2592e6).run();
    return json({token,me:pubU(u)});
  }
  const {u}=await getUser(env,req,url);
  if(p==="profile"&&m==="POST"){const nm=String(b.name||"").trim().slice(0,40);if(!nm)err("Enter a name");await env.DB.prepare("UPDATE users SET name=? WHERE id=?").bind(nm,u.id).run();return json({ok:true,name:nm});}
  if(p==="me")return json(pubU(u));
  if(p==="stream"){
    const stub=env.USER_STREAM.get(env.USER_STREAM.idFromName(u.id));
    return stub.fetch(new Request("https://stream/stream"));
  }
  if(p==="location"&&m==="POST"){
    const la=+b.lat,lo=+b.lng;if(!(Math.abs(la)<=90&&Math.abs(lo)<=180)||b.lat==null)err("Invalid location");
    await env.DB.prepare("UPDATE users SET lat=?,lng=?,at=? WHERE id=?").bind(+la.toFixed(4),+lo.toFixed(4),Date.now(),u.id).run();return json({ok:true});
  }
  if(p==="nearby"){
    const R=Math.min(+url.searchParams.get("r")||3,10), now=Date.now();
    const mine=await env.DB.prepare("SELECT id,type,amount,exp,status FROM listings WHERE uid=? AND status='open' AND exp>? ORDER BY exp").bind(u.id,now).all();
    if(u.lat==null)return json({items:[],mine:mine.results||[]});
    const rows=await env.DB.prepare("SELECT l.*,u.name,u.done,u.lat,u.lng FROM listings l JOIN users u ON u.id=l.uid WHERE l.status='open' AND l.exp>? AND l.uid<>?").bind(now,u.id).all();
    const items=[]; for(const l of rows.results||[]){if(l.lat==null||await blocked(env,u.id,l.uid))continue;const d=dist(u,l);if(d<=R)items.push({id:l.id,type:l.type,amount:l.amount,mins:Math.ceil((l.exp-now)/60000),km:Math.max(.01,Math.round(d*100)/100),brg:Math.round(bearing(u,l)),name:l.name,done:l.done||0});}
    items.sort((a,b)=>a.km-b.km);return json({items,mine:mine.results||[]});
  }
  if(p==="listings"&&m==="POST"){
    if(u.lat==null)err("Turn on location first");const amt=Math.floor(+b.amount),mins=Math.floor(+b.minutes);if(!["have","need"].includes(b.type)||!(amt>=1&&amt<=5000)||!(mins>=5&&mins<=240))err("Invalid post");
    const count=await env.DB.prepare("SELECT COUNT(*) c FROM listings WHERE uid=? AND status='open' AND exp>?").bind(u.id,Date.now()).first();if((count?.c||0)>=3)err("You can have up to 3 live posts");
    const l={id:id(),uid:u.id,type:b.type,amount:amt,exp:Date.now()+mins*60000,status:"open"};await env.DB.prepare("INSERT INTO listings(id,uid,type,amount,exp,status) VALUES(?,?,?,?,?,?)").bind(l.id,l.uid,l.type,l.amount,l.exp,l.status).run();await broadcastListings(env);return json(l);
  }
  if(p==="listings/cancel"&&m==="POST"){
    const l=await env.DB.prepare("SELECT * FROM listings WHERE id=? AND uid=? AND status='open'").bind(b.id,u.id).first();if(!l)err("Not found",404);await env.DB.prepare("UPDATE listings SET status='cancelled' WHERE id=?").bind(b.id).run();await broadcastListings(env);return json({ok:true});
  }
  if(p==="threads"&&m==="POST"){
    const l=await env.DB.prepare("SELECT * FROM listings WHERE id=? AND status='open' AND exp>?").bind(b.listingId,Date.now()).first();if(!l||l.uid===u.id||await blocked(env,u.id,l.uid))err("This post is no longer available",409);
    const t={id:id(),lid:l.id,amount:l.amount,type:l.type,a:l.uid,b:u.id,status:"open",confirmed:"[]",created:Date.now()};
    await env.DB.batch([env.DB.prepare("UPDATE listings SET status='matched' WHERE id=?").bind(l.id),env.DB.prepare("INSERT INTO threads(id,lid,amount,type,a,b,status,confirmed,created) VALUES(?,?,?,?,?,?,?,?,?)").bind(t.id,t.lid,t.amount,t.type,t.a,t.b,t.status,t.confirmed,t.created)]);
    await broadcastListings(env);await push(env,l.uid,{t:"thread"});return json({id:t.id});
  }
  if(p==="threads"){
    const rows=await env.DB.prepare("SELECT t.*, ua.id a_id,ua.name a_name,ua.done a_done, ub.id b_id,ub.name b_name,ub.done b_done, (SELECT text FROM messages m WHERE m.tid=t.id ORDER BY m.at DESC LIMIT 1) last FROM threads t JOIN users ua ON ua.id=t.a JOIN users ub ON ub.id=t.b WHERE t.a=? OR t.b=? ORDER BY t.created DESC").bind(u.id,u.id).all();
    return json({items:(rows.results||[]).map(t=>({id:t.id,amount:t.amount,status:t.status,other:{id:t.a===u.id?t.b_id:t.a_id,name:t.a===u.id?t.b_name:t.a_name,done:t.a===u.id?t.b_done:t.a_done},last:t.last?t.last.slice(0,60):""}))});
  }
  const P=p.split('/');
  if(P[0]==="threads"&&P[1]){
    const t=await env.DB.prepare("SELECT * FROM threads WHERE id=? AND (a=? OR b=?)").bind(P[1],u.id,u.id).first();if(!t)err("Not found",404);const oid=t.a===u.id?t.b:t.a;const o=await env.DB.prepare("SELECT id,name,done FROM users WHERE id=?").bind(oid).first();
    if(!P[2]){const msgs=await env.DB.prepare("SELECT id,tid,from_uid AS \"from\",text,at FROM messages WHERE tid=? ORDER BY at DESC LIMIT 200").bind(t.id).all();const confirmed=JSON.parse(t.confirmed||"[]");return json({id:t.id,amount:t.amount,status:t.status,confirmed,other:pubU(o),msgs:(msgs.results||[]).reverse()});}
    if(P[2]==="messages"&&m==="POST"){
      const text=String(b.text||"").trim().slice(0,500);if(!text)err("Type a message");if(t.status!=="open"||await blocked(env,u.id,oid))err("This chat is closed",409);
      const idm=id(),at=Date.now();await env.DB.prepare("INSERT INTO messages(id,tid,from_uid,text,at) VALUES(?,?,?,?,?)").bind(idm,t.id,u.id,text,at).run();const msg={id:idm,tid:t.id,from:u.id,text,at};await push(env,oid,{t:"msg",threadId:t.id,msg,from:u.name});return json(msg);
    }
    if(P[2]==="complete"&&m==="POST"){
      if(t.status!=="open")err("This exchange is closed",409);let confirmed=JSON.parse(t.confirmed||"[]");if(!confirmed.includes(u.id))confirmed.push(u.id);let status=t.status;if(confirmed.length===2)status="completed";
      const stmts=[env.DB.prepare("UPDATE threads SET confirmed=?,status=? WHERE id=?").bind(JSON.stringify(confirmed),status,t.id)];if(status==="completed"){stmts.push(env.DB.prepare("UPDATE users SET done=done+1 WHERE id IN (?,?)").bind(u.id,oid));}await env.DB.batch(stmts);await push(env,oid,{t:"thread"});return json({ok:true});
    }
  }
  if(p==="report"&&m==="POST"){
    const t=await env.DB.prepare("SELECT * FROM threads WHERE id=? AND (a=? OR b=?)").bind(b.threadId,u.id,u.id).first();if(!t)err("Not found",404);const oid=t.a===u.id?t.b:t.a;if(!["scam","harassment","unsafe","other"].includes(b.reason))err("Choose a reason");
    const last=await env.DB.prepare("SELECT id,tid,from_uid AS \"from\",text,at FROM messages WHERE tid=? ORDER BY at DESC LIMIT 20").bind(t.id).all();await env.DB.batch([env.DB.prepare("INSERT INTO reports(id,by_uid,who_uid,tid,reason,at,last_json) VALUES(?,?,?,?,?,?,?)").bind(id(),u.id,oid,t.id,b.reason,Date.now(),JSON.stringify((last.results||[]).reverse())),env.DB.prepare("INSERT OR IGNORE INTO blocks(by_uid,who_uid) VALUES(?,?)").bind(u.id,oid),env.DB.prepare("UPDATE threads SET status='closed' WHERE id=? AND status='open'").bind(t.id)]);await push(env,oid,{t:"thread"});return json({ok:true});
  }
  if(p==="block"&&m==="POST"){if(!await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(b.userId).first())err("Not found",404);await env.DB.prepare("INSERT OR IGNORE INTO blocks(by_uid,who_uid) VALUES(?,?)").bind(u.id,b.userId).run();return json({ok:true});}
  err("Not found",404);
}
async function broadcastListings(env){
  // Push a lightweight refresh signal to currently known user IDs. This is intentionally bounded for the free tier.
  const r=await env.DB.prepare("SELECT id FROM users WHERE at>? LIMIT 200").bind(Date.now()-86400000).all();await Promise.all((r.results||[]).map(x=>push(env,x.id,{t:"listings"})));
}
export class UserStream extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.env=env;this.clients=new Set();}
  async fetch(req){
    const u=new URL(req.url);
    if(u.pathname==="/push"){const e=await req.json();for(const c of [...this.clients]){try{c.controller.enqueue(new TextEncoder().encode("data: "+JSON.stringify(e)+"\n\n"));}catch{this.clients.delete(c);}}return new Response("ok");}
    if(u.pathname==="/stream"){
      const enc=new TextEncoder(), self=this;
      let hb;
      const stream=new ReadableStream({start(controller){const item={controller};self.clients.add(item);controller.enqueue(enc.encode("retry: 3000\n\n"));hb=setInterval(()=>{try{controller.enqueue(enc.encode(": hb\n\n"));}catch{clearInterval(hb);self.clients.delete(item);}},25000);},cancel(){clearInterval(hb);for(const c of self.clients){if(c.controller===undefined)continue;}}});
      return new Response(stream,{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive","X-Accel-Buffering":"no"}});
    }
    return new Response("Not found",{status:404});
  }
}
export default {async fetch(req,env){const url=new URL(req.url);if(url.pathname==="/healthz"){let db=false,schema=false,error=null;try{await ensureSchema(env);db=true;schema=!!await env.DB.prepare("SELECT name FROM sqlite_master WHERE name='otps'").first();}catch(e){error=String(e&&e.message||e).slice(0,160);}return json({ok:db&&schema,v:7,db,schema,devOtp:env.DEV_OTP==="true",error});}if(url.pathname.startsWith("/api/")){try{await ensureSchema(env);return await api(env,req,url.pathname.slice(5),url);}catch(e){if(!e.status)console.error("Worker error:",e&&e.stack||e);return json({error:e.status?e.message:(env.DEV_OTP==="true"?"Server error: "+(e&&e.message):"Server error")},e.status||500);}}return env.ASSETS.fetch(req);}};
