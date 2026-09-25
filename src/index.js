import { DurableObject } from "cloudflare:workers";

const SCHEMA=["CREATE TABLE IF NOT EXISTS users (\n  id TEXT PRIMARY KEY,\n  phone TEXT NOT NULL UNIQUE,\n  name TEXT NOT NULL,\n  done INTEGER NOT NULL DEFAULT 0,\n  lat REAL,\n  lng REAL,\n  at INTEGER,\n  created INTEGER NOT NULL\n)", "CREATE TABLE IF NOT EXISTS sessions (\n  token_hash TEXT PRIMARY KEY,\n  uid TEXT NOT NULL,\n  exp INTEGER NOT NULL,\n  FOREIGN KEY(uid) REFERENCES users(id) ON DELETE CASCADE\n)", "CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(exp)", "CREATE TABLE IF NOT EXISTS otps (\n  phone TEXT PRIMARY KEY,\n  hash TEXT NOT NULL,\n  exp INTEGER NOT NULL,\n  tries INTEGER NOT NULL DEFAULT 0\n)", "CREATE TABLE IF NOT EXISTS listings (\n  id TEXT PRIMARY KEY,\n  uid TEXT NOT NULL,\n  type TEXT NOT NULL CHECK(type IN ('have','need')),\n  amount INTEGER NOT NULL,\n  exp INTEGER NOT NULL,\n  status TEXT NOT NULL DEFAULT 'open',\n  FOREIGN KEY(uid) REFERENCES users(id) ON DELETE CASCADE\n)", "CREATE INDEX IF NOT EXISTS idx_listings_open ON listings(status, exp)", "CREATE INDEX IF NOT EXISTS idx_listings_uid ON listings(uid)", "CREATE TABLE IF NOT EXISTS threads (\n  id TEXT PRIMARY KEY,\n  lid TEXT NOT NULL,\n  amount INTEGER NOT NULL,\n  type TEXT NOT NULL,\n  a TEXT NOT NULL,\n  b TEXT NOT NULL,\n  status TEXT NOT NULL DEFAULT 'open',\n  confirmed TEXT NOT NULL DEFAULT '[]',\n  pin_hash TEXT,\n  pin_verified INTEGER NOT NULL DEFAULT 0,\n  pin_verified_by TEXT,\n  pin_verified_at INTEGER,\n  pin_attempts INTEGER NOT NULL DEFAULT 0,\n  created INTEGER NOT NULL,\n  FOREIGN KEY(a) REFERENCES users(id) ON DELETE CASCADE,\n  FOREIGN KEY(b) REFERENCES users(id) ON DELETE CASCADE\n)", "CREATE INDEX IF NOT EXISTS idx_threads_user_a ON threads(a, created)", "CREATE INDEX IF NOT EXISTS idx_threads_user_b ON threads(b, created)", "CREATE TABLE IF NOT EXISTS messages (\n  id TEXT PRIMARY KEY,\n  tid TEXT NOT NULL,\n  from_uid TEXT NOT NULL,\n  text TEXT NOT NULL,\n  at INTEGER NOT NULL,\n  FOREIGN KEY(tid) REFERENCES threads(id) ON DELETE CASCADE,\n  FOREIGN KEY(from_uid) REFERENCES users(id) ON DELETE CASCADE\n)", "CREATE INDEX IF NOT EXISTS idx_messages_tid ON messages(tid, at)", "CREATE TABLE IF NOT EXISTS reports (\n  id TEXT PRIMARY KEY,\n  by_uid TEXT NOT NULL,\n  who_uid TEXT NOT NULL,\n  tid TEXT NOT NULL,\n  reason TEXT NOT NULL,\n  at INTEGER NOT NULL,\n  last_json TEXT NOT NULL\n)", "CREATE TABLE IF NOT EXISTS blocks (\n  by_uid TEXT NOT NULL,\n  who_uid TEXT NOT NULL,\n  PRIMARY KEY(by_uid, who_uid)\n)", "CREATE TABLE IF NOT EXISTS notifications (\n  id TEXT PRIMARY KEY,\n  uid TEXT NOT NULL,\n  kind TEXT NOT NULL,\n  text TEXT NOT NULL,\n  ref TEXT,\n  at INTEGER NOT NULL,\n  read INTEGER NOT NULL DEFAULT 0,\n  FOREIGN KEY(uid) REFERENCES users(id) ON DELETE CASCADE\n)", "CREATE INDEX IF NOT EXISTS idx_notifications_uid ON notifications(uid, at)", "CREATE TABLE IF NOT EXISTS notification_preferences (uid TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, radius_m INTEGER NOT NULL DEFAULT 3000, want_have INTEGER NOT NULL DEFAULT 1, want_need INTEGER NOT NULL DEFAULT 1, cooldown_sec INTEGER NOT NULL DEFAULT 900, updated INTEGER NOT NULL, FOREIGN KEY(uid) REFERENCES users(id) ON DELETE CASCADE)", "CREATE TABLE IF NOT EXISTS notification_dedupe (uid TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(uid, kind, ref))", "CREATE INDEX IF NOT EXISTS idx_notification_dedupe_uid_at ON notification_dedupe(uid, at)", "CREATE INDEX IF NOT EXISTS idx_users_created ON users(created)", "CREATE INDEX IF NOT EXISTS idx_threads_status_created ON threads(status, created)"];
let schemaReadyPromise=null;
async function ensureSchema(env){
  if(schemaReadyPromise) return schemaReadyPromise;
  schemaReadyPromise=(async()=>{
    await env.DB.batch(SCHEMA.map(q=>env.DB.prepare(q)));
    const cols=await env.DB.prepare("PRAGMA table_info(users)").all();
    if(!(cols.results||[]).some(x=>x.name==='cell')) await env.DB.prepare("ALTER TABLE users ADD COLUMN cell TEXT").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_users_cell_active ON users(cell,at)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_users_location_active ON users(at)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_users_created ON users(created)").run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_threads_status_created ON threads(status, created)").run();
    const tcols=await env.DB.prepare("PRAGMA table_info(threads)").all();
    const names=new Set((tcols.results||[]).map(x=>x.name));
    const adds=[['pin_hash','TEXT'],['pin_verified','INTEGER NOT NULL DEFAULT 0'],['pin_verified_by','TEXT'],['pin_verified_at','INTEGER'],['pin_attempts','INTEGER NOT NULL DEFAULT 0']];
    for(const [name,type] of adds) if(!names.has(name)) await env.DB.prepare(`ALTER TABLE threads ADD COLUMN ${name} ${type}`).run();
    await env.DB.prepare("UPDATE threads SET status='matched' WHERE status='open'").run();
    // Backward-compatible preference initialization; existing users keep the safe defaults.
    await env.DB.prepare("INSERT OR IGNORE INTO notification_preferences(uid,updated) SELECT id,? FROM users").bind(Date.now()).run();
  })().catch(e=>{schemaReadyPromise=null;throw e});
  return schemaReadyPromise;
}
const CELL=0.05;
const cellKey=(lat,lng)=>`${Math.floor((lat+90)/CELL)}:${Math.floor((lng+180)/CELL)}`;
const nearbyCells=(lat,lng,rKm)=>{
  const dLat=rKm/111.32+CELL;
  const dLng=rKm/(111.32*Math.max(.15,Math.cos(rad(lat))))+CELL;
  const a=Math.floor((lat-dLat+90)/CELL), b=Math.floor((lat+dLat+90)/CELL);
  const c=Math.floor((lng-dLng+180)/CELL), d=Math.floor((lng+dLng+180)/CELL);
  const out=[]; for(let y=a;y<=b;y++) for(let x=c;x<=d;x++) out.push(`${y}:${x}`);
  return out.slice(0,64);
};
const guestHits=new Map();
const guestOk=ip=>{const t=Date.now(),h=guestHits.get(ip);if(!h||h.r<t){guestHits.set(ip,{c:1,r:t+3600000});return true;}return ++h.c<=20;};
const apiHits=new Map();
const rateOk=(key,limit,windowMs)=>{const t=Date.now(),h=apiHits.get(key);if(!h||h.r<t){apiHits.set(key,{c:1,r:t+windowMs});return true;}return ++h.c<=limit;};
const json = (o, status=200, extra={}) => new Response(JSON.stringify(o), {status, headers:{"Content-Type":"application/json; charset=utf-8", ...extra}});
const err = (m,c=400) => { const e=new Error(m); e.status=c; throw e; };
const id = () => crypto.randomUUID().replaceAll("-", "").slice(0,16);
async function sha(s){ const b=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))); return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join(""); }
const makePin=()=>String(crypto.getRandomValues(new Uint32Array(1))[0]%900000+100000);
const providerId=t=>t.type==='have'?t.a:t.b;
async function pinHash(tid,pin){return sha(`near-cash-exchange-pin:v1:${tid}:${pin}`)}
const escPhone = s => String(s||"").replace(/[\s-]/g,"");
const rad = x => x*Math.PI/180;
const dist=(a,b)=>{const h=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;return 12742*Math.asin(Math.sqrt(h));};
const bearing=(a,b)=>{const y=Math.sin(rad(b.lng-a.lng))*Math.cos(rad(b.lat)),x=Math.cos(rad(a.lat))*Math.sin(rad(b.lat))-Math.sin(rad(a.lat))*Math.cos(rad(b.lat))*Math.cos(rad(b.lng-a.lng));return(Math.atan2(y,x)*180/Math.PI+360)%360;};
const pubU=u=>({id:u.id,name:u.name,done:u.done||0});
const trustFor=(u,now=Date.now())=>{
  const ageDays=Math.max(0,(now-(u.created||now))/86400000), done=Number(u.done||0);
  const verified=!String(u.phone||'').startsWith('guest:');
  const score=(verified?6:0)+(Math.min(done,5)*1.2)+(Math.min(ageDays,30)/30*3)+(u.at&&now-u.at<=86400000?2:0);
  const label=verified&&done>=2&&ageDays>=14?'Established':verified?'Verified':'New';
  return {label,verified,score:Math.round(score*10)/10,ageDays:Math.floor(ageDays),completed:done};
};
const amountCompat=(a,b)=>{const x=Math.max(1,Number(a)||0),y=Math.max(1,Number(b)||0);return Math.max(0,1-Math.abs(x-y)/Math.max(x,y));};
const matchScore=(viewer,candidate,km,radiusKm,ownPosts,now=Date.now())=>{
  const opposite=(ownPosts||[]).filter(x=>x.type!==candidate.type&&x.status==='open'&&x.exp>now);
  const amount=opposite.length?Math.max(...opposite.map(x=>amountCompat(x.amount,candidate.amount))):0.5;
  const distance=Math.max(0,1-Math.min(km,radiusKm)/Math.max(radiusKm,0.001));
  const freshness=Math.max(0,Math.min(1,1-Math.max(0,now-(candidate.created||now))/14400000));
  const trust=Math.max(0,Math.min(1,trustFor(candidate,now).score/17));
  return Math.round((distance*35+amount*30+freshness*20+trust*15));
};
const trustBadge=u=>trustFor(u).label;
const readBody=async req=>{let t=await req.text(); if(t.length>10000)err("Request too large",413); try{return t?JSON.parse(t):{}}catch{err("Invalid JSON",400)}};
const parseRow = r => r ? {...r} : null;
const normPhone=(env,p)=>{p=String(p||"").replace(/[\s-]/g,"");return p[0]==="+"?p:/^\d{10}$/.test(p)?"+"+(env.DEFAULT_COUNTRY_CODE||"91")+p:"+"+p;};
async function sendSms(env,to,code){
  if(env.TWILIO_ACCOUNT_SID&&env.TWILIO_AUTH_TOKEN&&env.TWILIO_FROM){const r=await fetch("https://api.twilio.com/2010-04-01/Accounts/"+env.TWILIO_ACCOUNT_SID+"/Messages.json",{method:"POST",headers:{Authorization:"Basic "+btoa(env.TWILIO_ACCOUNT_SID+":"+env.TWILIO_AUTH_TOKEN),"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({To:to,From:env.TWILIO_FROM,Body:"Your Near Cash code is "+code})});if(!r.ok){console.error("Twilio error",r.status,await r.text());err("Could not send the code",502);}return;}
const u=env.SMS_WEBHOOK_URL;if(!u)err("SMS provider not configured",501);const r=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+(env.SMS_WEBHOOK_TOKEN||"")},body:JSON.stringify({to,message:"Your Near Cash code is "+code})});if(!r.ok)err("Could not send the code",502);}
async function getUser(env,req,url){const tok=(req.headers.get("Authorization")||"").slice(7)||url.searchParams.get("token")||"";if(!tok)err("Please sign in",401);const h=await sha(tok);const r=await env.DB.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.uid WHERE s.token_hash=? AND s.exp>? LIMIT 1").bind(h,Date.now()).first();if(!r)err("Please sign in",401);return {u:r,tok,h};}
async function blocked(env,a,b){return !!await env.DB.prepare("SELECT 1 FROM blocks WHERE (by_uid=? AND who_uid=?) OR (by_uid=? AND who_uid=?) LIMIT 1").bind(a,b,b,a).first();}
async function notify(env,uid,kind,text,ref){try{await env.DB.prepare("INSERT INTO notifications(id,uid,kind,text,ref,at,read) VALUES(?,?,?,?,?,?,0)").bind(id(),uid,kind,String(text).slice(0,160),ref||null,Date.now()).run();await push(env,uid,{t:"notif"});}catch(e){console.error("notify",e&&e.message);}}
async function push(env,uid,event){const stub=env.USER_STREAM.get(env.USER_STREAM.idFromName(uid));await stub.fetch("https://stream/push",{method:"POST",body:JSON.stringify(event)}).catch(()=>{});}
async function smartNearbyNotify(env,listing){
  const now=Date.now(), maxAge=120000;
  const rows=await env.DB.prepare("SELECT u.id,u.name,u.phone,u.done,u.created,u.lat,u.lng,u.at,p.enabled,p.radius_m,p.want_have,p.want_need,p.cooldown_sec FROM users u LEFT JOIN notification_preferences p ON p.uid=u.id WHERE u.id<>? AND u.lat IS NOT NULL AND u.lng IS NOT NULL AND u.at>?").bind(listing.uid,now-maxAge).all();
  const jobs=[]; const notifiedUids=[];
  for(const v of rows.results||[]){
    const pref={enabled:v.enabled==null?1:v.enabled,radius_m:v.radius_m||3000,want_have:v.want_have==null?1:v.want_have,want_need:v.want_need==null?1:v.want_need,cooldown_sec:v.cooldown_sec||900};
    if(!pref.enabled || (listing.type==='have'&&!pref.want_have) || (listing.type==='need'&&!pref.want_need)) continue;
    const km=dist(v,{lat:listing.lat,lng:listing.lng});
    if(km*1000>pref.radius_m) continue;
    const recent=await env.DB.prepare("SELECT 1 FROM notification_dedupe WHERE uid=? AND kind='nearby_match' AND at>? LIMIT 1").bind(v.id,now-pref.cooldown_sec*1000).first();
    if(recent) continue;
    const label=listing.type==='have'?'cash available':'cash needed';
    jobs.push(env.DB.prepare("INSERT OR IGNORE INTO notification_dedupe(uid,kind,ref,at) VALUES(?,?,?,?)").bind(v.id,'nearby_match',listing.id,now));
    jobs.push(env.DB.prepare("INSERT INTO notifications(id,uid,kind,text,ref,at,read) VALUES(?,?,?,?,?,?,0)").bind(id(),v.id,'nearby_match',`Nearby match: ₹${listing.amount} ${label} · ${km<1?Math.round(km*1000)+' m':km.toFixed(1)+' km'}`,listing.id,now)); notifiedUids.push(v.id);
  }
  if(jobs.length){await env.DB.batch(jobs);const uids=[...new Set(notifiedUids)];await Promise.all(uids.map(uid=>push(env,uid,{t:'notif'})));}
}
async function expireListings(env,uids=[]){
  const now=Date.now();
  const where=uids.length?`uid IN (${uids.map(()=>'?').join(',')}) AND `:'';
  const q=`SELECT id,uid,amount FROM listings WHERE ${where} status='open' AND exp<=?`;
  const rows=await env.DB.prepare(q).bind(...uids,now).all();
  if(rows.results?.length){
    await env.DB.prepare(`UPDATE listings SET status='expired' WHERE ${where} status='open' AND exp<=?`).bind(...uids,now).run();
    for(const l of rows.results) await notify(env,l.uid,'expiry',`Your ₹${l.amount} post has expired.`,l.id);
  }
}
async function api(env,req,p,url){
  const m=req.method, b=m==="POST"?await readBody(req):{};
  if(p==="guest"&&m==="POST"){
    if(env.REQUIRE_SIGNIN==="true")err("Sign in required",403);
    if(!guestOk(req.headers.get("CF-Connecting-IP")||"?"))err("Too many new accounts from this network. Try again later.",429);
    const uid=id(),name="Guest "+String(crypto.getRandomValues(new Uint32Array(1))[0]%9000+1000);
    await env.DB.prepare("INSERT INTO users(id,phone,name,done,created) VALUES(?,?,?,?,?)").bind(uid,"guest:"+uid,name,0,Date.now()).run();
    const token=crypto.randomUUID()+crypto.randomUUID(),h=await sha(token);
    await env.DB.prepare("INSERT INTO sessions(token_hash,uid,exp) VALUES(?,?,?)").bind(h,uid,Date.now()+2592e6).run();
    await notify(env,uid,"account","Account created. Welcome, "+name+"!");return json({token,me:{id:uid,name,done:0}});
  }
  if(p==="otp"&&m==="POST"){
    const ip=req.headers.get("CF-Connecting-IP")||"?"; if(!rateOk(`otp:${ip}`,5,3600000)) err("Too many code requests. Try again later.",429);
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
  if(p==="profile"&&m==="POST"){const nm=String(b.name||"").trim().slice(0,40);if(!nm)err("Enter a name");await env.DB.prepare("UPDATE users SET name=? WHERE id=?").bind(nm,u.id).run();await notify(env,u.id,"profile","Your display name is now "+nm+".");return json({ok:true,name:nm});}
  if(p==="notifications"&&m==="GET"){const r=await env.DB.prepare("SELECT id,kind,text,ref,at,read FROM notifications WHERE uid=? ORDER BY at DESC LIMIT 100").bind(u.id).all();const c=await env.DB.prepare("SELECT COUNT(*) c FROM notifications WHERE uid=? AND read=0").bind(u.id).first();return json({items:r.results||[],unread:(c&&c.c)||0});}
  if(p==="notifications/read"&&m==="POST"){await env.DB.prepare("UPDATE notifications SET read=1 WHERE uid=? AND read=0").bind(u.id).run();return json({ok:true});}
  if(p==="notifications/preferences"&&m==="GET"){
    let p0=await env.DB.prepare("SELECT enabled,radius_m,want_have,want_need,cooldown_sec FROM notification_preferences WHERE uid=?").bind(u.id).first();
    if(!p0){p0={enabled:1,radius_m:3000,want_have:1,want_need:1,cooldown_sec:900};await env.DB.prepare("INSERT OR IGNORE INTO notification_preferences(uid,enabled,radius_m,want_have,want_need,cooldown_sec,updated) VALUES(?,?,?,?,?,?,?)").bind(u.id,1,3000,1,1,900,Date.now()).run();}
    return json({enabled:!!p0.enabled,radius_m:Number(p0.radius_m),want_have:!!p0.want_have,want_need:!!p0.want_need,cooldown_sec:Number(p0.cooldown_sec)});
  }
  if(p==="notifications/preferences"&&m==="POST"){
    if(!rateOk(`prefs:${u.id}`,10,60000))err("Preferences updates are temporarily limited",429);
    const radius=Math.min(Math.max(Number(b.radius_m)||3000,500),3000), cooldown=Math.min(Math.max(Number(b.cooldown_sec)||900,300),3600);
    await env.DB.prepare("INSERT INTO notification_preferences(uid,enabled,radius_m,want_have,want_need,cooldown_sec,updated) VALUES(?,?,?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET enabled=excluded.enabled,radius_m=excluded.radius_m,want_have=excluded.want_have,want_need=excluded.want_need,cooldown_sec=excluded.cooldown_sec,updated=excluded.updated").bind(u.id,b.enabled===false?0:1,radius,b.want_have===false?0:1,b.want_need===false?0:1,cooldown,Date.now()).run();
    return json({ok:true});
  }
  if(p==="me")return json(pubU(u));
  if(p==="stream"){
    const stub=env.USER_STREAM.get(env.USER_STREAM.idFromName(u.id));
    return stub.fetch(new Request("https://stream/stream"));
  }
  if(p==="location"&&m==="POST"){
    if(!rateOk(`loc:${u.id}`,30,60000)) err("Location updates are temporarily limited",429);
    const la=Number(b.lat),lo=Number(b.lng),acc=Number(b.accuracy);
    if(!Number.isFinite(la)||!Number.isFinite(lo)||Math.abs(la)>90||Math.abs(lo)>180) err("Invalid location");
    if(Number.isFinite(acc) && (acc<0 || acc>5000)) err("Invalid GPS accuracy");
    const now=Date.now(),precision=4;
    await env.DB.prepare("UPDATE users SET lat=?,lng=?,at=?,cell=? WHERE id=?").bind(+la.toFixed(precision),+lo.toFixed(precision),now,cellKey(la,lo),u.id).run();
    if(u.lat==null) await notify(env,u.id,"location","Location is on. You can now see cash nearby.");
    return json({ok:true,at:now,cell:cellKey(la,lo)});
  }
  if(p==="nearby"){
    if(!rateOk(`near:${u.id}`,60,60000)) err("Nearby refreshes are temporarily limited",429);
    const rawR=Number(url.searchParams.get('r')); const R=Math.min(Math.max(Number.isFinite(rawR)?rawR:1,0.5),10);
    const now=Date.now(), stale=now-120000; await expireListings(env,[u.id]);
    const mine=await env.DB.prepare("SELECT id,type,amount,exp,status,created FROM listings WHERE uid=? AND status='open' AND exp>? ORDER BY exp").bind(u.id,now).all();
    if(u.lat==null){
      const recent=await env.DB.prepare("SELECT l.id,l.type,l.amount,l.exp,l.created,u.name,u.phone,u.done,u.created AS user_created,u.at FROM listings l JOIN users u ON u.id=l.uid WHERE l.status='open' AND l.exp>? AND l.uid<>? AND u.at>? ORDER BY l.created DESC LIMIT 20").bind(now,u.id,now-3600000).all();
      const items=(recent.results||[]).map(l=>{const tr=trustFor({phone:l.phone,done:l.done,created:l.user_created,at:l.at},now);return {id:l.id,type:l.type,amount:l.amount,mins:Math.max(1,Math.ceil((l.exp-now)/60000)),name:l.name,done:l.done||0,matchLabel:'Nearby match',trust:tr.label,verified:tr.verified,locationAgeSec:Math.max(0,Math.round((now-l.at)/1000))}});
      return json({items,mine:mine.results||[],meta:{radius:R,location:false,privacy:'approximate-only',fallback:'recent-active-list'}});
    }
    const cells=nearbyCells(+u.lat,+u.lng,R), marks=cells.map(()=>'?').join(',');
    const rows=await env.DB.prepare(`SELECT l.*,u.name,u.phone,u.done,u.created AS user_created,u.lat,u.lng,u.at,u.cell FROM listings l JOIN users u ON u.id=l.uid WHERE l.status='open' AND l.exp>? AND l.uid<>? AND u.lat IS NOT NULL AND u.lng IS NOT NULL AND u.at>? AND u.cell IN (${marks})`).bind(now,u.id,stale,...cells).all();
    const own=mine.results||[], items=[];
    for(const l of rows.results||[]){
      if(await blocked(env,u.id,l.uid))continue;
      const km=dist(u,l); if(km>R)continue;
      const tr=trustFor({phone:l.phone,done:l.done,created:l.user_created,at:l.at},now);
      const score=matchScore(u,{type:l.type,amount:l.amount,exp:l.exp,created:l.created},km,R,own,now);
      items.push({id:l.id,type:l.type,amount:l.amount,mins:Math.max(1,Math.ceil((l.exp-now)/60000)),km:Math.max(.01,Math.round(km*100)/100),brg:Math.round(bearing(u,l)),name:l.name,done:l.done||0,match:score,locationAgeSec:Math.max(0,Math.round((now-l.at)/1000)),matchLabel:score>=80?'Strong match':score>=60?'Good match':'Nearby match',trust:tr.label,verified:tr.verified,activeAgeSec:Math.max(0,Math.round((now-l.created)/1000))});
    }
    items.sort((a,b)=>b.match-a.match||a.km-b.km||b.done-a.done);
    return json({items,mine,meta:{radius:R,location:true,staleAfterSec:120,candidateCells:cells.length,privacy:'exact coordinates are never returned'}});
  }
  if(p==="listings"&&m==="POST"){
    if(u.lat==null)err("Turn on location first");const amt=Math.floor(+b.amount),mins=Math.floor(+b.minutes);if(!["have","need"].includes(b.type)||!(amt>=1&&amt<=5000)||!(mins>=5&&mins<=240))err("Invalid post");
    const count=await env.DB.prepare("SELECT COUNT(*) c FROM listings WHERE uid=? AND status='open' AND exp>?").bind(u.id,Date.now()).first();if((count?.c||0)>=3)err("You can have up to 3 live posts");
    const l={id:id(),uid:u.id,type:b.type,amount:amt,exp:Date.now()+mins*60000,status:"open",created:Date.now(),lat:u.lat,lng:u.lng};
    await env.DB.prepare("INSERT INTO listings(id,uid,type,amount,exp,status) VALUES(?,?,?,?,?,?)").bind(l.id,l.uid,l.type,l.amount,l.exp,l.status).run();
    await notify(env,u.id,"post",(l.type==="have"?"Your cash offer of ₹":"Your cash request of ₹")+l.amount+" is live for "+mins+" min.",l.id);
    await smartNearbyNotify(env,l); await broadcastListings(env); return json({id:l.id,type:l.type,amount:l.amount,exp:l.exp,status:l.status});
  }
  if(p==="listings/cancel"&&m==="POST"){
    const l=await env.DB.prepare("SELECT * FROM listings WHERE id=? AND uid=? AND status='open'").bind(b.id,u.id).first();if(!l)err("Not found",404);await env.DB.prepare("UPDATE listings SET status='cancelled' WHERE id=?").bind(b.id).run();await notify(env,u.id,"post","You cancelled your ₹"+l.amount+" post.");await broadcastListings(env);return json({ok:true});
  }
  if(p==="threads"&&m==="POST"){
    if(!rateOk(`match:${u.id}`,20,60000))err("Too many match attempts. Try again later.",429);
    const l=await env.DB.prepare("SELECT * FROM listings WHERE id=? AND status='open' AND exp>?").bind(b.listingId,Date.now()).first();if(!l||l.uid===u.id||await blocked(env,u.id,l.uid))err("This post is no longer available",409);
    const t={id:id(),lid:l.id,amount:l.amount,type:l.type,a:l.uid,b:u.id,status:"matched",confirmed:"[]",created:Date.now()};
    await env.DB.batch([env.DB.prepare("UPDATE listings SET status='matched' WHERE id=?").bind(l.id),env.DB.prepare("INSERT INTO threads(id,lid,amount,type,a,b,status,confirmed,created) VALUES(?,?,?,?,?,?,?,?,?)").bind(t.id,t.lid,t.amount,t.type,t.a,t.b,t.status,t.confirmed,t.created)]);
    const own=await env.DB.prepare("SELECT name FROM users WHERE id=?").bind(l.uid).first();await notify(env,l.uid,"connect",u.name+(l.type==="have"?" requested your ₹":" offered cash for your ₹")+l.amount+(l.type==="have"?" cash. Open the chat to coordinate.":" request. Open the chat to coordinate."),t.id);await notify(env,u.id,"connect","You connected with "+(own&&own.name||"a user")+" for ₹"+l.amount+".",t.id);await broadcastListings(env);await push(env,l.uid,{t:"thread"});return json({id:t.id});
  }
  if(p==="threads"){
    const rows=await env.DB.prepare("SELECT t.*, ua.id a_id,ua.name a_name,ua.done a_done, ub.id b_id,ub.name b_name,ub.done b_done, (SELECT text FROM messages m WHERE m.tid=t.id ORDER BY m.at DESC LIMIT 1) last FROM threads t JOIN users ua ON ua.id=t.a JOIN users ub ON ub.id=t.b WHERE t.a=? OR t.b=? ORDER BY t.created DESC").bind(u.id,u.id).all();
    return json({items:(rows.results||[]).map(t=>({id:t.id,amount:t.amount,status:t.status,other:{id:t.a===u.id?t.b_id:t.a_id,name:t.a===u.id?t.b_name:t.a_name,done:t.a===u.id?t.b_done:t.a_done},last:t.last?t.last.slice(0,60):""}))});
  }
  const P=p.split('/');
  if(P[0]==="threads"&&P[1]){
    const t=await env.DB.prepare("SELECT * FROM threads WHERE id=? AND (a=? OR b=?)").bind(P[1],u.id,u.id).first();if(!t)err("Not found",404);const oid=t.a===u.id?t.b:t.a;const o=await env.DB.prepare("SELECT id,name,done FROM users WHERE id=?").bind(oid).first();
    if(!P[2]){const msgs=await env.DB.prepare("SELECT id,tid,from_uid AS \"from\",text,at FROM messages WHERE tid=? ORDER BY at DESC LIMIT 200").bind(t.id).all();const confirmed=JSON.parse(t.confirmed||"[]");const owner=providerId(t),isOwner=owner===u.id;return json({id:t.id,amount:t.amount,status:t.status,confirmed,other:pubU(o),msgs:(msgs.results||[]).reverse(),pin:{active:['meetup','both_confirmed'].includes(t.status)&&t.status!=='completed'&&!!t.pin_hash,verified:!!t.pin_verified,verifiedBy:t.pin_verified_by||null,canGenerate:isOwner&&t.status==='meetup'&&!t.pin_verified,canVerify:!isOwner&&t.status==='meetup'&&!t.pin_verified,owner:isOwner,pin:null}});}
    if(P[2]==="location"&&m==="GET"){
      if(!['matched','chatting','meetup','both_confirmed'].includes(t.status)||t.status==='completed')err("Live location is available only for an active accepted exchange",409);
      if(await blocked(env,u.id,oid))err("Live location is unavailable for this exchange",403);
      const other=await env.DB.prepare("SELECT id,name,lat,lng,at FROM users WHERE id=? LIMIT 1").bind(oid).first();
      if(!other||other.lat==null||other.lng==null||!other.at)return json({shared:false,status:t.status});
      const age=Math.max(0,Date.now()-Number(other.at));
      if(age>120000)return json({shared:false,status:t.status,staleAfterSec:120});
      const lat=Number(Number(other.lat).toFixed(3)),lng=Number(Number(other.lng).toFixed(3));
      return json({shared:true,status:t.status,participant:{id:other.id,name:other.name,lat,lng,updatedAt:Number(other.at),ageSec:Math.round(age/1000)},privacy:"approximate-live-location"});
    }
    if(P[2]==="messages"&&m==="POST"){
      const text=String(b.text||"").trim().slice(0,500);if(!text)err("Type a message");if(!["matched","chatting","meetup","both_confirmed"].includes(t.status)||await blocked(env,u.id,oid))err("This chat is closed",409);
      const idm=id(),at=Date.now();await env.DB.prepare("INSERT INTO messages(id,tid,from_uid,text,at) VALUES(?,?,?,?,?)").bind(idm,t.id,u.id,text,at).run();const msg={id:idm,tid:t.id,from:u.id,text,at};await push(env,oid,{t:"msg",threadId:t.id,msg,from:u.name});await notify(env,oid,"message","New message from "+u.name+": "+text.slice(0,60),t.id);return json(msg);
    }
  }
  if(P[0]==="threads"&&P[1]&&P[2]==="pin"&&m==="POST"){
    if(!rateOk(`pin:${u.id}`,10,60000))err("Too many PIN attempts. Try again later.",429);
    const t=await env.DB.prepare("SELECT * FROM threads WHERE id=? AND (a=? OR b=?)").bind(P[1],u.id,u.id).first();if(!t)err("Not found",404);
    if(!['meetup','both_confirmed'].includes(t.status)||t.status==='completed')err("Exchange PIN is not active",409);
    const owner=providerId(t);
    if(b.action==='generate'){
      if(owner!==u.id)err("Only the cash provider can generate the exchange PIN",403);
      if(t.pin_verified)err("The exchange PIN has already been verified",409);
      const pin=makePin(),hash=await pinHash(t.id,pin),now=Date.now();
      await env.DB.prepare("UPDATE threads SET pin_hash=?,pin_verified=0,pin_verified_by=NULL,pin_verified_at=NULL,pin_attempts=0 WHERE id=? AND status IN ('meetup','both_confirmed') AND pin_verified=0").bind(hash,t.id).run();
      await notify(env,owner,'exchange','Your one-time exchange PIN is ready. Share it only with the other participant.',t.id);
      return json({ok:true,pin,verified:false});
    }
    if(b.action==='verify'){
      if(owner===u.id)err("The PIN must be verified by the other participant",403);
      if(t.pin_verified) return json({ok:true,verified:true});
      const code=String(b.pin||'').replace(/\D/g,''); if(!/^\d{6}$/.test(code))err("Enter the 6-digit exchange PIN");
      if(!t.pin_hash)err("The exchange PIN has not been generated yet",409);
      const attempts=Number(t.pin_attempts||0); if(attempts>=5){err("Too many incorrect PIN attempts. Ask the cash provider to generate a new PIN.",429);}
      const hash=await pinHash(t.id,code);
      if(hash!==t.pin_hash){await env.DB.prepare("UPDATE threads SET pin_attempts=pin_attempts+1 WHERE id=?").bind(t.id).run();err("That exchange PIN is incorrect",400);}
      const now=Date.now();await env.DB.prepare("UPDATE threads SET pin_verified=1,pin_verified_by=?,pin_verified_at=?,pin_hash=NULL,pin_attempts=0 WHERE id=? AND pin_verified=0").bind(u.id,now,t.id).run();
      await notify(env,t.a,'exchange','Exchange PIN verified. Both sides can now confirm the exchange.',t.id);await notify(env,t.b,'exchange','Exchange PIN verified. Both sides can now confirm the exchange.',t.id);
      return json({ok:true,verified:true});
    }
    err("Invalid PIN action");
  }
  if(P[0]==="threads"&&P[1]&&P[2]==="state"&&m==="POST"){
    if(!rateOk(`confirm:${u.id}`,20,60000))err("Too many confirmation attempts. Try again later.",429);
    const t=await env.DB.prepare("SELECT * FROM threads WHERE id=? AND (a=? OR b=?)").bind(P[1],u.id,u.id).first(); if(!t)err("Not found",404);
    const requested=String(b.status||''); const allowed={matched:['chatting'],chatting:['meetup'],meetup:['both_confirmed'],both_confirmed:['completed']};
    if(!(allowed[t.status]||[]).includes(requested))err("Invalid transaction state transition",409);
    let confirmed=JSON.parse(t.confirmed||"[]");
    let nextStatus=requested;
    if(requested==='both_confirmed'){
      if(t.status==='meetup'&&!t.pin_verified)err("Verify the one-time exchange PIN before confirming",409);
      if(!confirmed.includes(u.id))confirmed.push(u.id);
      nextStatus=confirmed.length===2?'both_confirmed':'meetup';
    }
    if(requested==='completed'&&confirmed.length!==2)err("Both participants must confirm before completion",409);
    if(requested==='completed'&&!t.pin_verified)err("Exchange PIN verification is required before completion",409);
    const now=Date.now();
    await env.DB.prepare("UPDATE threads SET status=?,confirmed=? WHERE id=?").bind(nextStatus,JSON.stringify(confirmed),t.id).run();
    if(nextStatus==='completed'){
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET done=done+1 WHERE id IN (?,?)").bind(t.a,t.b),
        env.DB.prepare("UPDATE listings SET status='completed' WHERE id=? AND status='matched'").bind(t.lid)
      ]);
      await notify(env,t.a,'exchange','Exchange completed: ₹'+t.amount+'.',t.id);
      await notify(env,t.b,'exchange','Exchange completed: ₹'+t.amount+'.',t.id);
    }
    return json({ok:true,status:nextStatus,confirmed});
  }
  if(p==="report"&&m==="POST"){
    if(!rateOk(`report:${u.id}`,5,3600000))err("Too many reports. Try again later.",429);
    const t=await env.DB.prepare("SELECT * FROM threads WHERE id=? AND (a=? OR b=?)").bind(b.threadId,u.id,u.id).first();if(!t)err("Not found",404);const oid=t.a===u.id?t.b:t.a;if(!["scam","harassment","unsafe","other"].includes(b.reason))err("Choose a reason");
    const last=await env.DB.prepare("SELECT id,tid,from_uid AS \"from\",text,at FROM messages WHERE tid=? ORDER BY at DESC LIMIT 20").bind(t.id).all();await env.DB.batch([env.DB.prepare("INSERT INTO reports(id,by_uid,who_uid,tid,reason,at,last_json) VALUES(?,?,?,?,?,?,?)").bind(id(),u.id,oid,t.id,b.reason,Date.now(),JSON.stringify((last.results||[]).reverse())),env.DB.prepare("INSERT OR IGNORE INTO blocks(by_uid,who_uid) VALUES(?,?)").bind(u.id,oid),env.DB.prepare("UPDATE threads SET status='closed' WHERE id=? AND status<>'completed'").bind(t.id)]);await notify(env,u.id,"safety","Report submitted and the user was blocked. Our team can review it.",t.id);await push(env,oid,{t:"thread"});return json({ok:true});
  }
  if(p==="block"&&m==="POST"){if(!await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(b.userId).first())err("Not found",404);await env.DB.prepare("INSERT OR IGNORE INTO blocks(by_uid,who_uid) VALUES(?,?)").bind(u.id,b.userId).run();await notify(env,u.id,"safety","You blocked a user. You will no longer see each other.");return json({ok:true});}
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
async function mapProxy(req,env,url){
  if(url.pathname.startsWith('/map/tiles/')){
    const parts=url.pathname.split('/'), z=parts[3], x=parts[4], y=(parts[5]||'').replace(/\.png$/,'');
    if(!/^\d+$/.test(z)||!/^\d+$/.test(x)||!/^\d+$/.test(y)) return new Response('Bad tile',{status:400});
    const target=`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, key=new Request(target,{method:'GET'});
    const hit=await caches.default.match(key); if(hit)return new Response(hit.body,hit);
    const r=await fetch(target,{headers:{'User-Agent':'Near-Cash/17 (OpenStreetMap tile proxy)'}});
    if(!r.ok)return new Response('Map tile unavailable',{status:r.status});
    const h=new Headers(r.headers); h.set('Cache-Control','public, max-age=86400'); h.set('X-Map-Source','OpenStreetMap');
    const out=new Response(r.body,{status:r.status,headers:h}); caches.default.put(key,out.clone()).catch(()=>{}); return out;
  }
  if(url.pathname.startsWith('/map/route/')){
    const target='https://router.project-osrm.org'+url.pathname.slice('/map/route'.length)+url.search;
    const r=await fetch(target,{headers:{Accept:'application/json','User-Agent':'Near-Cash/17'}});
    const h=new Headers(r.headers); h.set('Cache-Control','no-store'); h.set('X-Route-Source','OSRM');
    return new Response(r.body,{status:r.status,headers:h});
  }
  return null;
}

export default {async scheduled(event,env){try{await ensureSchema(env);await expireListings(env,[]);}catch(e){console.error('scheduled expiry',e&&e.message);}},async fetch(req,env){const url=new URL(req.url);if(url.pathname.startsWith("/map/")){const m=await mapProxy(req,env,url);if(m)return m;}if(url.pathname==="/healthz"){let db=false,schema=false,error=null;try{await ensureSchema(env);db=true;schema=!!await env.DB.prepare("SELECT name FROM sqlite_master WHERE name='otps'").first();}catch(e){error=String(e&&e.message||e).slice(0,160);}return json({ok:db&&schema,v:8,db,schema,devOtp:env.DEV_OTP==="true",error});}if(url.pathname.startsWith("/api/")){try{await ensureSchema(env);return await api(env,req,url.pathname.slice(5),url);}catch(e){if(!e.status)console.error("Worker error:",e&&e.stack||e);return json({error:e.status?e.message:(env.DEV_OTP==="true"?"Server error: "+(e&&e.message):"Server error")},e.status||500);}}return env.ASSETS.fetch(req);}};
